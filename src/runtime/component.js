// ============================================================
// 组件实例 —— setup / props / 生命周期 的承载者
// ============================================================

import { reactive } from "../reactivity/reactive.js";
import { proxyRefs } from "../reactivity/ref.js";

// 当前正在 setup 的组件实例（让 onMounted 等生命周期 API 知道挂到哪个组件）
let currentInstance = null;
export function getCurrentInstance() {
  return currentInstance;
}
export function setCurrentInstance(instance) {
  currentInstance = instance;
}

export function createComponentInstance(vnode) {
  const instance = {
    vnode,
    type: vnode.type, // 组件配置对象 { setup, render, ... }
    props: {},
    attrs: {},
    setupState: {}, // setup 返回的状态
    ctx: {}, // 渲染时用的上下文（render 的 this / 模板作用域）
    subTree: null, // 组件 render 出来的 vnode 树
    isMounted: false,
    update: null, // 组件的更新函数（带响应式 effect）
    emit: null,
    // 生命周期钩子收集桶
    bm: [], // beforeMount
    m: [], // mounted
    bu: [], // beforeUpdate
    u: [], // updated
  };

  instance.emit = createEmit(instance);
  return instance;
}

function createEmit(instance) {
  return (event, ...args) => {
    // emit('add') → 找父级传入的 onAdd 处理器
    const handlerName = `on${event[0].toUpperCase()}${event.slice(1)}`;
    const handler = instance.props[handlerName];
    if (handler) handler(...args);
  };
}

// 运行时编译器注入点（避免 runtime 直接依赖 compiler，防止循环引用）
let compileFn = null;
export function registerCompiler(compile) {
  compileFn = compile;
}

export function setupComponent(instance) {
  const { props, children } = instance.vnode;
  // 简化版：把 vnode.props 直接作为组件 props
  instance.props = reactive(props || {});

  const Component = instance.type;
  const { setup } = Component;

  if (setup) {
    setCurrentInstance(instance);
    // setup(props, { emit }) 的返回值可以是「状态对象」或「render 函数」
    const setupResult = setup(instance.props, {
      emit: instance.emit,
      slots: children,
    });
    setCurrentInstance(null);

    if (typeof setupResult === "function") {
      instance.render = setupResult; // setup 直接返回 render
    } else if (setupResult && typeof setupResult === "object") {
      // proxyRefs：模板里用 count 而不必写 count.value
      instance.setupState = proxyRefs(setupResult);
    }
  }

  if (!instance.render && Component.render) {
    instance.render = Component.render;
  }

  // 若组件只提供了 template 字符串，则用编译器现场编译成 render 函数
  if (!instance.render && Component.template && compileFn) {
    instance.render = compileFn(Component.template);
  }

  // 渲染上下文：render 函数里既能访问 setup 状态，也能访问 props
  instance.ctx = new Proxy(instance, {
    get(target, key) {
      if (key in target.setupState) return target.setupState[key];
      if (key in target.props) return target.props[key];
      if (key === "$emit") return target.emit;
      if (key === "$props") return target.props;
      return undefined;
    },
    set(target, key, value) {
      if (key in target.setupState) {
        target.setupState[key] = value;
        return true;
      }
      return false;
    },
  });
}

// ---- 生命周期 API ----
function injectHook(type, hook) {
  const instance = currentInstance;
  if (instance) {
    instance[type].push(hook);
  }
}
export const onBeforeMount = (hook) => injectHook("bm", hook);
export const onMounted = (hook) => injectHook("m", hook);
export const onBeforeUpdate = (hook) => injectHook("bu", hook);
export const onUpdated = (hook) => injectHook("u", hook);

export function invokeHooks(hooks) {
  for (const hook of hooks) hook();
}
