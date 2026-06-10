// ============================================================
// 运行时模块统一出口
// ============================================================
//
// 将运行时的所有公开 API 统一导出，包括：
//   - VNode 创建与判断：h, createVNode, createTextVNode, isVNode, Text, Fragment, ShapeFlags
//   - 渲染器：createRenderer（用于自定义渲染器）
//   - 应用入口：createApp, renderer
//   - 平台操作：nodeOps（Web DOM 操作接口）
//   - 调度器：nextTick, queueJob
//   - 生命周期 API：getCurrentInstance, onBeforeMount, onMounted, onBeforeUpdate, onUpdated

// VNode 相关 API
export {
  h,
  createVNode,
  createTextVNode,
  isVNode,
  Text,
  Fragment,
  ShapeFlags,
} from "./vnode.js";
// 渲染器：创建自定义渲染器（传入平台操作接口）
export { createRenderer } from "./renderer.js";
// 应用入口：创建应用实例 + 默认渲染器
export { createApp, renderer } from "./createApp.js";
// 平台操作接口：Web DOM 操作（createElement, insert, patchProp 等）
export { nodeOps } from "./dom.js";
// 调度器：异步批量更新 + nextTick
export { nextTick, queueJob } from "./scheduler.js";
// 组件生命周期 API
export {
  getCurrentInstance,
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
} from "./component.js";
