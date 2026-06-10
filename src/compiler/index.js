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
// 1. parse：template 字符串 → AST（抽象语法树）
// ---------------------------------------------------------
//
// 解析器采用「递归下降」风格：
//   - 用 context.source 跟踪剩余未解析的模板字符串
//   - 每解析一部分，就通过 advanceBy 截掉已解析的前缀
//   - 遇到 '<' 解析元素，遇到 '{{' 解析插值，其他解析为文本

/**
 * 解析 template 字符串为 AST
 * @param template 模板字符串
 * @returns AST 根节点（单节点或 Fragment）
 */
function parse(template) {
  // context 对象维护解析状态，source 是剩余未解析的字符串
  const context = { source: template.trim() };
  const nodes = parseChildren(context);
  // 如果只有一个根节点则直接返回，否则用 Fragment 包裹
  return nodes.length === 1 ? nodes[0] : { type: "Fragment", children: nodes };
}

/**
 * 解析子节点列表：循环解析直到遇到结束条件
 *
 * 结束条件：
 *   - source 为空（已解析完）
 *   - 遇到父级的闭合标签 '</'（交回上层 parseElement 处理）
 */
function parseChildren(context) {
  const nodes = [];
  while (context.source.length > 0) {
    const s = context.source;
    if (s.startsWith("</")) {
      // 遇到闭合标签，停止解析，交回上层 parseElement 处理
      break;
    } else if (s.startsWith("{{")) {
      // 插值表达式：{{ expression }}
      nodes.push(parseInterpolation(context));
    } else if (s[0] === "<") {
      // HTML 元素：<tag>...</tag>
      nodes.push(parseElement(context));
    } else {
      // 纯文本内容
      nodes.push(parseText(context));
    }
  }
  return nodes;
}

/**
 * 解析插值表达式：{{ expression }}
 *
 * AST 节点格式：{ type: "Interpolation", content: "expression" }
 * content 会在代码生成阶段被转换成 _ctx.expression 的形式
 */
function parseInterpolation(context) {
  // 找到 '}}' 的位置，提取中间的表达式内容
  const closeIndex = context.source.indexOf("}}", 2);
  const content = context.source.slice(2, closeIndex).trim();
  advanceBy(context, closeIndex + 2); // 截掉 '{{' + content + '}}'
  return { type: "Interpolation", content };
}

/**
 * 解析 HTML 元素：<tag attr="x">children</tag>
 *
 * 解析流程：
 *   1. 提取标签名
 *   2. 解析属性列表（包括指令）
 *   3. 判断是否自闭合
 *   4. 递归解析子节点
 *   5. 跳过闭合标签
 *
 * AST 节点格式：{ type: "Element", tag: "div", props: [...], children: [...] }
 */
function parseElement(context) {
  // 1. 提取标签名（支持字母、数字、连字符）
  const match = /^<([a-zA-Z][\w-]*)/.exec(context.source);
  const tag = match[1];
  advanceBy(context, match[0].length); // 截掉 '<tag'

  // 2. 解析属性列表（包括 v-if, @click, :bind 等指令）
  const props = parseAttributes(context);

  // 3. 判断是否自闭合标签（如 <br/> <img/>）
  if (context.source.startsWith("/>")) {
    advanceBy(context, 2); // 截掉 '/>'
    return { type: "Element", tag, props, children: [] };
  }
  advanceBy(context, 1); // 截掉 '>'

  // 4. 递归解析子节点（parseChildren 遇到 '</' 会停止）
  const children = parseChildren(context);

  // 5. 跳过闭合标签 </tag>
  const closeMatch = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(context.source);
  if (closeMatch) advanceBy(context, closeMatch[0].length);

  return { type: "Element", tag, props, children };
}

/**
 * 解析属性列表：循环读取所有属性，直到遇到 '>' 或 '/>'
 *
 * 支持的属性格式：
 *   - 普通属性：class="foo"
 *   - 动态绑定：:id="dynamicId" 或 v-bind:id="dynamicId"
 *   - 事件监听：@click="handler" 或 v-on:click="handler"
 *   - 指令：v-if="condition"、v-for="item in list"
 *   - 无值属性：disabled
 */
function parseAttributes(context) {
  const props = [];
  while (
    context.source.length > 0 &&
    !context.source.startsWith(">") &&
    !context.source.startsWith("/>")
  ) {
    // 解析属性名：匹配到空格、'>'、'/'、'=' 之前的所有字符
    const nameMatch = /^[^\s/>=]+/.exec(context.source);
    if (!nameMatch) {
      advanceBy(context, 1);
      continue;
    }
    const name = nameMatch[0];
    advanceBy(context, name.length);
    advanceSpaces(context);

    // 解析属性值（如果有 '='）
    let value = "";
    if (context.source[0] === "=") {
      advanceBy(context, 1); // 截掉 '='
      advanceSpaces(context);
      const quote = context.source[0];
      if (quote === '"' || quote === "'") {
        advanceBy(context, 1); // 截掉开引号
        const endIndex = context.source.indexOf(quote);
        value = context.source.slice(0, endIndex);
        advanceBy(context, endIndex + 1); // 截掉值 + 闭引号
      }
    }
    advanceSpaces(context);
    // 将原始属性名/值归一化为结构化对象（由 parseAttr 处理）
    props.push(parseAttr(name, value));
  }
  // 注意：这里不消费 '>'，交由 parseElement 处理自闭合 '/>' 或普通 '>'
  return props;
}

/**
 * 将原始属性名/值归一化为结构化对象
 *
 * 不同属性类型的输出格式：
 *   v-if="cond"         → { kind: "if",     exp: "cond" }
 *   v-for="x in list"   → { kind: "for",    alias: "x", source: "list" }
 *   @click="handler"    → { kind: "on",     name: "onClick", exp: "handler" }
 *   :id="dynamicId"     → { kind: "bind",   name: "id", exp: "dynamicId" }
 *   class="foo"         → { kind: "static", name: "class", value: "foo" }
 */
function parseAttr(name, value) {
  // v-if 指令：条件渲染
  if (name.startsWith("v-if")) {
    return { kind: "if", exp: value };
  }
  // v-for 指令：列表渲染，解析 "item in list" 为 alias + source
  if (name.startsWith("v-for")) {
    const [, alias, source] = /(\w+)\s+in\s+(.+)/.exec(value) || [];
    return { kind: "for", alias, source };
  }
  // 事件监听：@click 或 v-on:click → onClick
  if (name.startsWith("@") || name.startsWith("v-on:")) {
    const event = name.startsWith("@") ? name.slice(1) : name.slice(5);
    // 事件名转驼峰：click → onClick
    const handlerName = `on${event[0].toUpperCase()}${event.slice(1)}`;
    return { kind: "on", name: handlerName, exp: value };
  }
  // 动态绑定：:id 或 v-bind:id
  if (name.startsWith(":") || name.startsWith("v-bind:")) {
    const bindName = name.startsWith(":") ? name.slice(1) : name.slice(7);
    return { kind: "bind", name: bindName, exp: value };
  }
  // 普通静态属性
  return { kind: "static", name, value };
}

/**
 * 解析纯文本节点
 * 文本内容从当前位置读取，直到遇到下一个 '<' 或 '{{'
 */
function parseText(context) {
  let endIndex = context.source.length;
  for (const token of ["<", "{{"]) {
    const idx = context.source.indexOf(token);
    if (idx !== -1 && idx < endIndex) endIndex = idx;
  }
  const content = context.source.slice(0, endIndex);
  advanceBy(context, content.length);
  return { type: "Text", content };
}

/**
 * 前进 n 个字符：截掉已解析的部分
 */
function advanceBy(context, n) {
  context.source = context.source.slice(n);
}
/**
 * 跳过前导空白字符
 */
function advanceSpaces(context) {
  const match = /^\s+/.exec(context.source);
  if (match) advanceBy(context, match[0].length);
}

// ---------------------------------------------------------
// 2 + 3. generate：AST → render 函数的「源码字符串」
// ---------------------------------------------------------
//
// 代码生成器将 AST 转换为可执行的 render 函数：
//   1. 递归遍历 AST 节点，生成对应的 JS 表达式字符串
//   2. 用 with(helpers) 注入 h/Text/Fragment 等辅助函数
//   3. 用 new Function() 将字符串编译为真正的函数
//
// 生成示例：
//   template: '<div>{{ msg }}</div>'
//   生成代码: h("div", null, h(Text, null, _toDisplayString(_ctx.msg)))

/**
 * 递归生成节点的代码字符串
 * 根据节点类型分发到对应的生成函数
 */
function genNode(node) {
  switch (node.type) {
    case "Element":
      return genElement(node);
    case "Text":
      // 文本节点 → h(Text, null, "文本内容")
      return `h(Text, null, ${JSON.stringify(node.content)})`;
    case "Interpolation":
      // 插值表达式 → h(Text, null, _toDisplayString(_ctx.表达式))
      // _toDisplayString 将值安全地转为显示字符串（null/undefined 显示空串）
      return `h(Text, null, _toDisplayString(${withCtx(node.content)}))`;
    case "Fragment":
      // Fragment → h(Fragment, null, [子节点1, 子节点2, ...])
      return `h(Fragment, null, [${node.children
        .map(genNode)
        .join(", ")}])`;
    default:
      return "null";
  }
}

/**
 * 生成元素节点的代码字符串
 *
 * 处理流程：
 *   1. 先检查是否有 v-for 和 v-if 指令
 *   2. 生成基础的 h(tag, props, children) 表达式
 *   3. 如果有 v-if，包裹三元表达式
 *   4. 如果有 v-for，包裹 .map() 调用
 *
 * 注意：v-for 包裹在 v-if 外层，
 * 即先循环再生成每个元素的条件判断（与 Vue 2 不同，Vue 3 也是这个顺序）
 */
function genElement(node) {
  // v-for 包在外层：把当前元素映射成数组
  // 生成形如：h(Fragment, null, (list).map((item) => h(...)))
  const forDir = node.props.find((p) => p.kind === "for");
  // v-if 包在内层：条件不成立时渲染空文本节点
  // 生成形如：(condition) ? h(...) : h(Text, null, "")
  const ifDir = node.props.find((p) => p.kind === "if");

  const props = genProps(node.props);
  const children = genChildren(node.children);
  // 先生成基础的 h(tag, props, children) 表达式
  let code = `h(${JSON.stringify(node.tag)}, ${props}, ${children})`;

  // 如果有 v-if，包裹三元表达式：
  // (condition) ? h(tag, ...) : h(Text, null, "")
  if (ifDir) {
    code = `(${withCtx(ifDir.exp)}) ? ${code} : h(Text, null, "")`;
  }
  // 如果有 v-for，包裹 .map() 调用（在 v-if 外层）：
  // h(Fragment, null, (source).map((alias) => ...))
  if (forDir) {
    code = `h(Fragment, null, (${withCtx(forDir.source)}).map((${
      forDir.alias
    }) => ${code}))`;
  }
  return code;
}

/**
 * 生成属性对象的代码字符串
 *
 * 不同类型属性的生成规则：
 *   - static: "name": "value"    （静态字符串值）
 *   - bind:   "name": _ctx.exp   （动态绑定，从上下文取值）
 *   - on:     "onClick": ($event) => { _ctx.handler }  （事件，包成箭头函数）
 */
function genProps(props) {
  const entries = [];
  for (const p of props) {
    if (p.kind === "static") {
      entries.push(`${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`);
    } else if (p.kind === "bind") {
      entries.push(`${JSON.stringify(p.name)}: ${withCtx(p.exp)}`);
    } else if (p.kind === "on") {
      // 事件处理器包成箭头函数，支持 @click="count++" 这种内联表达式
      // 生成形如："onClick": ($event) => { _ctx.count++ }
      // $event 是事件对象，可在表达式中使用
      entries.push(
        `${JSON.stringify(p.name)}: ($event) => { ${withCtx(p.exp)} }`
      );
    }
  }
  return entries.length ? `{ ${entries.join(", ")} }` : "null";
}

/**
 * 生成子节点的代码字符串
 *
 * 优化：单个文本子节点直接生成字符串字面量，
 * 而不是包一层 h(Text, null, "...")，减少运行时开销。
 */
function genChildren(children) {
  if (!children || children.length === 0) return "null";
  // 优化：单个文本子节点直接返回字符串
  if (children.length === 1 && children[0].type === "Text") {
    return JSON.stringify(children[0].content);
  }
  return `[${children.map(genNode).join(", ")}]`;
}

// 给表达式里的「裸标识符」加上 _ctx. 前缀，使其从渲染上下文取值。
//
// 例如：
//   "count + 1"  →  "_ctx.count + 1"
//   "obj.name"   →  "_ctx.obj.name"  （obj 加前缀，name 不加因为是属性访问）
//   "Math.max"   →  "Math.max"       （Math 是全局变量，不加前缀）
//
// 教学简化版：用正则给标识符加前缀，跳过 JS 关键字 / 全局对象 / 字面量。
// 生产环境的 Vue 编译器使用更复杂的 AST 分析（scope tracking）。

// 不需要加 _ctx. 前缀的全局标识符集合
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

/**
 * 为表达式中的标识符添加 _ctx. 前缀
 * 通过正则匹配所有标识符，并跳过以下情况：
 *   - 对象属性访问（前面是 '.'）
 *   - JS 全局对象/关键字（在 GLOBALS 集合中）
 */
function withCtx(exp) {
  if (!exp) return "undefined";
  return exp.replace(
    /[a-zA-Z_$][\w$]*/g,
    (token, offset, full) => {
      // 跳过对象属性访问（前面是 '.'，如 obj.name 中的 name）
      const prevChar = full[offset - 1];
      if (prevChar === ".") return token;
      // 跳过全局标识符（如 Math、true、null 等）
      if (GLOBALS.has(token)) return token;
      // 其他标识符加上 _ctx. 前缀，从渲染上下文取值
      return `_ctx.${token}`;
    }
  );
}

/**
 * 生成完整的 render 函数源码字符串
 *
 * 生成的代码结构：
 *   with (helpers) {
 *     return function render(_ctx) {
 *       return h("div", ...);  // 生成的 vnode 表达式
 *     }
 *   }
 *
 * with(helpers) 让 h、Text、Fragment 等辅助函数可以直接使用，
 * 无需加前缀。_ctx 参数是组件的渲染上下文（setupState + props）。
 */
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
/**
 * 将任意值安全地转为显示字符串
 * 用于模板插值 {{ }} 的值转换：
 *   - null / undefined → 空字符串
 *   - 对象 → JSON 字符串
 *   - 其他 → String() 转换
 */
function toDisplayString(value) {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * compile —— 编译器的对外接口
 *
 * 将 template 字符串编译为 render 函数。
 * 完整流程：template → parse → AST → generate → render 函数
 *
 * @param template 模板字符串
 * @returns render 函数，接受 _ctx 参数，返回 vnode
 *
 * 用法：
 *   const render = compile('<div>{{ msg }}</div>');
 *   const vnode = render({ msg: 'hello' });
 */
export function compile(template) {
  // 1. parse：template → AST
  const ast = parse(template);
  // 2. generate：AST → render 函数源码字符串
  const code = generate(ast);

  // helpers：注入到 render 函数中的辅助函数
  const helpers = {
    h,                  // 创建 vnode
    Text,               // 文本节点类型
    Fragment,           // Fragment 节点类型
    _toDisplayString: toDisplayString, // 插值显示转换
  };

  // 3. 用 new Function 将字符串代码编译为可执行函数
  // new Function("helpers", code) 创建一个接收 helpers 参数的函数，
  // 函数体是 code 字符串。执行后返回 render 函数。
  const renderFactory = new Function("helpers", code);
  return renderFactory(helpers);
}

/**
 * 编译为字符串（调试用）
 * 查看某个 template 编译后的 render 函数源码，便于学习和调试。
 */
export function compileToString(template) {
  return generate(parse(template));
}
