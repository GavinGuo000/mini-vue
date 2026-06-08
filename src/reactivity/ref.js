// ============================================================
// ref —— 让「基本类型」也能响应式
// ============================================================
//
// 为什么需要 ref？
//   Proxy 只能代理对象，无法代理 number / string / boolean 等原始值。
//   ref 用一个「带 .value 的对象」把原始值包裹起来：
//     - 读 .value  → track 收集依赖
//     - 写 .value  → trigger 派发更新
//   若传入的是对象，则内部用 reactive 处理。

import { trackEffects, triggerEffects } from "./effect.js";
import { reactive, isObject, hasChanged } from "./reactive.js";

class RefImpl {
  constructor(value) {
    this.__v_isRef = true;
    this._rawValue = value;
    this._value = convert(value);
    this.dep = new Set(); // 每个 ref 自己持有一个依赖集合
  }

  get value() {
    trackEffects(this.dep);
    return this._value;
  }

  set value(newValue) {
    if (hasChanged(newValue, this._rawValue)) {
      this._rawValue = newValue;
      this._value = convert(newValue);
      triggerEffects(this.dep);
    }
  }
}

function convert(value) {
  return isObject(value) ? reactive(value) : value;
}

export function ref(value) {
  return new RefImpl(value);
}

export function isRef(r) {
  return !!(r && r.__v_isRef);
}

export function unref(r) {
  return isRef(r) ? r.value : r;
}

// 在模板/setup 返回值里，自动「脱 ref」，访问时不必写 .value
export function proxyRefs(objectWithRefs) {
  return new Proxy(objectWithRefs, {
    get(target, key, receiver) {
      return unref(Reflect.get(target, key, receiver));
    },
    set(target, key, value, receiver) {
      const oldValue = target[key];
      if (isRef(oldValue) && !isRef(value)) {
        oldValue.value = value; // 给已有 ref 赋普通值 → 走 ref 的 setter
        return true;
      }
      return Reflect.set(target, key, value, receiver);
    },
  });
}
