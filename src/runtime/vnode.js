// ============================================================
// VNode —— 虚拟 DOM 节点
// ============================================================
//
// 虚拟 DOM 就是用 JS 对象来描述真实 DOM。它让我们可以：
//   1. 在内存里做 diff，最小化对真实 DOM 的操作（DOM 操作很昂贵）。
//   2. 跨平台渲染（同一份 vnode 可渲染到 DOM / canvas / 原生）。

// 特殊节点类型（用 Symbol 保证唯一性，不会与任何字符串标签名冲突）
export const Text = Symbol("Text"); // 纯文本节点，不产生真实元素 DOM，对应 "hello" 这种纯文字
export const Fragment = Symbol("Fragment"); // 多根节点的包裹容器，本身不产生真实 DOM，
                                            // 用于 v-for、多根组件等场景

// vnode 形状标记，用位运算（bitwise）快速判断节点类型
// 位运算的优势：一个数字可以同时存储多个标记，用 & 快速判断
// 如 shapeFlag & ELEMENT 可快速判断是否为元素节点
export const ShapeFlags = {
  ELEMENT: 1,              // 0001 - 普通元素，如 div、span、button
  STATEFUL_COMPONENT: 1 << 1, // 0010 - 有状态组件（setup/render 组件）
  TEXT_CHILDREN: 1 << 2,   // 0100 - 子节点是文本字符串
  ARRAY_CHILDREN: 1 << 3,  // 1000 - 子节点是数组（多个子节点）
};

/**
 * 创建虚拟节点 (VNode) 的核心函数
 *
 * VNode 是对真实 DOM 的 JS 描述，包含以下信息：
 *   - type:       节点类型（字符串标签名 / 组件对象 / Text / Fragment）
 *   - props:      属性对象（包含 class、style、事件、自定义属性等）
 *   - children:   子节点（文本字符串 或 VNode 数组）
 *   - shapeFlag:  位运算标记，快速判断节点类型
 *   - key:        diff 时用于节点复用和排序优化的唯一标识
 *   - el:         对应的真实 DOM 节点（patch 时挂载）
 *   - component:  组件实例（仅组件类型 VNode 拥有）
 *
 * @param type     节点类型
 * @param props    属性对象（可为 null）
 * @param children 子节点（字符串/数字/数组/null）
 * @returns VNode 对象
 */
export function createVNode(type, props = null, children = null) {
  // 根据 type 类型设置基本标记
  let shapeFlag = 0;
  if (typeof type === "string") {
    // 字符串类型 = 普通 HTML 元素
    shapeFlag = ShapeFlags.ELEMENT;
  } else if (typeof type === "object" || typeof type === "function") {
    // 对象或函数类型 = 组件（包含 setup/render/template 等配置）
    shapeFlag = ShapeFlags.STATEFUL_COMPONENT;
  }

  // 根据 children 类型设置子节点标记（使用 |= 位运算合并标记）
  if (typeof children === "string" || typeof children === "number") {
    // 文本子节点：用 | 合并到现有标记上
    shapeFlag |= ShapeFlags.TEXT_CHILDREN;
    children = String(children); // 确保类型一致性
  } else if (Array.isArray(children)) {
    // 数组子节点：多个子节点
    shapeFlag |= ShapeFlags.ARRAY_CHILDREN;
  }

  return {
    type,
    props: props || {},
    children,
    shapeFlag,
    // key 用于 diff 算法中精确匹配新旧节点：
    // 有 key 的节点可以被精确复用，避免不必要的 DOM 重建。
    // 如列表渲染中 key="item.id" 能让 diff 正确识别移动/新增/删除。
    key: props && props.key != null ? props.key : null,
    el: null,          // patch 时挂上对应的真实 DOM 节点
    component: null,   // 若为组件 vnode，挂载组件实例
  };
}

/**
 * h 函数：createVNode 的便捷语法糖，是手写 render 函数的主要入口。
 *
 * 支持多种调用方式（Vue 风格）：
 *   h("div")                           → 无属性无子节点
 *   h("div", { id: "app" })           → 有属性无子节点
 *   h("div", "hello")                 → 无属性有文本子节点
 *   h("div", [h("span", "hi")])       → 无属性有数组子节点
 *   h("div", { id: "app" }, "hello") → 有属性有文本子节点
 *   h("div", { id: "app" }, [h("span", "hi")]) → 完整形式
 *
 * @param type             节点类型
 * @param propsOrChildren  属性对象 或 子节点
 * @param children         子节点
 * @returns VNode 对象
 */
export function h(type, propsOrChildren, children) {
  // 兼容 h(type, children) 的两参数调用形式
  if (arguments.length === 2) {
    if (
      typeof propsOrChildren === "object" &&
      !Array.isArray(propsOrChildren)
    ) {
      // 第二个参数是纯对象（非数组） → 当作 props 处理
      return createVNode(type, propsOrChildren);
    }
    // 第二个参数是数组或文本 → 当作 children 处理
    return createVNode(type, null, propsOrChildren);
  }
  // 三参数：完整形式
  return createVNode(type, propsOrChildren, children);
}

/**
 * 创建纯文本 VNode 的便捷函数
 * 用于编译器生成的代码中，表示文本节点。
 */
export function createTextVNode(text) {
  return createVNode(Text, null, String(text));
}

/**
 * 判断一个值是否是 VNode
 * 通过检查 shapeFlag 是否存在来判断
 */
export function isVNode(value) {
  return !!(value && value.shapeFlag !== undefined);
}
