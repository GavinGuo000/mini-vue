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

class ComputedRefImpl {
  constructor(getter) {
    this.__v_isRef = true;
    this._dirty = true; // 是否需要重新计算
    this._value = undefined;
    this.dep = new Set(); // 读取 computed 的 effect 们

    this.effect = new ReactiveEffect(getter, () => {
      // 依赖变化时触发：标脏 + 通知依赖本 computed 的 effect
      if (!this._dirty) {
        this._dirty = true;
        triggerEffects(this.dep);
      }
    });
  }

  get value() {
    // 谁读取了我，就把谁收集进来
    trackEffects(this.dep);
    if (this._dirty) {
      this._dirty = false;
      this._value = this.effect.run();
    }
    return this._value;
  }
}

export function computed(getterOrOptions) {
  // 支持 computed(() => ...) 和 computed({ get, set })
  const getter =
    typeof getterOrOptions === "function"
      ? getterOrOptions
      : getterOrOptions.get;
  return new ComputedRefImpl(getter);
}
