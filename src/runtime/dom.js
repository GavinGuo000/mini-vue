// ============================================================
// 平台操作 —— 把「怎么操作 DOM」与「diff 算法」解耦
// ============================================================
//
// 渲染器(renderer)只关心 diff 逻辑，所有真实 DOM 操作都通过这组接口完成。
// 换一组接口就能渲染到别的平台（canvas / 小程序 / SSR），这就是
// Vue3 "自定义渲染器(createRenderer)" 的设计思想。

export const nodeOps = {
  /**
   * 创建元素节点
   * @param tag HTML 标签名，如 'div'、'span'、'button'
   */
  createElement(tag) {
    return document.createElement(tag);
  },
  /**
   * 创建文本节点
   * @param text 文本内容
   */
  createText(text) {
    return document.createTextNode(text);
  },
  /**
   * 更新文本节点的文本内容
   * 通过 nodeValue 属性设置（适用于 TextNode）
   */
  setText(node, text) {
    node.nodeValue = text;
  },
  /**
   * 设置元素节点的文本内容
   * 通过 textContent 属性设置（会清空所有子节点并设置文本）
   */
  setElementText(el, text) {
    el.textContent = text;
  },
  /**
   * 插入节点到容器中
   * 使用 insertBefore 而非 appendChild，因为需要支持 anchor 参数，
   * 实现「插入到某个参照节点之前」的能力（diff 算法中移动节点时用到）。
   * @param child  要插入的节点
   * @param parent 父容器
   * @param anchor 参照节点（新节点会插入到 anchor 之前，null 表示追加到末尾）
   */
  insert(child, parent, anchor = null) {
    parent.insertBefore(child, anchor);
  },
  /**
   * 移除节点
   * 先获取父节点，再从父节点中移除子节点
   */
  remove(child) {
    const parent = child.parentNode;
    if (parent) parent.removeChild(child);
  },
  /**
   * 更新元素的属性 —— 根据属性类型分发到不同的处理函数
   *
   * 属性类型分发：
   *   - class → 直接设置 className
   *   - style → 增量更新 style 对象
   *   - on*   → 事件监听（addEventListener/removeEventListener）
   *   - 其他  → 普通 HTML 属性（setAttribute/removeAttribute）
   */
  patchProp(el, key, prevValue, nextValue) {
    if (key === "class") {
      // class 直接设置 className（比 classList 简单，性能也更好）
      el.className = nextValue || "";
    } else if (key === "style") {
      // style 需要增量更新：只设置变化的样式，删除不再有的样式
      patchStyle(el, prevValue, nextValue);
    } else if (isEvent(key)) {
      // 事件属性：以 'on' + 大写字母开头的属性视为事件
      patchEvent(el, key, nextValue);
    } else {
      // 普通 HTML 属性
      patchAttr(el, key, nextValue);
    }
  },
};

/**
 * 判断属性名是否为事件属性
 * 规则：以 'on' 开头，第三个字母为大写，如 onClick、onInput、onKeydown
 */
function isEvent(key) {
  return /^on[A-Z]/.test(key);
}

/**
 * 增量更新内联样式
 *
 * 与 class 不同，style 是一个对象，需要逐个属性对比更新：
 *   1. 遍历新 style，设置变化的样式属性
 *   2. 遍历旧 style，删除新 style 中已不存在的样式属性
 *
 * @param el   DOM 元素
 * @param prev 旧的 style 对象
 * @param next 新的 style 对象
 */
function patchStyle(el, prev, next) {
  next = next || {};
  // 设置新的样式属性
  for (const key in next) {
    el.style[key] = next[key];
  }
  // 删除旧的但新的中没有的样式属性
  if (prev) {
    for (const key in prev) {
      if (!(key in next)) el.style[key] = "";
    }
  }
}

/**
 * 更新事件监听器
 *
 * 设计巧妙：使用 invoker 函数作为「代理」，而非直接绑定用户回调。
 * 好处：当用户回调变化时，只需替换 invoker.value，
 * 无需 removeEventListener + addEventListener（避免性能开销）。
 *
 * 原理：
 *   - 首次绑定：创建 invoker 函数 → addEventListener(eventName, invoker)
 *   - 更新回调：只需 invoker.value = newHandler（无需重新绑定）
 *   - 删除事件：removeEventListener(eventName, invoker)
 *
 * invokers 存储在 el._vei (Vue Event Invokers) 上，
 * 用于复用同一个 invoker，避免重复绑定。
 *
 * @param el       DOM 元素
 * @param rawName  事件属性名，如 'onClick'
 * @param handler  事件回调函数（null 表示移除）
 */
function patchEvent(el, rawName, handler) {
  // _vei = Vue Event Invokers，存储所有事件 invoker 的对象
  const invokers = el._vei || (el._vei = {});
  // 转换事件名：onClick → click，onKeydown → keydown
  const eventName = rawName.slice(2).toLowerCase();
  const existing = invokers[rawName]; // 获取已有的 invoker

  if (handler) {
    if (existing) {
      // 已有 invoker：只需替换内部回调，无需重新绑定事件监听
      // 这是性能优化的关键：避免反复 add/removeEventListener
      existing.value = handler;
    } else {
      // 首次绑定：创建 invoker 代理函数
      // invoker 本身是事件监听器，内部调用 invoker.value（真正的用户回调）
      const invoker = (invokers[rawName] = (e) => invoker.value(e));
      invoker.value = handler; // 将用户回调存储在 invoker 上
      el.addEventListener(eventName, invoker);
    }
  } else if (existing) {
    // handler 为 null 且已有 invoker → 移除事件监听
    el.removeEventListener(eventName, existing);
    invokers[rawName] = undefined;
  }
}

/**
 * 更新普通 HTML 属性
 *
 * @param el    DOM 元素
 * @param key   属性名
 * @param value 属性值（null/undefined/false 表示移除属性）
 */
function patchAttr(el, key, value) {
  if (value == null || value === false) {
    // 值为 null/undefined/false 时移除属性
    // 例如：disabled="false" 应该移除 disabled 属性而非设置为 "false"
    el.removeAttribute(key);
  } else {
    // 设置属性值
    el.setAttribute(key, value);
  }
}
