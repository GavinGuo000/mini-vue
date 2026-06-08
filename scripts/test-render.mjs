import { JSDOM } from "jsdom";
const dom = new JSDOM(`<!DOCTYPE html><div id="app"></div>`);
globalThis.document = dom.window.document;
globalThis.window = dom.window;

const { createApp, h, ref, reactive, compile, nextTick, computed } =
  await import("../src/index.js");

const root = document.getElementById("app");
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

// 1) 基础渲染 + 响应式更新（异步调度）
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
assert("initial render", root.querySelector("#c").textContent === "count:0");
root.querySelector("button").click();
await nextTick();
assert("reactive update after click", root.querySelector("#c").textContent === "count:1");

// 2) keyed diff：打乱顺序应复用同一批 DOM 节点
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
const before = [...root2.querySelectorAll("li")];
const beforeA = before.find((el) => el.textContent === "a");
order.splice(0, order.length, "d", "c", "b", "a"); // reverse-ish
await nextTick();
const after = [...root2.querySelectorAll("li")];
const afterA = after.find((el) => el.textContent === "a");
assert("keyed diff order changed", after.map((e) => e.textContent).join("") === "dcba");
assert("keyed diff reuses DOM node (no recreate)", beforeA === afterA);

// 3) 编译器：template -> render，并能响应式更新
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
assert("compiler interpolation", root3.querySelector("p").textContent === "hello");
assert("compiler v-if false hides", !root3.querySelector("b"));
assert("compiler v-for count", root3.querySelectorAll("i").length === 3);
C._ctl.show.value = true;
C._ctl.msg.value = "world";
await nextTick();
assert("compiler v-if true shows", root3.querySelector("b") && root3.querySelector("b").textContent === "VISIBLE");
assert("compiler interpolation updated", root3.querySelector("p").textContent === "world");

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
