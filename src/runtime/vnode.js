// ============================================================
// VNode —— 虚拟 DOM 节点
// ============================================================
//
// 虚拟 DOM 就是用 JS 对象来描述真实 DOM。它让我们可以：
//   1. 在内存里做 diff，最小化对真实 DOM 的操作（DOM 操作很昂贵）。
//   2. 跨平台渲染（同一份 vnode 可渲染到 DOM / canvas / 原生）。

// 特殊节点类型（用 Symbol 保证唯一）
export const Text = Symbol("Text"); // 纯文本节点
export const Fragment = Symbol("Fragment"); // 多根节点的包裹（不产生真实 DOM）

// vnode 形状标记，用位运算快速判断类型
export const ShapeFlags = {
  ELEMENT: 1, // 普通元素，如 div
  STATEFUL_COMPONENT: 1 << 1, // 组件
  TEXT_CHILDREN: 1 << 2, // 子节点是文本
  ARRAY_CHILDREN: 1 << 3, // 子节点是数组
};

export function createVNode(type, props = null, children = null) {
  let shapeFlag = 0;
  if (typeof type === "string") {
    shapeFlag = ShapeFlags.ELEMENT;
  } else if (typeof type === "object" || typeof type === "function") {
    shapeFlag = ShapeFlags.STATEFUL_COMPONENT;
  }

  if (typeof children === "string" || typeof children === "number") {
    shapeFlag |= ShapeFlags.TEXT_CHILDREN;
    children = String(children);
  } else if (Array.isArray(children)) {
    shapeFlag |= ShapeFlags.ARRAY_CHILDREN;
  }

  return {
    type,
    props: props || {},
    children,
    shapeFlag,
    key: props && props.key != null ? props.key : null, // diff 时用于复用节点
    el: null, // 对应的真实 DOM，patch 时挂上
    component: null, // 若为组件 vnode，挂组件实例
  };
}

// h 函数：createVNode 的语法糖，是手写 render 的入口
export function h(type, propsOrChildren, children) {
  // 兼容 h(type, children) 的调用形式
  if (arguments.length === 2) {
    if (
      typeof propsOrChildren === "object" &&
      !Array.isArray(propsOrChildren)
    ) {
      // 第二个参数是 props
      return createVNode(type, propsOrChildren);
    }
    // 第二个参数是 children（数组或文本）
    return createVNode(type, null, propsOrChildren);
  }
  return createVNode(type, propsOrChildren, children);
}

export function createTextVNode(text) {
  return createVNode(Text, null, String(text));
}

export function isVNode(value) {
  return !!(value && value.shapeFlag !== undefined);
}
