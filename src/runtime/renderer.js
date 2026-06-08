// ============================================================
// 渲染器 (renderer) —— 把 vnode 变成真实 DOM，并负责 diff 更新
// ============================================================
//
// 核心三件事：
//   1. mount：首次渲染，根据 vnode 创建真实节点并插入页面。
//   2. patch：再次渲染时，对比新旧 vnode，只更新「变化的部分」。
//   3. unmount：移除不再需要的节点。
//
// patch 的关键是「diff」：相同位置的新旧节点尽量复用，子节点用 key 做最优匹配。

import { ShapeFlags, Text, Fragment } from "./vnode.js";
import { ReactiveEffect } from "../reactivity/effect.js";
import { queueJob } from "./scheduler.js";
import {
  createComponentInstance,
  setupComponent,
  invokeHooks,
} from "./component.js";

export function createRenderer(options) {
  const {
    createElement,
    createText,
    setText,
    setElementText,
    insert,
    remove,
    patchProp,
  } = options;

  // n1: 旧 vnode（null 表示首次挂载）；n2: 新 vnode
  function patch(n1, n2, container, anchor = null) {
    if (n1 && !isSameVNodeType(n1, n2)) {
      // 类型不同，无法复用，直接卸载旧的
      unmount(n1);
      n1 = null;
    }

    const { type, shapeFlag } = n2;
    switch (type) {
      case Text:
        processText(n1, n2, container, anchor);
        break;
      case Fragment:
        processFragment(n1, n2, container, anchor);
        break;
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          processElement(n1, n2, container, anchor);
        } else if (shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
          processComponent(n1, n2, container, anchor);
        }
    }
  }

  // ---------- 文本 ----------
  function processText(n1, n2, container, anchor) {
    if (n1 == null) {
      n2.el = createText(n2.children);
      insert(n2.el, container, anchor);
    } else {
      n2.el = n1.el;
      if (n2.children !== n1.children) setText(n2.el, n2.children);
    }
  }

  // ---------- Fragment（多根节点） ----------
  function processFragment(n1, n2, container, anchor) {
    if (n1 == null) {
      mountChildren(n2.children, container, anchor);
    } else {
      patchChildren(n1, n2, container, anchor);
    }
  }

  // ---------- 普通元素 ----------
  function processElement(n1, n2, container, anchor) {
    if (n1 == null) {
      mountElement(n2, container, anchor);
    } else {
      patchElement(n1, n2);
    }
  }

  function mountElement(vnode, container, anchor) {
    const el = (vnode.el = createElement(vnode.type));

    // 子节点
    if (vnode.shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      setElementText(el, vnode.children);
    } else if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      mountChildren(vnode.children, el);
    }

    // 属性
    for (const key in vnode.props) {
      patchProp(el, key, null, vnode.props[key]);
    }

    insert(el, container, anchor);
  }

  function patchElement(n1, n2) {
    const el = (n2.el = n1.el);
    patchProps(el, n1.props, n2.props);
    patchChildren(n1, n2, el);
  }

  function patchProps(el, oldProps, newProps) {
    oldProps = oldProps || {};
    newProps = newProps || {};
    // 更新 / 新增
    for (const key in newProps) {
      if (newProps[key] !== oldProps[key]) {
        patchProp(el, key, oldProps[key], newProps[key]);
      }
    }
    // 删除新 props 里没有的
    for (const key in oldProps) {
      if (!(key in newProps)) {
        patchProp(el, key, oldProps[key], null);
      }
    }
  }

  function mountChildren(children, container, anchor = null) {
    for (const child of children) {
      patch(null, child, container, anchor);
    }
  }

  // ---------- 子节点 diff（核心） ----------
  function patchChildren(n1, n2, container, anchor) {
    const prevShape = n1.shapeFlag;
    const nextShape = n2.shapeFlag;
    const c1 = n1.children;
    const c2 = n2.children;

    if (nextShape & ShapeFlags.TEXT_CHILDREN) {
      // 新的是文本
      if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
        unmountChildren(c1);
      }
      if (c1 !== c2) setElementText(container, c2);
    } else {
      // 新的是数组
      if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
        // 旧的也是数组 → 需要最复杂的「带 key 的数组 diff」
        patchKeyedChildren(c1, c2, container, anchor);
      } else {
        // 旧的是文本 → 先清空再挂载
        setElementText(container, "");
        mountChildren(c2, container, anchor);
      }
    }
  }

  // 带 key 的双端 + 最长递增子序列 diff
  function patchKeyedChildren(c1, c2, container, parentAnchor) {
    let i = 0;
    let e1 = c1.length - 1;
    let e2 = c2.length - 1;

    // 1) 从头部开始，跳过相同节点
    while (i <= e1 && i <= e2 && isSameVNodeType(c1[i], c2[i])) {
      patch(c1[i], c2[i], container);
      i++;
    }

    // 2) 从尾部开始，跳过相同节点
    while (i <= e1 && i <= e2 && isSameVNodeType(c1[e1], c2[e2])) {
      patch(c1[e1], c2[e2], container);
      e1--;
      e2--;
    }

    if (i > e1) {
      // 3) 旧的处理完了，新的还有剩 → 全部是新增
      if (i <= e2) {
        const nextPos = e2 + 1;
        const anchor = nextPos < c2.length ? c2[nextPos].el : parentAnchor;
        while (i <= e2) {
          patch(null, c2[i], container, anchor);
          i++;
        }
      }
    } else if (i > e2) {
      // 4) 新的处理完了，旧的还有剩 → 全部删除
      while (i <= e1) {
        unmount(c1[i]);
        i++;
      }
    } else {
      // 5) 中间乱序部分：用 key 建立映射，复用 / 移动 / 增删
      const s1 = i;
      const s2 = i;

      // 新节点 key → index 的映射
      const keyToNewIndex = new Map();
      for (let n = s2; n <= e2; n++) {
        const child = c2[n];
        if (child.key != null) keyToNewIndex.set(child.key, n);
      }

      const toBePatched = e2 - s2 + 1;
      let patched = 0;
      // newIndexToOldIndex[i] 记录新节点对应的旧节点位置(+1)，0 表示新增
      const newIndexToOldIndex = new Array(toBePatched).fill(0);
      let moved = false;
      let maxNewIndexSoFar = 0;

      // 遍历旧节点，找它在新列表中的位置
      for (let n = s1; n <= e1; n++) {
        const prevChild = c1[n];
        if (patched >= toBePatched) {
          // 新节点已全部 patch 完，剩余旧节点都该删除
          unmount(prevChild);
          continue;
        }

        let newIndex;
        if (prevChild.key != null) {
          newIndex = keyToNewIndex.get(prevChild.key);
        } else {
          // 无 key：在剩余新节点里找同类型的
          for (let m = s2; m <= e2; m++) {
            if (
              newIndexToOldIndex[m - s2] === 0 &&
              isSameVNodeType(prevChild, c2[m])
            ) {
              newIndex = m;
              break;
            }
          }
        }

        if (newIndex === undefined) {
          unmount(prevChild); // 旧节点在新列表里不存在 → 删除
        } else {
          newIndexToOldIndex[newIndex - s2] = n + 1;
          if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex;
          } else {
            moved = true; // 出现逆序 → 需要移动
          }
          patch(prevChild, c2[newIndex], container);
          patched++;
        }
      }

      // 计算最长递增子序列：这些节点的相对顺序不变，无需移动
      const increasingSeq = moved
        ? getSequence(newIndexToOldIndex)
        : [];
      let seqEnd = increasingSeq.length - 1;

      // 从后往前遍历，保证 anchor（参照节点）已就位
      for (let n = toBePatched - 1; n >= 0; n--) {
        const newIndex = s2 + n;
        const newChild = c2[newIndex];
        const anchor =
          newIndex + 1 < c2.length ? c2[newIndex + 1].el : parentAnchor;

        if (newIndexToOldIndex[n] === 0) {
          // 全新节点 → 挂载
          patch(null, newChild, container, anchor);
        } else if (moved) {
          // 不在最长递增子序列里 → 需要移动
          if (seqEnd < 0 || n !== increasingSeq[seqEnd]) {
            insert(newChild.el, container, anchor);
          } else {
            seqEnd--;
          }
        }
      }
    }
  }

  // ---------- 组件 ----------
  function processComponent(n1, n2, container, anchor) {
    if (n1 == null) {
      mountComponent(n2, container, anchor);
    } else {
      updateComponent(n1, n2);
    }
  }

  function mountComponent(vnode, container, anchor) {
    const instance = (vnode.component = createComponentInstance(vnode));
    setupComponent(instance);
    setupRenderEffect(instance, vnode, container, anchor);
  }

  function setupRenderEffect(instance, vnode, container, anchor) {
    // 组件的渲染包在一个 effect 里：组件用到的响应式数据变化 → 自动重渲染。
    const componentUpdate = () => {
      if (!instance.isMounted) {
        invokeHooks(instance.bm); // beforeMount
        const subTree = (instance.subTree = instance.render.call(
          instance.ctx,
          instance.ctx
        ));
        patch(null, subTree, container, anchor);
        vnode.el = subTree.el;
        instance.isMounted = true;
        invokeHooks(instance.m); // mounted
      } else {
        invokeHooks(instance.bu); // beforeUpdate
        const nextTree = instance.render.call(instance.ctx, instance.ctx);
        const prevTree = instance.subTree;
        instance.subTree = nextTree;
        patch(prevTree, nextTree, container, anchor);
        vnode.el = nextTree.el;
        invokeHooks(instance.u); // updated
      }
    };

    // scheduler：数据变化时不同步执行，而是丢进调度队列异步批量更新
    const effect = new ReactiveEffect(componentUpdate, () =>
      queueJob(instance.update)
    );
    instance.update = effect.run.bind(effect);
    instance.update();
  }

  function updateComponent(n1, n2) {
    // 简化：复用实例，更新 props 后由响应式触发重渲染
    const instance = (n2.component = n1.component);
    instance.vnode = n2;
    const newProps = n2.props || {};
    for (const key in newProps) {
      instance.props[key] = newProps[key];
    }
  }

  // ---------- 卸载 ----------
  function unmount(vnode) {
    if (vnode.type === Fragment) {
      unmountChildren(vnode.children);
    } else if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
      unmount(vnode.component.subTree);
    } else {
      remove(vnode.el);
    }
  }

  function unmountChildren(children) {
    for (const child of children) unmount(child);
  }

  function render(vnode, container) {
    if (vnode == null) {
      // 传入 null → 卸载
      if (container._vnode) unmount(container._vnode);
    } else {
      patch(container._vnode || null, vnode, container);
    }
    container._vnode = vnode; // 缓存本次 vnode，供下次 diff
  }

  return { render };
}

function isSameVNodeType(n1, n2) {
  return n1.type === n2.type && n1.key === n2.key;
}

// 求最长递增子序列，返回的是「下标」数组。
// diff 中用它找出「无需移动」的节点，把 DOM 移动次数降到最低。
function getSequence(arr) {
  const result = [0];
  const p = arr.slice();
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const arrI = arr[i];
    if (arrI === 0) continue; // 0 表示新增节点，跳过
    const last = result[result.length - 1];
    if (arr[last] < arrI) {
      p[i] = last;
      result.push(i);
      continue;
    }
    // 二分查找第一个比 arrI 大的位置并替换
    let lo = 0;
    let hi = result.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[result[mid]] < arrI) lo = mid + 1;
      else hi = mid;
    }
    if (arrI < arr[result[lo]]) {
      if (lo > 0) p[i] = result[lo - 1];
      result[lo] = i;
    }
  }
  // 回溯还原序列
  let u = result.length;
  let v = result[u - 1];
  while (u-- > 0) {
    result[u] = v;
    v = p[v];
  }
  return result;
}
