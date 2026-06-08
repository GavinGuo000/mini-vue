// ============================================================
// 编译器 (compiler) —— 把 template 字符串编译成 render 函数
// ============================================================
//
// 完整流程分三步（Vue 也是这三步）：
//   template 字符串
//      │  parse      解析成 AST（抽象语法树）
//      ▼
//     AST
//      │  transform  转换/优化 AST（本实现简化）
//      ▼
//     AST
//      │  generate   生成 render 函数的字符串代码
//      ▼
//   render 函数
//
// 本实现是教学版，支持：元素、文本、{{ 插值 }}、v-if、v-for、
// @event / v-on、:bind / v-bind、普通属性。

import { h, Text, Fragment } from "../runtime/vnode.js";

// ---------------------------------------------------------
// 1. parse：template → AST
// ---------------------------------------------------------
function parse(template) {
  const context = { source: template.trim() };
  const nodes = parseChildren(context);
  return nodes.length === 1 ? nodes[0] : { type: "Fragment", children: nodes };
}

function parseChildren(context) {
  const nodes = [];
  while (context.source.length > 0) {
    const s = context.source;
    if (s.startsWith("</")) {
      break; // 遇到父级闭合标签，交回上层处理
    } else if (s.startsWith("{{")) {
      nodes.push(parseInterpolation(context));
    } else if (s[0] === "<") {
      nodes.push(parseElement(context));
    } else {
      nodes.push(parseText(context));
    }
  }
  return nodes;
}

// {{ expression }}
function parseInterpolation(context) {
  const closeIndex = context.source.indexOf("}}", 2);
  const content = context.source.slice(2, closeIndex).trim();
  advanceBy(context, closeIndex + 2);
  return { type: "Interpolation", content };
}

// <tag attr="x">children</tag>
function parseElement(context) {
  const match = /^<([a-zA-Z][\w-]*)/.exec(context.source);
  const tag = match[1];
  advanceBy(context, match[0].length);

  const props = parseAttributes(context);

  // 自闭合标签
  if (context.source.startsWith("/>")) {
    advanceBy(context, 2);
    return { type: "Element", tag, props, children: [] };
  }
  advanceBy(context, 1); // 跳过 '>'

  const children = parseChildren(context);

  // 跳过闭合标签 </tag>
  const closeMatch = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(context.source);
  if (closeMatch) advanceBy(context, closeMatch[0].length);

  return { type: "Element", tag, props, children };
}

function parseAttributes(context) {
  const props = [];
  while (
    context.source.length > 0 &&
    !context.source.startsWith(">") &&
    !context.source.startsWith("/>")
  ) {
    // 属性名：支持 @click / :id / v-if / v-for 等
    const nameMatch = /^[^\s/>=]+/.exec(context.source);
    if (!nameMatch) {
      advanceBy(context, 1);
      continue;
    }
    const name = nameMatch[0];
    advanceBy(context, name.length);
    advanceSpaces(context);

    let value = "";
    if (context.source[0] === "=") {
      advanceBy(context, 1);
      advanceSpaces(context);
      const quote = context.source[0];
      if (quote === '"' || quote === "'") {
        advanceBy(context, 1);
        const endIndex = context.source.indexOf(quote);
        value = context.source.slice(0, endIndex);
        advanceBy(context, endIndex + 1);
      }
    }
    advanceSpaces(context);
    props.push(parseAttr(name, value));
  }
  // 注意：这里不消费 '>'，交由 parseElement 处理自闭合 '/>' 或普通 '>'
  return props;
}

// 把指令/属性归一化成结构化对象
function parseAttr(name, value) {
  if (name.startsWith("v-if")) {
    return { kind: "if", exp: value };
  }
  if (name.startsWith("v-for")) {
    // v-for="item in list"
    const [, alias, source] = /(\w+)\s+in\s+(.+)/.exec(value) || [];
    return { kind: "for", alias, source };
  }
  if (name.startsWith("@") || name.startsWith("v-on:")) {
    const event = name.startsWith("@") ? name.slice(1) : name.slice(5);
    const handlerName = `on${event[0].toUpperCase()}${event.slice(1)}`;
    return { kind: "on", name: handlerName, exp: value };
  }
  if (name.startsWith(":") || name.startsWith("v-bind:")) {
    const bindName = name.startsWith(":") ? name.slice(1) : name.slice(7);
    return { kind: "bind", name: bindName, exp: value };
  }
  return { kind: "static", name, value };
}

function parseText(context) {
  // 文本读到下一个 '<' 或 '{{' 为止
  let endIndex = context.source.length;
  for (const token of ["<", "{{"]) {
    const idx = context.source.indexOf(token);
    if (idx !== -1 && idx < endIndex) endIndex = idx;
  }
  const content = context.source.slice(0, endIndex);
  advanceBy(context, content.length);
  return { type: "Text", content };
}

function advanceBy(context, n) {
  context.source = context.source.slice(n);
}
function advanceSpaces(context) {
  const match = /^\s+/.exec(context.source);
  if (match) advanceBy(context, match[0].length);
}

// ---------------------------------------------------------
// 2 + 3. generate：AST → render 函数的「源码字符串」
// ---------------------------------------------------------
//
// 这里直接生成一个可执行的函数体字符串，再用 new Function 把它变成函数。
// 生成的代码会调用 _ctx 上的变量，以及注入的 h / Text / Fragment 等帮助函数。

function genNode(node) {
  switch (node.type) {
    case "Element":
      return genElement(node);
    case "Text":
      return `h(Text, null, ${JSON.stringify(node.content)})`;
    case "Interpolation":
      // 插值表达式直接求值，转成字符串
      return `h(Text, null, _toDisplayString(${withCtx(node.content)}))`;
    case "Fragment":
      return `h(Fragment, null, [${node.children
        .map(genNode)
        .join(", ")}])`;
    default:
      return "null";
  }
}

function genElement(node) {
  // v-for 包在外层：把当前元素映射成数组
  const forDir = node.props.find((p) => p.kind === "for");
  // v-if 包在外层：条件不成立时渲染空文本
  const ifDir = node.props.find((p) => p.kind === "if");

  const props = genProps(node.props);
  const children = genChildren(node.children);
  let code = `h(${JSON.stringify(node.tag)}, ${props}, ${children})`;

  if (ifDir) {
    code = `(${withCtx(ifDir.exp)}) ? ${code} : h(Text, null, "")`;
  }
  if (forDir) {
    code = `h(Fragment, null, (${withCtx(forDir.source)}).map((${
      forDir.alias
    }) => ${code}))`;
  }
  return code;
}

function genProps(props) {
  const entries = [];
  for (const p of props) {
    if (p.kind === "static") {
      entries.push(`${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`);
    } else if (p.kind === "bind") {
      entries.push(`${JSON.stringify(p.name)}: ${withCtx(p.exp)}`);
    } else if (p.kind === "on") {
      // 事件处理器包成箭头函数，支持 @click="count++" 这种内联表达式
      entries.push(
        `${JSON.stringify(p.name)}: ($event) => { ${withCtx(p.exp)} }`
      );
    }
  }
  return entries.length ? `{ ${entries.join(", ")} }` : "null";
}

function genChildren(children) {
  if (!children || children.length === 0) return "null";
  if (children.length === 1 && children[0].type === "Text") {
    return JSON.stringify(children[0].content);
  }
  return `[${children.map(genNode).join(", ")}]`;
}

// 给表达式里的「裸标识符」加上 _ctx. 前缀，使其从渲染上下文取值。
// 教学简化版：用正则给标识符加前缀，跳过 JS 关键字 / 字面量。
const GLOBALS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "$event",
  "Math",
  "JSON",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "parseInt",
  "parseFloat",
]);

function withCtx(exp) {
  if (!exp) return "undefined";
  return exp.replace(
    /[a-zA-Z_$][\w$]*/g,
    (token, offset, full) => {
      // 跳过对象属性访问（前面是 '.'）和对象键（后面是 ':'）
      const prevChar = full[offset - 1];
      if (prevChar === ".") return token;
      if (GLOBALS.has(token)) return token;
      // 跟着 '(' 的当函数调用，依旧从 _ctx 取（如方法）
      return `_ctx.${token}`;
    }
  );
}

function generate(ast) {
  const body = genNode(ast);
  const code = `
    with (helpers) {
      return function render(_ctx) {
        return ${body};
      }
    }
  `;
  return code;
}

// ---------------------------------------------------------
// 对外：compile(template) → render 函数
// ---------------------------------------------------------
function toDisplayString(value) {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function compile(template) {
  const ast = parse(template);
  const code = generate(ast);

  const helpers = {
    h,
    Text,
    Fragment,
    _toDisplayString: toDisplayString,
  };

  // 用 new Function 把生成的字符串代码变成真正的函数
  const renderFactory = new Function("helpers", code);
  return renderFactory(helpers);
}

// 便于调试：查看某个 template 生成的 render 源码
export function compileToString(template) {
  return generate(parse(template));
}
