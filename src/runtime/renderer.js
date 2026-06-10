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

/**
 * 创建渲染器 —— 平台无关的核心函数
 *
 * 通过 options 参数注入平台特定的 DOM 操作，实现渲染逻辑与平台的解耦。
 * 这是 Vue3 自定义渲染器的设计核心：
 *   - 传入 Web DOM 操作 → 渲染到浏览器
 *   - 传入 Canvas 操作 → 渲染到 Canvas
 *   - 传入小程序操作 → 渲染到小程序
 *
 * @param options 平台操作接口（createElement, createText, insert, remove 等）
 * @returns { render } 对象，render(vnode, container) 用于渲染和更新
 */
export function createRenderer(options) {
  // 解构平台操作接口：
  const {
    createElement,   // 创建元素节点
    createText,      // 创建文本节点
    setText,         // 更新文本节点内容
    setElementText,  // 设置元素的文本内容
    insert,          // 插入节点到容器
    remove,          // 移除节点
    patchProp,       // 更新属性（class/style/事件/普通属性）
  } = options;

  /**
   * patch —— 渲染器的核心函数，对比新旧 vnode 并更新 DOM
   *
   * 职责：
   *   - n1 为 null：首次挂载，创建新 DOM
   *   - n1、n2 类型相同：复用 DOM，只更新差异部分
   *   - n1、n2 类型不同：卸载旧节点，挂载新节点
   *
   * @param n1        旧 vnode（null 表示首次挂载）
   * @param n2        新 vnode
   * @param container 父容器 DOM
   * @param anchor    插入参照节点（新节点会插入到 anchor 之前）
   */
  function patch(n1, n2, container, anchor = null) {
    // 类型检查：新旧 vnode 类型不同，无法复用，直接卸载旧的
    if (n1 && !isSameVNodeType(n1, n2)) {
      unmount(n1);
      n1 = null; // 置 null 后下面的逻辑会按「首次挂载」处理
    }

    const { type, shapeFlag } = n2;
    // 根据节点类型分发到对应的处理函数
    switch (type) {
      case Text:
        // 纯文本节点
        processText(n1, n2, container, anchor);
        break;
      case Fragment:
        // Fragment：多根节点的包裹容器（如 v-for 的结果）
        processFragment(n1, n2, container, anchor);
        break;
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          // 普通 HTML 元素
          processElement(n1, n2, container, anchor);
        } else if (shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
          // 组件
          processComponent(n1, n2, container, anchor);
        }
    }
  }

  // ---------- 文本节点处理 ----------
  function processText(n1, n2, container, anchor) {
    if (n1 == null) {
      // 首次挂载：创建文本节点并插入容器
      n2.el = createText(n2.children);
      insert(n2.el, container, anchor);
    } else {
      // 更新：复用旧 DOM 节点，只在文本内容变化时更新
      n2.el = n1.el;
      if (n2.children !== n1.children) setText(n2.el, n2.children);
    }
  }

  // ---------- Fragment（多根节点）处理 ----------
  // Fragment 本身不产生 DOM，只负责处理其子节点
  function processFragment(n1, n2, container, anchor) {
    if (n1 == null) {
      // 首次挂载：逐个挂载子节点
      mountChildren(n2.children, container, anchor);
    } else {
      // 更新：对子节点进行 diff
      patchChildren(n1, n2, container, anchor);
    }
  }

  // ---------- 普通元素处理 ----------
  function processElement(n1, n2, container, anchor) {
    if (n1 == null) {
      // 首次挂载：创建新元素
      mountElement(n2, container, anchor);
    } else {
      // 更新：复用旧元素，diff 属性和子节点
      patchElement(n1, n2);
    }
  }

  /**
   * 挂载元素节点：根据 vnode 创建真实 DOM 并插入容器
   * 流程：创建元素 → 处理子节点 → 设置属性 → 插入 DOM
   */
  function mountElement(vnode, container, anchor) {
    // 1. 创建真实 DOM 元素，并挂载到 vnode.el 上
    const el = (vnode.el = createElement(vnode.type));

    // 2. 处理子节点
    if (vnode.shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      // 文本子节点：直接设置元素文本
      setElementText(el, vnode.children);
    } else if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      // 数组子节点：递归挂载每个子节点
      mountChildren(vnode.children, el);
    }

    // 3. 设置属性（class、style、事件监听、普通属性等）
    for (const key in vnode.props) {
      patchProp(el, key, null, vnode.props[key]);
    }

    // 4. 插入到父容器中（anchor 之前）
    insert(el, container, anchor);
  }

  /**
   * 更新元素节点：复用旧 DOM，diff 属性和子节点
   */
  function patchElement(n1, n2) {
    // 复用旧元素的 DOM 节点
    const el = (n2.el = n1.el);
    // diff 属性：更新变化的属性，删除不再有的属性
    patchProps(el, n1.props, n2.props);
    // diff 子节点：核心算法，见 patchChildren
    patchChildren(n1, n2, el);
  }

  /**
   * diff 属性：对比新旧 props，更新/新增/删除属性
   */
  function patchProps(el, oldProps, newProps) {
    oldProps = oldProps || {};
    newProps = newProps || {};
    // 遍历新 props：更新变化的属性、新增属性
    for (const key in newProps) {
      if (newProps[key] !== oldProps[key]) {
        patchProp(el, key, oldProps[key], newProps[key]);
      }
    }
    // 遍历旧 props：删除新 props 中已不存在的属性
    for (const key in oldProps) {
      if (!(key in newProps)) {
        patchProp(el, key, oldProps[key], null); // null 表示删除
      }
    }
  }

  /**
   * 批量挂载子节点：逐个调用 patch 挂载
   */
  function mountChildren(children, container, anchor = null) {
    for (const child of children) {
      patch(null, child, container, anchor);
    }
  }

  // ---------- 子节点 diff（核心） ----------
  /**
   * diff 子节点：根据新旧子节点的类型组合，分发到不同的处理策略
   *
   * 组合情况：
   *   新=文本 + 旧=数组 → 卸载旧子节点，设置文本
   *   新=文本 + 旧=文本 → 直接更新文本
   *   新=数组 + 旧=数组 → 带 key 的数组 diff（最复杂）
   *   新=数组 + 旧=文本 → 清空文本，挂载新子节点
   */
  function patchChildren(n1, n2, container, anchor) {
    const prevShape = n1.shapeFlag;
    const nextShape = n2.shapeFlag;
    const c1 = n1.children;
    const c2 = n2.children;

    if (nextShape & ShapeFlags.TEXT_CHILDREN) {
      // 新的是文本子节点
      if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
        // 旧的是数组 → 先卸载所有旧的子节点
        unmountChildren(c1);
      }
      // 文本内容变化才更新
      if (c1 !== c2) setElementText(container, c2);
    } else {
      // 新的是数组子节点
      if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
        // 旧的也是数组 → 需要最复杂的「带 key 的数组 diff」
        patchKeyedChildren(c1, c2, container, anchor);
      } else {
        // 旧的是文本 → 先清空文本，再挂载新子节点
        setElementText(container, "");
        mountChildren(c2, container, anchor);
      }
    }
  }

  /**
   * 带 key 的子节点 diff —— 渲染器中最复杂的算法
   *
   * 算法流程：
   *   1. 头部同步：从头部开始，跳过相同类型的节点（已就位，只需 patch）
   *   2. 尾部同步：从尾部开始，跳过相同类型的节点
   *   3. 纯新增：旧节点已处理完，新的还有剩 → 全部挂载
   *   4. 纯删除：新节点已处理完，旧的还有剩 → 全部卸载
   *   5. 乱序处理：中间部分用 key 建立映射，计算最长递增子序列 (LIS)，
   *      只移动不在 LIS 中的节点，把 DOM 移动次数降到最低。
   */
  function patchKeyedChildren(c1, c2, container, parentAnchor) {
    let i = 0;
    let e1 = c1.length - 1;
    let e2 = c2.length - 1;

    // 1) 头部同步：从头部开始，跳过相同类型的节点
    //    这些节点位置不变，只需递归 patch 更新属性和子节点
    while (i <= e1 && i <= e2 && isSameVNodeType(c1[i], c2[i])) {
      patch(c1[i], c2[i], container);
      i++;
    }

    // 2) 尾部同步：从尾部开始，跳过相同类型的节点
    while (i <= e1 && i <= e2 && isSameVNodeType(c1[e1], c2[e2])) {
      patch(c1[e1], c2[e2], container);
      e1--;
      e2--;
    }

    if (i > e1) {
      // 3) 纯新增：旧的已处理完，新的还有剩
      //    剩余的新节点全部挂载
      if (i <= e2) {
        // 确定插入参照点：新节点插入到「已就位的下一个节点」之前
        const nextPos = e2 + 1;
        const anchor = nextPos < c2.length ? c2[nextPos].el : parentAnchor;
        while (i <= e2) {
          patch(null, c2[i], container, anchor);
          i++;
        }
      }
    } else if (i > e2) {
      // 4) 纯删除：新的已处理完，旧的还有剩
      //    剩余的旧节点全部卸载
      while (i <= e1) {
        unmount(c1[i]);
        i++;
      }
    } else {
      // 5) 乱序处理：中间部分新旧节点顺序不一致，
      //    需要通过 key 建立映射关系，确定哪些节点需要移动/新增/删除
      const s1 = i; // 旧节点未处理区间的起始索引
      const s2 = i; // 新节点未处理区间的起始索引

      // 建立「新节点 key → 新节点索引」的映射表，
      // 后续通过 key 快速找到旧节点在新列表中的位置
      const keyToNewIndex = new Map();
      for (let n = s2; n <= e2; n++) {
        const child = c2[n];
        if (child.key != null) keyToNewIndex.set(child.key, n);
      }

      const toBePatched = e2 - s2 + 1; // 需要 patch 的新节点数量
      let patched = 0; // 已 patch 的计数器
      // newIndexToOldIndex 数组：记录每个新节点对应的旧节点位置
      //   - 值为 0：表示新节点在旧列表中不存在（需要新增）
      //   - 值为 n+1：表示新节点对应旧列表中的第 n 个节点（+1 是为了区分 0）
      // 这个数组后续用于计算最长递增子序列 (LIS)
      const newIndexToOldIndex = new Array(toBePatched).fill(0);
      let moved = false;
      let maxNewIndexSoFar = 0;

      // 遍历旧节点，找它在新列表中的位置
      // 目的：建立 newIndexToOldIndex 映射，并 patch 可复用的节点
      for (let n = s1; n <= e1; n++) {
        const prevChild = c1[n];
        if (patched >= toBePatched) {
          // 优化：新节点已全部 patch 完，剩余旧节点无需再匹配，直接删除
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
          // 旧节点在新列表中不存在 → 删除
          unmount(prevChild);
        } else {
          // 记录映射关系：新节点 newIndex 对应旧节点 n+1
          newIndexToOldIndex[newIndex - s2] = n + 1;
          // 判断是否需要移动：如果新节点的索引不是递增的，说明需要移动
          if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex;
          } else {
            moved = true; // 出现逆序 → 说明有节点需要移动位置
          }
          // 递归 patch 可复用的节点（更新属性和子节点）
          patch(prevChild, c2[newIndex], container);
          patched++;
        }
      }

      // 计算最长递增子序列 (LIS)：
      // LIS 中的节点相对顺序未变，无需移动，只需移动不在 LIS 中的节点。
      // 例如：newIndexToOldIndex = [2, 5, 3, 4]
      //   LIS = [3, 4]（对应新节点索引 2、3）
      //   只需移动索引 0、1 的节点，索引 2、3 的节点保持不动
      const increasingSeq = moved
        ? getSequence(newIndexToOldIndex)
        : [];
      let seqEnd = increasingSeq.length - 1;

      // 从后往前遍历新节点，保证 anchor（参照节点）已就位
      // 倒序遍历的原因：插入时使用下一个节点作为参照（anchor），
      // 从后往前确保参照节点已在正确位置
      for (let n = toBePatched - 1; n >= 0; n--) {
        const newIndex = s2 + n;
        const newChild = c2[newIndex];
        const anchor =
          newIndex + 1 < c2.length ? c2[newIndex + 1].el : parentAnchor;

        if (newIndexToOldIndex[n] === 0) {
          // 新节点在旧列表中不存在 → 全新挂载
          patch(null, newChild, container, anchor);
        } else if (moved) {
          // 需要移动：不在 LIS 中的节点需要移动到正确位置
          if (seqEnd < 0 || n !== increasingSeq[seqEnd]) {
            // 不在 LIS 中 → 移动 DOM 节点到 anchor 之前
            insert(newChild.el, container, anchor);
          } else {
            // 在 LIS 中 → 位置正确，无需移动，seqEnd 前移
            seqEnd--;
          }
        }
      }
    }
  }

  // ---------- 组件处理 ----------
  /**
   * 处理组件 vnode：首次挂载 或 更新组件
   */
  function processComponent(n1, n2, container, anchor) {
    if (n1 == null) {
      mountComponent(n2, container, anchor);
    } else {
      updateComponent(n1, n2);
    }
  }

  /**
   * 挂载组件：创建实例 → setup → 建立渲染 effect
   */
  function mountComponent(vnode, container, anchor) {
    // 1. 创建组件实例，挂载到 vnode.component 上
    const instance = (vnode.component = createComponentInstance(vnode));
    // 2. 执行 setup()：初始化状态、props、编译 template 等
    setupComponent(instance);
    // 3. 建立渲染 effect：组件状态变化时自动重新渲染
    setupRenderEffect(instance, vnode, container, anchor);
  }

  /**
   * 建立组件的渲染 effect —— 组件自动更新的核心
   *
   * 创建一个 ReactiveEffect，其 fn 是组件的渲染逻辑：
   *   - 首次执行：调用 render() 生成 vnode 树，patch 到 DOM
   *   - 后续执行：重新调用 render()，diff 新旧 vnode 树，更新 DOM
   *
   * scheduler 将更新任务放入异步队列，避免同步更新造成的性能浪费。
   */
  function setupRenderEffect(instance, vnode, container, anchor) {
    // 组件的渲染逻辑，包裹在 effect 中：
    // 组件用到的响应式数据变化时，会自动触发这个函数重新执行
    const componentUpdate = () => {
      if (!instance.isMounted) {
        // 首次挂载：执行 beforeMount 钩子 → render → patch → mounted 钩子
        invokeHooks(instance.bm); // beforeMount 生命周期钩子
        // 调用组件的 render 函数，生成 vnode 树
        // ctx 是组件上下文，包含了 setupState + props
        const subTree = (instance.subTree = instance.render.call(
          instance.ctx,
          instance.ctx
        ));
        // 首次挂载：patch(null, subTree) 创建 DOM
        patch(null, subTree, container, anchor);
        vnode.el = subTree.el; // 组件 vnode 的 el 指向根元素
        instance.isMounted = true;
        invokeHooks(instance.m); // mounted 生命周期钩子
      } else {
        // 更新：执行 beforeUpdate 钩子 → render → patch → updated 钩子
        invokeHooks(instance.bu); // beforeUpdate 生命周期钩子
        // 重新调用 render 生成新的 vnode 树
        const nextTree = instance.render.call(instance.ctx, instance.ctx);
        const prevTree = instance.subTree;
        instance.subTree = nextTree;
        // diff 新旧 vnode 树，最小化 DOM 操作
        patch(prevTree, nextTree, container, anchor);
        vnode.el = nextTree.el;
        invokeHooks(instance.u); // updated 生命周期钩子
      }
    };

    // 创建 ReactiveEffect，其 scheduler 将更新任务放入异步队列：
    // 当响应式数据变化时，不立即同步执行 componentUpdate，
    // 而是通过 queueJob 入队，在微任务中批量执行，
    // 避免同一帧内多次数据变化导致多次渲染。
    const effect = new ReactiveEffect(componentUpdate, () =>
      queueJob(instance.update)
    );
    // instance.update 是绑定了 effect 的 run 函数，
    // 外部可以调用它手动触发组件重新渲染
    instance.update = effect.run.bind(effect);
    // 立即执行一次，完成首次挂载
    instance.update();
  }

  /**
   * 更新组件：复用实例，更新 props，由响应式系统触发重渲染
   */
  function updateComponent(n1, n2) {
    // 复用旧的组件实例（不重新 setup）
    const instance = (n2.component = n1.component);
    instance.vnode = n2;
    // 更新 props（props 是 reactive 的，赋值会触发 setter → trigger → 重渲染）
    const newProps = n2.props || {};
    for (const key in newProps) {
      instance.props[key] = newProps[key];
    }
  }

  // ---------- 卸载 ----------
  /**
   * 卸载 vnode：从 DOM 中移除对应的节点
   * 根据节点类型分发到不同的卸载策略
   */
  function unmount(vnode) {
    if (vnode.type === Fragment) {
      // Fragment：递归卸载所有子节点
      unmountChildren(vnode.children);
    } else if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
      // 组件：卸载其渲染出的子树
      unmount(vnode.component.subTree);
    } else {
      // 普通元素/文本：直接从 DOM 移除
      remove(vnode.el);
    }
  }

  /**
   * 批量卸载子节点
   */
  function unmountChildren(children) {
    for (const child of children) unmount(child);
  }

  /**
   * render —— 渲染器的对外接口
   *
   * 维护 container._vnode 缓存，实现增量更新：
   *   - 首次调用：patch(null, vnode) → 创建 DOM
   *   - 后续调用：patch(旧 vnode, 新 vnode) → diff 更新 DOM
   *   - 传 null：卸载已挂载的节点
   */
  function render(vnode, container) {
    if (vnode == null) {
      // 传入 null → 卸载已挂载的节点
      if (container._vnode) unmount(container._vnode);
    } else {
      // patch：对比旧 vnode（首次为 null）和新 vnode
      patch(container._vnode || null, vnode, container);
    }
    // 缓存本次 vnode，供下次 render 时作为“旧 vnode”进行 diff
    container._vnode = vnode;
  }

  return { render };
}

/**
 * 判断两个 vnode 是否是相同类型
 * 相同类型：type 相同 且 key 相同
 * 只有相同类型的 vnode 才能复用 DOM 进行 patch
 */
function isSameVNodeType(n1, n2) {
  return n1.type === n2.type && n1.key === n2.key;
}

/**
 * 求最长递增子序列 (LIS) —— diff 算法的关键辅助函数
 *
 * 输入：newIndexToOldIndex 数组，值为旧节点位置+1，0 表示新增
 * 输出：LIS 的下标数组，表示哪些节点的相对顺序不变（无需移动）
 *
 * 算法：耐心排序 (Patience Sorting) + 二分查找
 *   时间复杂度：O(n log n)
 *
 * 示例：
 *   输入 [2, 5, 3, 4, 0, 1]
 *   输出 [0, 2, 3]  （对应值 2, 3, 4，是最长递增子序列）
 */
function getSequence(arr) {
  // result 存储 LIS 的下标，初始包含第一个有效元素的下标
  const result = [0];
  // p 数组用于回溯还原完整序列，p[i] 记录序列中 arr[i] 的前驱下标
  const p = arr.slice();
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const arrI = arr[i];
    if (arrI === 0) continue; // 0 表示新增节点，不参与 LIS 计算
    const last = result[result.length - 1];
    if (arr[last] < arrI) {
      // 当前值比 LIS 最后一个值还大 → 直接追加，延长 LIS
      p[i] = last; // 记录前驱，用于回溯
      result.push(i);
      continue;
    }
    // 二分查找：在 result 中找到第一个比 arrI 大的位置，替换之
    // 这保证了 LIS 的递增性，同时让序列尽可能短
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
  // 回溯还原完整的 LIS 下标序列
  // result 中存储的是“末尾元素下标”，需要通过 p 数组回溯得到完整序列
  let u = result.length;
  let v = result[u - 1];
  while (u-- > 0) {
    result[u] = v;
    v = p[v];
  }
  return result;
}
