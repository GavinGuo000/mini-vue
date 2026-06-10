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

// 创建默认渲染器：使用 Web DOM 操作接口 (nodeOps)
// 这是一个单例，整个应用共用一个渲染器
const renderer = createRenderer(nodeOps);

/**
 * 创建 Vue 应用实例
 *
 * 用法：
 *   const app = createApp(RootComponent, rootProps);
 *   app.mount('#app');  // 挂载到 DOM
 *   app.unmount(document.getElementById('app'));  // 卸载
 *
 * @param rootComponent 根组件配置对象
 * @param rootProps     根组件属性（可选）
 * @returns app 对象，包含 mount 和 unmount 方法
 */
export function createApp(rootComponent, rootProps = null) {
  const app = {
    /**
     * 挂载应用到指定容器
     * @param containerOrSelector 容器 DOM 元素 或 CSS 选择器字符串
     * @returns 组件实例
     */
    mount(containerOrSelector) {
      // 支持传入 CSS 选择器字符串或 DOM 元素
      const container =
        typeof containerOrSelector === "string"
          ? document.querySelector(containerOrSelector)
          : containerOrSelector;

      // 将根组件包装成 vnode，然后交给渲染器渲染
      const vnode = createVNode(rootComponent, rootProps);
      renderer.render(vnode, container);
      return vnode.component; // 返回组件实例，供外部访问
    },
    /**
     * 卸载应用：传入 null 触发卸载逻辑
     * @param container 容器 DOM 元素
     */
    unmount(container) {
      renderer.render(null, container);
    },
  };
  return app;
}

export { renderer };
