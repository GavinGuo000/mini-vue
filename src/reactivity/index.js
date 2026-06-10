// ============================================================
// 响应式模块统一出口
// ============================================================
//
// 将响应式系统的所有公开 API 统一导出，
// 外部只需 import from './reactivity/index.js' 即可访问全部能力。
//
// 导出的 API 分组：
//   - effect:     副作用核心（依赖收集 / 派发更新 / ReactiveEffect 类）
//   - reactive:   基于 Proxy 的对象响应式
//   - ref:        基于 getter/setter 的原始值响应式 + 自动解包
//   - computed:   带缓存的派生计算属性
//   - watch:      侦听数据变化并执行回调

// 副作用核心：effect() 创建响应式副作用，ReactiveEffect 是其底层类，
// track/trigger 分别用于依赖收集和派发更新（主要被 Proxy handler 内部调用）
export { effect, ReactiveEffect, track, trigger } from "./effect.js";
// reactive：基于 Proxy 的深度响应式对象，以及相关的工具函数
export {
  reactive,    // 创建响应式对象
  isReactive,  // 判断是否为响应式对象
  toRaw,       // 获取代理背后的原始对象
  isObject,    // 判断值是否为对象类型
  hasChanged,  // 判断值是否发生变化（Object.is）
} from "./reactive.js";
// ref：让原始值也能具备响应式能力，以及自动解包相关 API
export { ref, isRef, unref, proxyRefs } from "./ref.js";
// computed：带缓存的惰性计算属性
export { computed } from "./computed.js";
// watch：侦听响应式数据变化并执行回调
export { watch } from "./watch.js";
