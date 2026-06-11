// ============================================================
// 副作用 (effect) —— 响应式系统的「依赖收集 / 派发更新」核心
// ============================================================
//
// 原理：
//   1. 一个 effect 就是一段「会读取响应式数据」的函数。
//   2. 运行 effect 时，把它设为「当前正在运行的 effect」(activeEffect)。
//   3. 读取响应式数据 → 触发 getter → track() 把 activeEffect 收集到
//      这条数据对应的「依赖集合 (dep)」里。
//   4. 修改响应式数据 → 触发 setter → trigger() 取出 dep 里所有 effect
//      并重新执行，从而实现「数据变 → 视图/计算自动更新」。

// 当前正在运行的 effect，用一个全局变量来「桥接」getter 和 effect。
// 当 Proxy 的 get 拦截器被触发时，它通过这个全局变量知道
// "现在是哪个 effect 在读取我"，从而把这个 effect 收集进依赖集合。
let activeEffect = undefined;

// effect 栈，处理 effect 嵌套（如组件嵌套渲染）的场景。
// 举例：父组件的 render effect 里触发了子组件的 render effect，
// 此时 activeEffect 应该是子组件的 effect；子组件执行完出栈后
// 恢复为父组件的 effect。栈结构保证了「后进先出」的正确性。
const effectStack = [];

// 依赖关系存储结构：
//   targetMap: WeakMap<target, depsMap>
//   depsMap:   Map<key, dep>
//   dep:       Set<ReactiveEffect>
const targetMap = new WeakMap();

// ReactiveEffect {
//   fn: componentUpdate,        // 核心：组件渲染函数 / watch回调 / computed求值函数
//   scheduler: () => queueJob(instance.update), // 调度器，数据变化不走同步执行，推入异步队列
//   deps: [Set(), Set(), Set()],// 反向依赖：记录自己被哪些dep收集，用于cleanup清理
//   active: true                // 是否激活，stop后变为false
// }
export class ReactiveEffect {
  constructor(fn, scheduler = null) {
    this.fn = fn;
    // scheduler：当依赖变化时，不直接执行 fn，而是把控制权交给 scheduler。
    // computed / watch / 组件异步更新都依赖这个机制。
    this.scheduler = scheduler;
    // 收集反向依赖的数组。每个 dep 是一个 Set<ReactiveEffect>。
    // 为什么要反向记录？因为当 effect 重新执行（run）时需要先清理旧依赖
    // 再重新收集，否则条件分支切换后残留的「不再被访问的依赖」
    // 还会触发无效的更新（经典的"过度渲染"问题）。
    this.deps = [];
    // 标记当前 effect 是否处于激活状态。
    // 调用 stop() 后变为 false，后续 run() 不再进行依赖收集。
    this.active = true;
  }

  run() {
    // 如果 effect 已停止（stop），直接执行函数即可，
    // 不做依赖收集（因为不需要再响应变化了）
    if (!this.active) return this.fn();

    try {
      // 1. 入栈：把自己设为当前活跃的 effect
      effectStack.push(this);
      activeEffect = this;
      // 2. 清理旧的依赖关系，避免分支切换导致的「失效依赖」残留。
      //    例：if(flag) read a; else read b;
      //    当 flag 从 true 变 false 后，a 的 dep 里不应该还留着我。
      cleanup(this);
      // 3. 执行用户函数。执行过程中读取响应式数据 → 触发 getter → track()
      //    重新建立依赖关系。
      return this.fn();
    } finally {
      // 4. 出栈：恢复上一层的 activeEffect（支持嵌套 effect）
      effectStack.pop();
      activeEffect = effectStack[effectStack.length - 1];
    }
  }

  // 停止响应：清理所有依赖并标记为不活跃
  stop() {
    if (this.active) {
      cleanup(this);
      this.active = false;
    }
  }
}

// 清理 effect 的所有依赖：从每个 dep（Set）中移除自己。
// 这个操作和 run() 中的「重新收集」配合使用，保证每次 run
// 之后 dep 里只包含真正被访问过的数据。
function cleanup(effect) {
  const { deps } = effect;
  for (const dep of deps) {
    dep.delete(effect); // 从依赖集合中移除
  }
  deps.length = 0; // 清空反向引用数组
}

// 便捷 API：创建一个 effect 并立即执行（除非 options.lazy = true）。
// options:
//   - lazy: 是否延迟执行（computed 需要 lazy）
//   - scheduler: 自定义调度器（当依赖变化时，不直接 run，而是调用 scheduler）
// 返回值 runner 是一个函数，调用它等于执行 _effect.run()。
// runner.effect 可以拿到原始的 ReactiveEffect 实例（用于 stop 等操作）。
export function effect(fn, options = {}) {
  const _effect = new ReactiveEffect(fn, options.scheduler);
  // 非 lazy 模式下立即执行一次，完成首次依赖收集
  if (!options.lazy) {
    _effect.run();
  }
  // 把 run 方法绑到 _effect 上，方便外部直接调用
  const runner = _effect.run.bind(_effect);
  runner.effect = _effect; // 暴露原始实例，便于 stop 等操作
  return runner;
}

// ---- 依赖收集（在 Proxy getter 中调用） ----
// 当某个响应式数据的属性被读取时，把当前 activeEffect
// 添加到该属性的依赖集合（dep）中。
// target: 原始对象; key: 被访问的属性名
export function track(target, key) {
  if (!activeEffect) return; // 没有正在运行的 effect，无需收集

  // 懒初始化：第一次访问某对象时才创建它的 depsMap
  let depsMap = targetMap.get(target);
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()));
  }
  // 懒初始化：第一次访问某属性时才创建它的 dep (Set)
  let dep = depsMap.get(key);
  if (!dep) {
    depsMap.set(key, (dep = new Set()));
  }
  // 把 activeEffect 加入 dep
  trackEffects(dep);
}

// 将 activeEffect 加入指定的依赖集合 dep。
// 这个函数被 track() 和 ref/computed 共用（ref 不走 targetMap，
// 每个 ref 有自己的 dep）。
export function trackEffects(dep) {
  if (!activeEffect) return;
  // 避免重复添加同一个 effect
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect);
    // 双向记录：让 effect 也知道自己被这个 dep 收集了，
    // 后续 cleanup 时 effect 可以遍历自己的 deps 来逐一移除。
    activeEffect.deps.push(dep);
  }
}

// ---- 派发更新（在 Proxy setter 中调用） ----
// 当某个响应式数据的属性被修改时，取出该属性对应的依赖集合，
// 逐一执行里面的 effect（或其 scheduler）。
export function trigger(target, key) {
  const depsMap = targetMap.get(target);
  if (!depsMap) return; // 没人依赖过这个对象，无需触发
  const dep = depsMap.get(key);
  triggerEffects(dep);
}

// 执行依赖集合中所有 effect 的更新。
// 被 trigger() 和 ref/computed 共用。
export function triggerEffects(dep) {
  if (!dep) return;
  // 先拷贝再遍历：因为执行 effect.run() 的过程中可能会再次触发
  // trigger（比如在 effect 里写数据），直接遍历原始 Set 会导致
  // "Set modified during iteration" 的无限循环。
  for (const effect of [...dep]) {
    // 避免自己触发自己。
    // 场景：effect 里同时读写同一个值 → setter 触发 trigger →
    // 又执行自己 → 又写 → 又触发... 死循环。
    if (effect === activeEffect) continue;
    // 如果有 scheduler，走调度路径（如 computed 的惰性更新、
    // 组件的异步批量更新），否则直接同步执行。
    if (effect.scheduler) {
      effect.scheduler();
    } else {
      effect.run();
    }
  }
}
