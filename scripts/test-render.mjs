// ============================================================
// mini-vue 渲染器测试脚本
// ============================================================
//
// 使用 JSDOM 模拟浏览器环境，在 Node.js 中测试 mini-vue 的核心功能：
//   1. 基础渲染 + 响应式更新（异步调度）
//   2. keyed diff：打乱顺序应复用同一批 DOM 节点
//   3. 编译器：template → render，并能响应式更新
//
// 运行方式：npm test 或 node scripts/test-render.mjs

// ---- JSDOM 模拟浏览器环境 ----
import { JSDOM } from "jsdom";
const dom = new JSDOM(`<!DOCTYPE html><div id="app"></div>`);
// 将 JSDOM 的 document/window 挂载到全局，
// 让 mini-vue 的 DOM 操作能正常运行
globalThis.document = dom.window.document;
globalThis.window = dom.window;

// ---- 动态导入 mini-vue（ES Module） ----
const { createApp, h, ref, reactive, compile, nextTick, computed } =
  await import("../src/index.js");

const root = document.getElementById("app");

// ---- 简单的测试框架 ----
let pass = 0,
  fail = 0;
function assert(name, cond) {
  if (cond) {
    pass++;
    console.log("✓", name);
  } else {
    fail++;
    console.log("✗", name);
  }
}

// ============================================================
// 测试 1：基础渲染 + 响应式更新（异步调度）
// ============================================================
// 验证：组件首次渲染正确，点击按钮后通过响应式系统自动更新 DOM
const A = {
  setup() {
    const count = ref(0);
    return { count, inc: () => count.value++ };
  },
  render(ctx) {
    return h("div", null, [
      h("span", { id: "c" }, `count:${ctx.count}`),
      h("button", { onClick: ctx.inc }, "+"),
    ]);
  },
};
createApp(A).mount(root);
// 验证首次渲染
assert("initial render", root.querySelector("#c").textContent === "count:0");
// 模拟点击按钮，触发 ref 变化
root.querySelector("button").click();
// 等待异步调度完成（微任务队列刷新）
await nextTick();
// 验证响应式更新：DOM 应已更新为 count:1
assert("reactive update after click", root.querySelector("#c").textContent === "count:1");

// ============================================================
// 测试 2：keyed diff —— 打乱顺序应复用同一批 DOM 节点
// ============================================================
// 验证：diff 算法通过 key 精确匹配节点，复用 DOM 而非重建
const order = reactive(["a", "b", "c", "d"]);
const L = {
  render() {
    return h(
      "ul",
      null,
      order.map((k) => h("li", { key: k }, k))
    );
  },
};
const root2 = dom.window.document.createElement("div");
createApp(L).mount(root2);
// 记录初始 DOM 节点引用
const before = [...root2.querySelectorAll("li")];
const beforeA = before.find((el) => el.textContent === "a");
// 反转数组顺序
order.splice(0, order.length, "d", "c", "b", "a");
await nextTick();
// 验证 DOM 顺序已更新
const after = [...root2.querySelectorAll("li")];
const afterA = after.find((el) => el.textContent === "a");
assert("keyed diff order changed", after.map((e) => e.textContent).join("") === "dcba");
// 核心验证：节点引用相同，说明是移动而非重建
assert("keyed diff reuses DOM node (no recreate)", beforeA === afterA);

// ============================================================
// 测试 3：编译器 —— template 编译为 render 并能响应式更新
// ============================================================
// 验证：编译器的插值、v-if、v-for 都能正常工作
const T = compile(`<div><p>{{ msg }}</p><b v-if="show">VISIBLE</b><i v-for="n in nums">{{ n }}</i></div>`);
const C = {
  render: T,
  setup() {
    const msg = ref("hello");
    const show = ref(false);
    const nums = reactive([1, 2, 3]);
    C._ctl = { msg, show, nums };
    return { msg, show, nums };
  },
};
const root3 = dom.window.document.createElement("div");
createApp(C).mount(root3);
// 验证插值渲染
assert("compiler interpolation", root3.querySelector("p").textContent === "hello");
// 验证 v-if=false 时不渲染
assert("compiler v-if false hides", !root3.querySelector("b"));
// 验证 v-for 渲染数量
assert("compiler v-for count", root3.querySelectorAll("i").length === 3);
// 修改响应式数据，验证响应式更新
C._ctl.show.value = true;
C._ctl.msg.value = "world";
await nextTick();
// 验证 v-if=true 时显示
assert("compiler v-if true shows", root3.querySelector("b") && root3.querySelector("b").textContent === "VISIBLE");
// 验证插值已更新
assert("compiler interpolation updated", root3.querySelector("p").textContent === "world");

// ---- 输出测试结果 ----
console.log(`\nResult: ${pass} passed, ${fail} failed`);
// 有失败则退出码为 1（CI/CD 会因此失败）
process.exit(fail ? 1 : 0);
