// ============================================================
// 平台操作 —— 把「怎么操作 DOM」与「diff 算法」解耦
// ============================================================
//
// 渲染器(renderer)只关心 diff 逻辑，所有真实 DOM 操作都通过这组接口完成。
// 换一组接口就能渲染到别的平台（canvas / 小程序 / SSR），这就是
// Vue3 "自定义渲染器(createRenderer)" 的设计思想。

export const nodeOps = {
  createElement(tag) {
    return document.createElement(tag);
  },
  createText(text) {
    return document.createTextNode(text);
  },
  setText(node, text) {
    node.nodeValue = text;
  },
  setElementText(el, text) {
    el.textContent = text;
  },
  insert(child, parent, anchor = null) {
    parent.insertBefore(child, anchor);
  },
  remove(child) {
    const parent = child.parentNode;
    if (parent) parent.removeChild(child);
  },
  // 处理属性 / 事件 / class / style 的增删改
  patchProp(el, key, prevValue, nextValue) {
    if (key === "class") {
      el.className = nextValue || "";
    } else if (key === "style") {
      patchStyle(el, prevValue, nextValue);
    } else if (isEvent(key)) {
      patchEvent(el, key, nextValue);
    } else {
      patchAttr(el, key, nextValue);
    }
  },
};

function isEvent(key) {
  return /^on[A-Z]/.test(key);
}

function patchStyle(el, prev, next) {
  next = next || {};
  for (const key in next) {
    el.style[key] = next[key];
  }
  if (prev) {
    for (const key in prev) {
      if (!(key in next)) el.style[key] = "";
    }
  }
}

function patchEvent(el, rawName, handler) {
  const invokers = el._vei || (el._vei = {});
  const eventName = rawName.slice(2).toLowerCase(); // onClick → click
  const existing = invokers[rawName];

  if (handler) {
    if (existing) {
      // 复用同一个 invoker，仅替换内部真实回调 → 避免反复 add/removeEventListener
      existing.value = handler;
    } else {
      const invoker = (invokers[rawName] = (e) => invoker.value(e));
      invoker.value = handler;
      el.addEventListener(eventName, invoker);
    }
  } else if (existing) {
    el.removeEventListener(eventName, existing);
    invokers[rawName] = undefined;
  }
}

function patchAttr(el, key, value) {
  if (value == null || value === false) {
    el.removeAttribute(key);
  } else {
    el.setAttribute(key, value);
  }
}
