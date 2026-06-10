// ============================================================
// watch —— 侦听数据变化并执行回调
// ============================================================
//
// 原理：用一个 effect 去「读取」被侦听的数据(从而收集依赖)，
//   依赖变化时 scheduler 触发回调，并把新旧值传给回调。

import { ReactiveEffect } from "./effect.js";
import { isReactive, isObject } from "./reactive.js";
import { isRef } from "./ref.js";

/**
 * watch —— 侦听响应式数据的变化，并在变化时执行回调
 *
 * 原理：
 *   1. 根据 source 类型构造一个 getter 函数，用于「读取」被侦听的数据。
 *   2. 创建一个 ReactiveEffect，其 fn = getter，scheduler = job。
 *      - 首次执行 effect.run() 时，getter 会读取数据从而收集依赖。
 *      - 当依赖变化时，scheduler（job）被触发，执行用户回调 cb。
 *   3. job 内部会再次执行 effect.run()，重新收集依赖 + 获取新值，
 *      并将新旧值传给 cb。
 *
 * @param source  侦听源：可以是 ref、reactive 对象、getter 函数、或任意值
 * @param cb      回调函数，接收 (newValue, oldValue)
 * @param options 配置项：
 *                  - immediate: 是否立即执行一次回调（默认 false）
 * @returns 停止侦听的函数（调用后 effect 不再响应变化）
 *
 * 用法示例：
 *   const count = ref(0);
 *   const stop = watch(count, (newV, oldV) => {
 *     console.log(`count 从 ${oldV} 变成了 ${newV}`);
 *   });
 *   count.value++;  // 输出：count 从 0 变成了 1
 *   stop();         // 停止侦听
 *   count.value++;  // 无输出
 */
export function watch(source, cb, options = {}) {
  let getter;

  // 根据 source 类型构造对应的 getter：
  if (isRef(source)) {
    // ref：直接读取 .value 即可收集依赖
    getter = () => source.value;
  } else if (isReactive(source)) {
    // reactive 对象：需要深度遍历所有属性来收集依赖，
    // 否则只会侦听「访问了哪些属性」，而漏掉嵌套属性的变化。
    // traverse() 递归访问每个属性，触发所有 getter 完成依赖收集。
    getter = () => traverse(source);
  } else if (typeof source === "function") {
    // getter 函数：用户自己控制侦听哪些数据，
    // 如 watch(() => state.a + state.b, cb)
    getter = source;
  } else {
    // 其他类型：不作为响应式数据侦听（每次都不会变，回调不会触发）
    getter = () => source;
  }

  // 保存上一次的值，用于传给回调的 oldValue 参数
  let oldValue;

  /**
   * job：当依赖变化时由 scheduler 调用
   * 职责：1) 重新执行 getter 获取新值并重新收集依赖
   *       2) 调用用户回调，传入新旧值
   *       3) 更新 oldValue 以备下次使用
   */
  const job = () => {
    // 重新执行 getter，获取新值（同时重新收集依赖）
    const newValue = effect.run();
    // 调用用户回调
    cb(newValue, oldValue);
    // 更新 oldValue 为当前新值，供下次回调使用
    oldValue = newValue;
  };

  // 创建 ReactiveEffect：
  // - fn = getter：用于读取数据、收集依赖
  // - scheduler = job：依赖变化时不直接重跑 getter，而是走 job
  //   （这样可以拿到新旧值，并执行用户回调）
  const effect = new ReactiveEffect(getter, job);

  if (options.immediate) {
    // immediate 模式：立即执行一次回调。
    // 此时 oldValue 为 undefined（因为还没执行过 getter），
    // 符合 Vue 的 API 约定：immediate 时 oldValue === undefined。
    job();
  } else {
    // 非 immediate 模式：先执行一次 getter，
    // 目的有两个：1) 完成首次依赖收集  2) 记录初始值作为 oldValue
    oldValue = effect.run();
  }

  // 返回停止侦听的函数：调用后 effect 清理所有依赖，
  // 后续数据变化不再触发回调。
  return () => effect.stop();
}

/**
 * 递归遍历对象的每个属性，触发所有嵌套属性的 getter 以收集依赖。
 *
 * 为什么需要它？
 *   reactive 对象是「懒代理」，只有被访问的属性才会触发 track()。
 *   如果 watch(reactiveObj, cb) 只读取了 reactiveObj 本身，
 *   那么只有顶层属性变化才会触发回调，嵌套属性变化不会。
 *   traverse() 递归访问所有属性，确保深层变化也能被侦听到。
 *
 * @param value 要遍历的值
 * @param seen  已遍历对象的集合，防止循环引用导致无限递归
 * @returns 原始值（仅用于链式调用）
 */
function traverse(value, seen = new Set()) {
  // 非对象类型 或 已经遍历过的对象（防止循环引用） → 直接返回
  if (!isObject(value) || seen.has(value)) return value;
  // 记录已遍历，防止循环引用
  seen.add(value);
  // 递归访问每个属性，触发 Proxy getter 完成依赖收集
  for (const key in value) {
    traverse(value[key], seen);
  }
  return value;
}
