// ============================================================
// reactive —— 基于 Proxy 的对象响应式
// ============================================================
//
// 这是 Vue3 相对 Vue2 (Object.defineProperty) 的核心升级：
//   - Proxy 可以拦截整个对象的读写，包括新增/删除属性、数组下标。
//   - 懒代理：只有访问到的嵌套对象才会被转成 reactive，性能更好。

import { track, trigger } from "./effect.js";

// 用于标记/判断一个对象是否已经是 reactive 代理
export const ReactiveFlags = {
  IS_REACTIVE: "__v_isReactive",
  RAW: "__v_raw",
};

// 缓存：同一个原始对象多次 reactive() 应返回同一个代理
const reactiveMap = new WeakMap();

export function reactive(target) {
  if (!isObject(target)) return target;
  // 已经是代理则直接返回
  if (target[ReactiveFlags.IS_REACTIVE]) return target;
  // 已经代理过则复用
  const existing = reactiveMap.get(target);
  if (existing) return existing;

  const proxy = new Proxy(target, {
    get(target, key, receiver) {
      if (key === ReactiveFlags.IS_REACTIVE) return true;
      if (key === ReactiveFlags.RAW) return target;

      const res = Reflect.get(target, key, receiver);
      // 依赖收集
      track(target, key);
      // 懒代理：嵌套对象在被访问时才转为 reactive
      if (isObject(res)) {
        return reactive(res);
      }
      return res;
    },
    set(target, key, value, receiver) {
      const oldValue = target[key];
      // 区分「新增属性」与「修改属性」，并兼容数组 length 变化
      const hadKey = Array.isArray(target)
        ? Number(key) < target.length
        : Object.prototype.hasOwnProperty.call(target, key);

      const res = Reflect.set(target, key, value, receiver);

      // 值确实变化了才派发更新（避免无意义的重渲染）
      if (!hadKey) {
        trigger(target, key); // 新增
      } else if (hasChanged(value, oldValue)) {
        trigger(target, key); // 修改
      }
      return res;
    },
    deleteProperty(target, key) {
      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      const res = Reflect.deleteProperty(target, key);
      if (hadKey && res) {
        trigger(target, key);
      }
      return res;
    },
  });

  reactiveMap.set(target, proxy);
  return proxy;
}

export function isReactive(value) {
  return !!(value && value[ReactiveFlags.IS_REACTIVE]);
}

// 拿到代理背后的原始对象
export function toRaw(observed) {
  const raw = observed && observed[ReactiveFlags.RAW];
  return raw ? toRaw(raw) : observed;
}

export function isObject(value) {
  return value !== null && typeof value === "object";
}

export function hasChanged(value, oldValue) {
  return !Object.is(value, oldValue);
}
