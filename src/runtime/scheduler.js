// ============================================================
// 调度器 (scheduler) —— 异步批量更新
// ============================================================
//
// 为什么需要它？
//   如果在一个同步任务里连续修改多次数据，每次都立刻重渲染会很浪费。
//   Vue 把更新任务放进队列去重，并在「微任务」里一次性刷新，
//   保证一帧内只渲染一次（这就是 nextTick 的底层）。

// 更新任务队列：存储待执行的组件更新函数
// 使用 includes() 去重，确保同一个组件在一次微任务中只更新一次
const queue = [];
// 是否已调度刷新：避免重复创建微任务
let isFlushing = false;
// 复用的已解析 Promise，用于创建微任务（比 setTimeout(fn, 0) 更快）
const resolvedPromise = Promise.resolve();

/**
 * 将更新任务加入队列
 *
 * 每个组件有自己的 update 函数，当响应式数据变化时，
 * effect 的 scheduler 会调用 queueJob(instance.update)，
 * 将更新任务入队，等待微任务批量执行。
 *
 * 去重机制：同一个 update 函数只会被加入一次，
 * 即使同一帧内多次触发数据变化，组件也只渲染一次。
 *
 * @param job 组件更新函数
 */
export function queueJob(job) {
  if (!queue.includes(job)) {
    queue.push(job);
  }
  queueFlush();
}

/**
 * 调度刷新：在微任务中批量执行队列中的所有更新
 *
 * 使用 isFlushing 标志避免重复创建微任务：
 *   - 第一次调用：创建微任务，设置 isFlushing = true
 *   - 后续调用：微任务已创建，无需重复创建
 */
function queueFlush() {
  if (isFlushing) return;
  isFlushing = true;
  // 利用 Promise.then 创建微任务，在当前同步任务完成后执行
  resolvedPromise.then(flushJobs);
}

/**
 * 批量执行队列中的所有更新任务
 * 在微任务中执行，保证 DOM 更新是在同步代码之后批量完成的
 */
function flushJobs() {
  try {
    for (let i = 0; i < queue.length; i++) {
      queue[i](); // 执行组件更新函数
    }
  } finally {
    // 无论成功或失败，都要重置状态
    isFlushing = false;
    queue.length = 0; // 清空队列
  }
}

/**
 * nextTick —— 在下一次 DOM 更新完成后执行回调
 *
 * 原理：在队列刷新完成后（微任务已执行），
 * 再添加一个微任务执行用户的回调，此时 DOM 已更新完毕。
 *
 * @param fn 回调函数（可选）
 * @returns Promise
 *
 * 用法：
 *   state.count++;
 *   await nextTick();  // 等待 DOM 更新
 *   console.log(document.getElementById('count').textContent); // 已更新
 */
export function nextTick(fn) {
  return fn ? resolvedPromise.then(fn) : resolvedPromise;
}
