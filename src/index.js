// ============================================================
// mini-vue 总入口 —— 把响应式、运行时、编译器组装成一个完整的 Vue
// ============================================================
//
// 架构概览：
//
//   ┌────────────┐   ┌────────────┐   ┌────────────┐
//   │  响应式    │   │  运行时    │   │  编译器    │
//   │ reactivity │   │  runtime   │   │  compiler  │
//   │            │   │            │   │            │
//   │ reactive   │   │ h/vnode    │   │ parse      │
//   │ ref        │   │ renderer   │   │ generate   │
//   │ computed   │   │ component  │   │ compile    │
//   │ watch      │   │ scheduler  │   │            │
//   │ effect     │   │ createApp  │   │            │
//   └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
//         │               │               │
//         └───────────┬───┴───────────────┘
//                     │
//              src/index.js  ← 你在这里
//

import { registerCompiler } from "./runtime/component.js";
import { compile } from "./compiler/index.js";

// 注册运行时编译器：
// 组件如果只写了 template 字符串（没有 render 函数），
// setupComponent 时会调用 compileFn(template) 编译成 render 函数。
// 这里通过 registerCompiler 将编译器注入到运行时，
// 避免 runtime 直接 import compiler（防止循环引用）。
registerCompiler(compile);

// ---------- 响应式 API ----------
// 导出响应式系统的所有能力：
//   reactive / isReactive / toRaw  —— 基于 Proxy 的对象响应式
//   ref / isRef / unref / proxyRefs —— 基于 getter/setter 的原始值响应式
//   computed —— 带缓存的计算属性
//   watch    —— 侦听数据变化
//   effect / ReactiveEffect —— 底层副作用机制
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

// ---------- 运行时 API ----------
// 导出运行时的所有能力：
//   h / createVNode / createTextVNode / isVNode —— 创建虚拟节点
//   Text / Fragment —— 特殊节点类型
//   createRenderer  —— 创建自定义渲染器
//   createApp       —— 创建应用实例
//   nextTick        —— 等待 DOM 更新
//   生命周期 API    —— onMounted / onUpdated 等
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

// ---------- 编译器 API ----------
// 导出编译器的能力：
//   compile        —— 将 template 编译为 render 函数
//   compileToString —— 查看编译产物（调试用）
export { compile, compileToString } from "./compiler/index.js";
