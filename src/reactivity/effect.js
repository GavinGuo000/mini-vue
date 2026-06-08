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

// 当前正在运行的 effect，用一个全局变量来「桥接」getter 和 effect
let activeEffect = undefined;

// effect 栈，处理 effect 嵌套（如组件嵌套渲染）的场景
const effectStack = [];

// 依赖关系存储结构：
//   targetMap: WeakMap<target, depsMap>
//   depsMap:   Map<key, dep>
//   dep:       Set<ReactiveEffect>
const targetMap = new WeakMap();

export class ReactiveEffect {
  constructor(fn, scheduler = null) {
    this.fn = fn;
    // scheduler：当依赖变化时，不直接执行 fn，而是把控制权交给 scheduler。
    // computed / watch / 组件异步更新都依赖这个机制。
    this.scheduler = scheduler;
    this.deps = []; // 反向记录「哪些 dep 收集了我」，用于清理
    this.active = true;
  }

  run() {
    if (!this.active) return this.fn();

    try {
      effectStack.push(this);
      activeEffect = this;
      // 每次运行前先清空旧依赖，避免分支切换导致的「失效依赖」残留
      cleanup(this);
      return this.fn();
    } finally {
      effectStack.pop();
      activeEffect = effectStack[effectStack.length - 1];
    }
  }

  stop() {
    if (this.active) {
      cleanup(this);
      this.active = false;
    }
  }
}

function cleanup(effect) {
  const { deps } = effect;
  for (const dep of deps) {
    dep.delete(effect);
  }
  deps.length = 0;
}

export function effect(fn, options = {}) {
  const _effect = new ReactiveEffect(fn, options.scheduler);
  if (!options.lazy) {
    _effect.run();
  }
  const runner = _effect.run.bind(_effect);
  runner.effect = _effect;
  return runner;
}

// ---- 依赖收集 ----
export function track(target, key) {
  if (!activeEffect) return; // 没有正在运行的 effect，无需收集

  let depsMap = targetMap.get(target);
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()));
  }
  let dep = depsMap.get(key);
  if (!dep) {
    depsMap.set(key, (dep = new Set()));
  }
  trackEffects(dep);
}

export function trackEffects(dep) {
  if (!activeEffect) return;
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect);
    activeEffect.deps.push(dep); // 双向记录，便于 cleanup
  }
}

// ---- 派发更新 ----
export function trigger(target, key) {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;
  const dep = depsMap.get(key);
  triggerEffects(dep);
}

export function triggerEffects(dep) {
  if (!dep) return;
  // 拷贝一份再遍历，避免「执行过程中又修改 dep」造成无限循环
  for (const effect of [...dep]) {
    // 避免自己触发自己（如在 effect 里同时读写同一个值）
    if (effect === activeEffect) continue;
    if (effect.scheduler) {
      effect.scheduler();
    } else {
      effect.run();
    }
  }
}
