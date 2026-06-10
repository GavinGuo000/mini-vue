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

/**
 * ref 的内部实现类
 * 与 reactive 不同，ref 不走 targetMap 的全局依赖存储，
 * 而是每个 ref 实例自己持有一个 dep（Set<ReactiveEffect>）。
 * 这样设计是因为 ref 只包装单个值，不需要「对象 → 属性」的多层映射。
 */
class RefImpl {
  constructor(value) {
    // ref 标记，用于 isRef() 判断
    this.__v_isRef = true;
    // _rawValue：存储原始值，用于新旧值比较（避免比较已转换的代理对象）
    this._rawValue = value;
    // _value：存储转换后的值。
    // 如果原始值是对象，会用 reactive() 包装，使其具备深度响应式能力；
    // 如果是原始值，则保持不变。
    this._value = convert(value);
    // 每个 ref 独立的依赖集合，存储所有“读取了这个 ref”的 effect
    this.dep = new Set();
  }

  /**
   * getter：读取 .value 时触发
   * 在依赖收集阶段将当前 activeEffect 加入 dep，
   * 实现「谁用了我，我就记住谁」。
   */
  get value() {
    trackEffects(this.dep);
    return this._value;
  }

  /**
   * setter：给 .value 赋值时触发
   * 先比较新旧原始值是否变化，变化了才派发更新，
   * 避免赋相同值时触发无意义的重渲染。
   */
  set value(newValue) {
    // 用 _rawValue（而非 _value）比较，因为 _value 可能是代理对象，
    // 代理对象和原始对象不等，会导致每次赋值都触发更新。
    if (hasChanged(newValue, this._rawValue)) {
      this._rawValue = newValue;
      this._value = convert(newValue);
      // 派发更新：通知所有依赖这个 ref 的 effect 重新执行
      triggerEffects(this.dep);
    }
  }
}

/**
 * 值转换：对象类型用 reactive 包装，原始值直接返回
 * 这保证了 ref(对象) 也具备深度响应式，
 * 如 const obj = ref({ a: 1 }); obj.value.a = 2; 也能触发更新。
 */
function convert(value) {
  return isObject(value) ? reactive(value) : value;
}

/**
 * 创建一个 ref 响应式引用
 * @param value 任意值（原始值或对象）
 * @returns RefImpl 实例，通过 .value 读写
 *
 * 用法示例：
 *   const count = ref(0);
 *   count.value++;  // 触发更新
 */
export function ref(value) {
  return new RefImpl(value);
}

/**
 * 判断一个值是否是 ref
 * 通过 __v_isRef 标记判断
 */
export function isRef(r) {
  return !!(r && r.__v_isRef);
}

/**
 * 解包 ref：如果是 ref 则返回 .value，否则直接返回原值
 * 常用于「不确定是否是 ref」的场景，如模板中的自动解包。
 */
export function unref(r) {
  return isRef(r) ? r.value : r;
}

/**
 * 为包含 ref 的对象创建代理，实现「自动解包」。
 * 这是 Vue3 中 setup() 返回值自动脱 .value 的核心机制：
 *   setup() { const count = ref(0); return { count }; }
 *   → 模板/渲染函数中直接用 count 而不是 count.value
 *
 * 实现原理：
 *   - get：读取属性时自动 unref，外部拿到的是解包后的值
 *   - set：赋值时，如果原属性是 ref 而新值不是，
 *          则把新值赋给 ref.value（走 ref 的 setter 触发更新），
 *          而不是替换掉 ref 本身。
 */
export function proxyRefs(objectWithRefs) {
  return new Proxy(objectWithRefs, {
    get(target, key, receiver) {
      // 读取时自动解包：ref.value → 实际值
      return unref(Reflect.get(target, key, receiver));
    },
    set(target, key, value, receiver) {
      const oldValue = target[key];
      if (isRef(oldValue) && !isRef(value)) {
        // 旧值是 ref，新值不是 ref：直接给 ref.value 赋值，
        // 这样会触发 ref 的 setter → triggerEffects → 更新视图
        oldValue.value = value;
        return true;
      }
      // 其他情况：正常赋值（包括用新 ref 替换旧 ref）
      return Reflect.set(target, key, value, receiver);
    },
  });
}
