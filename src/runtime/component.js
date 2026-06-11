// ============================================================
// 组件实例 —— setup / props / 生命周期 的承载者
// ============================================================
//
// 每个组件 vnode 会创建一个组件实例 (instance)，
// 实例上承载了组件的所有状态：
//   - props:      父组件传入的属性（响应式）
//   - setupState: setup() 返回的状态（经 proxyRefs 自动解包）
//   - ctx:        渲染上下文，render 函数的 this 和第一个参数
//   - subTree:    组件 render() 生成的 vnode 树
//   - update:     组件的更新函数（绑定了 ReactiveEffect.run）
//   - emit:       向父组件发射事件
//   - 生命周期钩子: bm / m / bu / u

import { reactive } from "../reactivity/reactive.js";
import { proxyRefs } from "../reactivity/ref.js";

// 当前正在 setup 的组件实例
// 用于让 onMounted 等生命周期 API 知道「挂到哪个组件」
let currentInstance = null;
export function getCurrentInstance() {
  return currentInstance;
}
export function setCurrentInstance(instance) {
  currentInstance = instance;
}

/**
 * 创建组件实例
 *
 * @param vnode 组件 vnode
 * @returns 组件实例对象，包含 props、setupState、ctx、生命周期钩子等
 */
export function createComponentInstance(vnode) {
  const instance = {
    vnode,
    type: vnode.type,    // 组件配置对象 { setup, render, template, ... }
    props: {},           // 父组件传入的属性（响应式）
    attrs: {},           // 未被 props 声明的属性（本实现简化，未严格区分）
    setupState: {},      // setup() 返回的状态（经 proxyRefs 自动解包）
    ctx: {},             // 渲染上下文：render 函数的 this / 第一个参数
    subTree: null,       // 组件 render() 生成的 vnode 子树
    isMounted: false,    // 是否已挂载（区分首次挂载和更新）
    update: null,        // 组件更新函数（绑定了 ReactiveEffect.run）
    emit: null,          // 向父组件发射事件的函数
    // 生命周期钩子收集桶（数组形式，支持注册多个同类型钩子）
    bm: [], // beforeMount  —— 挂载前
    m: [],  // mounted       —— 挂载后
    bu: [], // beforeUpdate  —— 更新前
    u: [],  // updated        —— 更新后
  };

  // 创建 emit 函数：用于子组件向父组件发射事件
  instance.emit = createEmit(instance);
  return instance;
}

/**
 * 创建 emit 函数
 *
 * 实现子组件向父组件发射事件的机制：
 *   子组件调用 emit('toggle')
 *   → 查找父组件传入的 onToggle 属性
 *   → 执行该回调函数
 *
 * 本质上 emit 就是把事件名转换成 onXxx 格式，然后从 props 中找到对应的回调。
 * 父组件通过 @toggle="handler" 或 onToggle={handler} 传入回调。
 */
function createEmit(instance) {
  return (event, ...args) => {
    // 事件名转换：'add' → 'onAdd'，'item-click' → 'onItem-click'
    const handlerName = `on${event[0].toUpperCase()}${event.slice(1)}`;
    // 从父组件传入的 props 中找到事件处理器
    const handler = instance.props[handlerName];
    if (handler) handler(...args);
  };
}

// 运行时编译器注入点
// 这是一个“依赖倒置”的设计：runtime 不直接依赖 compiler，
// 而是由总入口 (src/index.js) 将 compiler 注入进来，避免循环引用。
let compileFn = null;
export function registerCompiler(compile) {
  compileFn = compile;
}

// instance长什么样

// const Counter = {
//   template: `<div>{{ count }}</div>`,
//   setup(props, { emit }) {
//     const count = ref(0)
//     onMounted(() => console.log('挂载'))
//     return { count }
//   }
// }

//  instance = {
//   vnode: compVNode,
//   type: Counter,

//   props: reactive({ onAdd: () => {} }),
//   attrs: {},

//   setupState: proxyRefs({ count: RefImpl{ value: 0 } }),

//   ctx: new Proxy(instance, { get/set }),

//   subTree: null, // 初次渲染后变成 h("div", null, count) VNode

//   isMounted: false,

//   update: null, // 后续赋值 effect.run 绑定的更新函数

//   emit: (event, ...args) => {
//     const handler = props[`on${首字母大写事件名}`]
//     handler && handler(...args)
//   },

//   bm: [],
//   m: [() => console.log('挂载')], // onMounted 存入这里
//   bu: [],
//   u: []
// }

/**
 * setup 组件：初始化 props、执行 setup()、确定 render 函数、创建渲染上下文
 *
 * 这是组件初始化的核心步骤，按顺序执行：
 *   1. 初始化 props（响应式化）
 *   2. 执行 setup()，获取返回值（状态对象或 render 函数）
 *   3. 确定最终的 render 函数（优先级：setup返回 > Component.render > 编译template）
 *   4. 创建渲染上下文 ctx（Proxy，统一访问 setupState 和 props）
 */
export function setupComponent(instance) {
  const { props, children } = instance.vnode;
  // 1. 初始化 props：将 vnode.props 响应式化
  // 父组件修改 props 时，子组件会自动重渲染（因为 props 是 reactive 的）
  instance.props = reactive(props || {});

  const Component = instance.type;
  const { setup } = Component;

  // 2. 执行 setup() 函数
  if (setup) {
    // 设置 currentInstance，让 onMounted 等生命周期 API 知道挂到哪个组件
    setCurrentInstance(instance);
    // setup(props, { emit, slots }) 的返回值可以是：
    //   - 函数：直接作为 render 函数
    //   - 对象：作为组件状态，模板/渲染函数中可直接访问
    const setupResult = setup(instance.props, {
      emit: instance.emit,
      slots: children, // 简化版：将 children 作为 slots
    });
    // setup 执行完毕，清除 currentInstance
    setCurrentInstance(null);

    if (typeof setupResult === "function") {
      // setup 直接返回 render 函数
      instance.render = setupResult;
    } else if (setupResult && typeof setupResult === "object") {
      // setup 返回状态对象：用 proxyRefs 包装，实现自动解包 ref
      // 这样模板中写 count 而不是 count.value
      instance.setupState = proxyRefs(setupResult);
    }
  }

  // 3. 确定 render 函数（优先级：setup返回的render > Component.render > 编译template）
  if (!instance.render && Component.render) {
    // 组件配置中直接定义了 render 函数
    instance.render = Component.render;
  }

  if (!instance.render && Component.template && compileFn) {
    // 组件只提供了 template 字符串，用编译器现场编译成 render 函数
    instance.render = compileFn(Component.template);
  }

  // 4. 创建渲染上下文 ctx
  // ctx 是一个 Proxy，统一了 render 函数中的变量查找规则：
  //   - 优先从 setupState 中查找（setup 返回的状态）
  //   - 其次从 props 中查找
  //   - 特殊属性：$emit、$props
  instance.ctx = new Proxy(instance, {
    get(target, key) {
      // 优先查找 setupState（setup 返回的状态，已自动解包 ref）
      if (key in target.setupState) return target.setupState[key];
      // 其次查找 props
      if (key in target.props) return target.props[key];
      // 内置属性
      if (key === "$emit") return target.emit;
      if (key === "$props") return target.props;
      return undefined;
    },
    set(target, key, value) {
      // 只能修改 setupState 中的属性
      if (key in target.setupState) {
        target.setupState[key] = value;
        return true;
      }
      return false;
    },
  });
}

// ---- 生命周期 API ----
/**
 * 注入生命周期钩子到当前组件实例
 * 必须在 setup() 执行期间调用（此时 currentInstance 已设置），
 * 否则钩子不会被注册。
 */
function injectHook(type, hook) {
  const instance = currentInstance;
  if (instance) {
    instance[type].push(hook);
  }
}
// 对外暴露的生命周期 API：
// 用法：在 setup() 中调用 onMounted(() => { ... })
export const onBeforeMount = (hook) => injectHook("bm", hook);
export const onMounted = (hook) => injectHook("m", hook);
export const onBeforeUpdate = (hook) => injectHook("bu", hook);
export const onUpdated = (hook) => injectHook("u", hook);

/**
 * 批量执行生命周期钩子
 * @param hooks 钩子函数数组
 */
export function invokeHooks(hooks) {
  for (const hook of hooks) hook();
}
