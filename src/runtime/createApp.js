// ============================================================
// createApp —— 应用入口
// ============================================================
//
// createApp(rootComponent).mount('#app') 的链路：
//   1. 把根组件包成 vnode。
//   2. 调用渲染器的 render(vnode, container) 完成首次挂载。

import { createRenderer } from "./renderer.js";
import { nodeOps } from "./dom.js";
import { createVNode } from "./vnode.js";

const renderer = createRenderer(nodeOps);

export function createApp(rootComponent, rootProps = null) {
  const app = {
    mount(containerOrSelector) {
      const container =
        typeof containerOrSelector === "string"
          ? document.querySelector(containerOrSelector)
          : containerOrSelector;

      const vnode = createVNode(rootComponent, rootProps);
      renderer.render(vnode, container);
      return vnode.component;
    },
    unmount(container) {
      renderer.render(null, container);
    },
  };
  return app;
}

export { renderer };
