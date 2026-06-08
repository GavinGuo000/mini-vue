// ============================================================
// mini-vue 总入口 —— 把响应式、运行时、编译器组装成一个 Vue
// ============================================================

import { registerCompiler } from "./runtime/component.js";
import { compile } from "./compiler/index.js";

// 注册运行时编译器：组件写 template 时会用到
registerCompiler(compile);

// 响应式
export {
  reactive,
  isReactive,
  toRaw,
  ref,
  isRef,
  unref,
  proxyRefs,
  computed,
  watch,
  effect,
  ReactiveEffect,
} from "./reactivity/index.js";

// 运行时
export {
  h,
  createVNode,
  createTextVNode,
  isVNode,
  Text,
  Fragment,
  createRenderer,
  createApp,
  nextTick,
  getCurrentInstance,
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
} from "./runtime/index.js";

// 编译器
export { compile, compileToString } from "./compiler/index.js";
