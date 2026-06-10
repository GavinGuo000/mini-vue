// ============================================================
// computed —— 带缓存的派生值
// ============================================================
//
// 原理：computed 内部是一个「lazy + 带 scheduler」的 effect。
//   - lazy：创建时不立即求值，第一次读 .value 才计算。
//   - 缓存：用 _dirty 标志位记录依赖是否变化；没变就直接返回缓存。
//   - 依赖变化时，scheduler 只把 _dirty 置为 true 并通知上层，
//     不会立刻重算 → 实现「惰性求值 + 缓存」。

import { ReactiveEffect, trackEffects, triggerEffects } from "./effect.js";

/**
 * computed 的内部实现类
 *
 * 与 ref 类似，computed 也对外暴露 .value 接口，但其值是「派生」的：
 *   - 内部有一个 ReactiveEffect，其 fn 就是用户传入的 getter。
 *   - 这个 effect 是 lazy 的（创建时不执行），第一次读取 .value 才计算。
 *   - 当 getter 依赖的响应式数据变化时，effect 的 scheduler 被调用，
 *     仅仅把 _dirty 标为 true，不会立即重算。
 *   - 下次读取 .value 时，发现 _dirty === true 才真正重新计算。
 *
 * 这种设计实现了「惰性求值 + 缓存」：
 *   - 即使依赖变化了 100 次，只要没有人读取 .value，就不会重算。
 *   - 多次读取 .value 而依赖未变时，直接返回缓存。
 */
class ComputedRefImpl {
  constructor(getter) {
    // 与 ref 兼容：外部可以通过 isRef(computedRef) 判断
    this.__v_isRef = true;
    // 脏标记：true 表示依赖已变化，需要重新计算
    // 初始为 true，保证第一次读取时会执行计算
    this._dirty = true;
    // 缓存的计算结果
    this._value = undefined;
    // 依赖集合：存储「谁读取了我」（如组件的渲染 effect）。
    // 当 computed 的值变化时，需要通知这些 effect 重新执行。
    this.dep = new Set();

    // 创建内部的 ReactiveEffect：
    // - fn = getter：执行时会读取响应式数据，从而收集依赖
    // - scheduler：当依赖变化时不立即重算，而是标脏 + 通知上层
    this.effect = new ReactiveEffect(getter, () => {
      // scheduler 回调：依赖的响应式数据发生了变化
      if (!this._dirty) {
        // 标脏：告诉 .value getter 下次需要重新计算
        this._dirty = true;
        // 派发更新：通知所有依赖本 computed 的 effect（如渲染 effect）
        // 它们收到通知后会重新执行，重新执行时会读取 computed.value，
        // 从而触发重新计算。
        triggerEffects(this.dep);
      }
    });
  }

  /**
   * getter：读取 computed.value 时触发
   * 做了两件事：
   *   1. 依赖收集：将读取我的 effect 加入 dep
   *   2. 惰性计算：如果 dirty 则重新执行 getter，否则返回缓存
   */
  get value() {
    // 依赖收集：谁读取了我，就把谁加入 dep。
    // 这样当 computed 重新计算出新值时，能通知到这些 effect。
    trackEffects(this.dep);
    if (this._dirty) {
      // 需要重新计算：执行 effect.run()，它会执行 getter 并收集依赖
      this._dirty = false; // 重置脏标记
      this._value = this.effect.run(); // 执行计算，更新缓存
    }
    // 不需要重新计算：直接返回缓存值
    return this._value;
  }
}

/**
 * 创建一个 computed 计算属性
 *
 * 支持两种调用方式：
 *   computed(() => state.count * 2)           // 简写：只传 getter
 *   computed({ get: () => ..., set: (v) => ... }) // 完整形式（本实现简化，未处理 set）
 *
 * @param getterOrOptions getter 函数或 { get, set } 对象
 * @returns ComputedRefImpl 实例，通过 .value 读取派生值
 *
 * 用法示例：
 *   const state = reactive({ count: 1 });
 *   const double = computed(() => state.count * 2);
 *   console.log(double.value); // 2
 *   state.count = 5;
 *   console.log(double.value); // 10
 */
export function computed(getterOrOptions) {
  // 兼容两种调用方式：
  // - 函数：直接作为 getter
  // - 对象：取其 .get 属性作为 getter
  const getter =
    typeof getterOrOptions === "function"
      ? getterOrOptions
      : getterOrOptions.get;
  return new ComputedRefImpl(getter);
}
