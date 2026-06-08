export {
  h,
  createVNode,
  createTextVNode,
  isVNode,
  Text,
  Fragment,
  ShapeFlags,
} from "./vnode.js";
export { createRenderer } from "./renderer.js";
export { createApp, renderer } from "./createApp.js";
export { nodeOps } from "./dom.js";
export { nextTick, queueJob } from "./scheduler.js";
export {
  getCurrentInstance,
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
} from "./component.js";
