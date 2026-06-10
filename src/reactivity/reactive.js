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
  // 原始值（number/string/boolean 等）无法被 Proxy 代理，直接返回
  if (!isObject(target)) return target;
  // 如果已经是代理对象（通过 IS_REACTIVE 标记判断），直接返回，避免重复代理
  if (target[ReactiveFlags.IS_REACTIVE]) return target;
  // 缓存检查：同一个原始对象多次调用 reactive() 应返回同一个代理，
  // 保证响应式依赖不会因为重复创建代理而丢失
  const existing = reactiveMap.get(target);
  if (existing) return existing;

  // 核心：创建 Proxy 代理，拦截对象的读/写/删除操作
  const proxy = new Proxy(target, {
    /**
     * getter 拦截 —— 读取属性时触发
     * 职责：1) 依赖收集 (track)  2) 懒代理嵌套对象
     * @param target   原始对象
     * @param key      被访问的属性名
     * @param receiver 代理对象本身（保证 this 指向正确，尤其是继承场景）
     */
    get(target, key, receiver) {
      // 特殊标记位：外部可以通过 obj.__v_isReactive 判断是否为代理
      if (key === ReactiveFlags.IS_REACTIVE) return true;
      // 特殊标记位：外部可以通过 obj.__v_raw 拿到原始对象
      if (key === ReactiveFlags.RAW) return target;

      // Reflect.get 保证 getter 中的 this 指向 receiver（代理对象），
      // 而非原始对象，这对于原型链上的 getter 尤其重要。
      const res = Reflect.get(target, key, receiver);
      // 依赖收集：将当前正在运行的 effect 记录到这个属性的 dep 中，
      // 后续这个属性变化时就能通知到对应的 effect 重新执行。
      track(target, key);
      // 懒代理（深度响应式的关键）：
      // Vue2 在 reactive 时就递归代理所有嵌套对象（性能差）；
      // Vue3 改为：只有当嵌套对象被「真正访问到」时才转为 reactive，
      // 未被访问的深层对象保持原始状态，节省初始化开销。
      if (isObject(res)) {
        return reactive(res);
      }
      return res;
    },
    /**
     * setter 拦截 —— 设置属性时触发
     * 职责：1) 判断值是否真的变了  2) 派发更新 (trigger)
     */
    set(target, key, value, receiver) {
      const oldValue = target[key];
      // 判断是「新增属性」还是「修改已有属性」：
      // - 数组：下标 < length 说明是修改，否则是新增（push 等）
      // - 对象：hasOwnProperty 判断属性是否已存在
      // 区分新增和修改在 Vue2 中很重要（Vue2 无法检测新增），
      // Vue3 通过 Proxy 天然支持，这里仍然区分是为了正确触发更新。
      const hadKey = Array.isArray(target)
        ? Number(key) < target.length
        : Object.prototype.hasOwnProperty.call(target, key);

      // Reflect.set 执行真正的赋值操作
      const res = Reflect.set(target, key, value, receiver);

      // 值确实变化了才派发更新（避免无意义的重渲染）
      if (!hadKey) {
        // 新增属性 → 一定需要触发更新
        trigger(target, key);
      } else if (hasChanged(value, oldValue)) {
        // 修改属性 → 只有值真的变了才触发（用 Object.is 比较，
        // 能正确处理 NaN === NaN 的情况）
        trigger(target, key);
      }
      return res;
    },
    /**
     * deleteProperty 拦截 —— 删除属性时触发（如 delete obj.name）
     * 职责：删除成功后派发更新
     */
    deleteProperty(target, key) {
      // 先判断属性是否存在（不存在的属性删除不需要触发更新）
      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      // Reflect.deleteProperty 执行真正的删除操作
      const res = Reflect.deleteProperty(target, key);
      // 属性存在且删除成功 → 触发更新
      if (hadKey && res) {
        trigger(target, key);
      }
      return res;
    },
  });

  // 缓存代理对象：下次对同一个 target 调用 reactive() 时直接返回缓存
  reactiveMap.set(target, proxy);
  return proxy;
}

/**
 * 判断一个值是否是响应式代理对象
 * 原理：Proxy getter 中对 IS_REACTIVE 标记返回 true，
 * 所以代理对象访问该属性会得到 true，普通对象会得到 undefined。
 */
export function isReactive(value) {
  return !!(value && value[ReactiveFlags.IS_REACTIVE]);
}

/**
 * 获取代理背后的原始对象（递归解包）
 * 用途：当需要绕过响应式（如传给第三方库）时使用。
 * 递归是因为可能存在「代理的代理」（虽然正常情况下 reactiveMap 会防止）。
 */
export function toRaw(observed) {
  const raw = observed && observed[ReactiveFlags.RAW];
  return raw ? toRaw(raw) : observed;
}

/**
 * 判断值是否为对象类型（含数组）
 * 注意：typeof null === 'object'，所以要先排除 null。
 * Proxy 只能代理对象类型，这是 reactive() 入口校验的前置条件。
 */
export function isObject(value) {
  return value !== null && typeof value === "object";
}

/**
 * 判断值是否发生变化（使用 Object.is 进行严格相等比较）
 * 与 === 的区别：
 *   Object.is(NaN, NaN) → true  （而 NaN === NaN → false）
 *   Object.is(+0, -0)   → false （而 +0 === -0 → true）
 * 这保证了 NaN 赋值相同 NaN 时不会触发无意义的更新。
 */
export function hasChanged(value, oldValue) {
  return !Object.is(value, oldValue);
}
