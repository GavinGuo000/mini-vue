// ============================================================
// watch —— 侦听数据变化并执行回调
// ============================================================
//
// 原理：用一个 effect 去「读取」被侦听的数据(从而收集依赖)，
//   依赖变化时 scheduler 触发回调，并把新旧值传给回调。

import { ReactiveEffect } from "./effect.js";
import { isReactive, isObject } from "./reactive.js";
import { isRef } from "./ref.js";

export function watch(source, cb, options = {}) {
  let getter;
  if (isRef(source)) {
    getter = () => source.value;
  } else if (isReactive(source)) {
    getter = () => traverse(source); // 深度遍历以收集所有嵌套依赖
  } else if (typeof source === "function") {
    getter = source;
  } else {
    getter = () => source;
  }

  let oldValue;

  const job = () => {
    const newValue = effect.run();
    cb(newValue, oldValue);
    oldValue = newValue;
  };

  const effect = new ReactiveEffect(getter, job);

  if (options.immediate) {
    job();
  } else {
    oldValue = effect.run(); // 先跑一次以收集依赖并记录初始值
  }

  return () => effect.stop(); // 返回停止侦听的函数
}

// 递归访问对象的每个属性，触发它们的 getter 完成依赖收集
function traverse(value, seen = new Set()) {
  if (!isObject(value) || seen.has(value)) return value;
  seen.add(value);
  for (const key in value) {
    traverse(value[key], seen);
  }
  return value;
}
