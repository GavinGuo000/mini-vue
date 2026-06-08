// ============================================================
// 调度器 (scheduler) —— 异步批量更新
// ============================================================
//
// 为什么需要它？
//   如果在一个同步任务里连续修改多次数据，每次都立刻重渲染会很浪费。
//   Vue 把更新任务放进队列去重，并在「微任务」里一次性刷新，
//   保证一帧内只渲染一次（这就是 nextTick 的底层）。

const queue = [];
let isFlushing = false;
const resolvedPromise = Promise.resolve();

export function queueJob(job) {
  if (!queue.includes(job)) {
    queue.push(job);
  }
  queueFlush();
}

function queueFlush() {
  if (isFlushing) return;
  isFlushing = true;
  resolvedPromise.then(flushJobs);
}

function flushJobs() {
  try {
    for (let i = 0; i < queue.length; i++) {
      queue[i]();
    }
  } finally {
    isFlushing = false;
    queue.length = 0;
  }
}

// nextTick：在下一次 DOM 更新完成后执行回调
export function nextTick(fn) {
  return fn ? resolvedPromise.then(fn) : resolvedPromise;
}
