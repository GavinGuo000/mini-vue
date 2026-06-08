# mini-vue

一个**用于学习 Vue3 实现原理**的最小可运行实现。用约几百行、零依赖、零构建步骤的原生 ES Module，从头实现 Vue3 的三大核心模块：

- **响应式系统（Reactivity）**：`reactive` / `ref` / `computed` / `watch` / `effect`，基于 `Proxy` 的依赖收集与派发更新。
- **运行时（Runtime）**：虚拟 DOM、`h` 函数、带 key 的 diff 算法（最长递增子序列）、组件、生命周期、异步调度。
- **编译器（Compiler）**：把 `template` 字符串编译成 `render` 函数（parse → AST → generate）。

> 目标是「看得懂、能跑、能改」。每个文件都有中文注释解释**原理**，而不是单纯堆砌代码。

---

## 🚀 快速开始

因为示例使用原生 ES Module（`import`），浏览器要求通过 HTTP 协议加载（不能直接双击 `file://` 打开），所以需要一个本地静态服务器。

### 方式一：npm（推荐）

```bash
npm run dev
```

然后浏览器访问 **http://localhost:5173**，从首页进入 4 个示例。

### 方式二：任意静态服务器

```bash
# Python 自带
python3 -m http.server 5173

# 或 Node
npx serve . -l 5173
```

### 运行测试（验证实现正确性）

测试用 jsdom 在 Node 里跑真实渲染 + diff + 编译，无需浏览器：

```bash
npm install   # 安装 jsdom（devDependency）
npm test
```

预期输出 9 项全部通过（响应式更新、keyed diff 复用 DOM、模板编译等）。

---

## 📂 目录结构

```
mini-vue/
├── index.html                  # 示例首页（4 个 demo 的入口）
├── package.json                # 脚本：dev / start / test
├── scripts/
│   └── test-render.mjs         # 基于 jsdom 的端到端测试
├── examples/                   # 可运行示例（每个都是独立 HTML）
│   ├── 01-reactivity.html      # ① 响应式：effect/computed/watch 自动更新
│   ├── 02-render-h.html        # ② 虚拟 DOM：用 h() 手写 render + keyed diff
│   ├── 03-compiler.html        # ③ 编译器：template → render（展示生成源码）
│   └── 04-todo-app.html        # ④ 综合：TodoMVC（组件 + props/emit + computed）
└── src/
    ├── index.js                # 总入口：组装三大模块并注册运行时编译器
    │
    ├── reactivity/             # 【响应式系统】
    │   ├── effect.js           #   依赖收集(track)/派发更新(trigger)/ReactiveEffect
    │   ├── reactive.js         #   基于 Proxy 的对象响应式（懒代理）
    │   ├── ref.js              #   基本类型响应式 + proxyRefs（模板自动脱 .value）
    │   ├── computed.js         #   带缓存的派生值（lazy + dirty 标记）
    │   ├── watch.js            #   侦听器（深度遍历收集依赖）
    │   └── index.js            #   统一导出
    │
    ├── runtime/                # 【运行时】
    │   ├── vnode.js            #   VNode 数据结构、h()、Text/Fragment、ShapeFlags
    │   ├── renderer.js         #   渲染器：mount/patch/unmount + 核心 diff 算法
    │   ├── component.js        #   组件实例、setup、props/emit、生命周期
    │   ├── scheduler.js        #   异步批量更新队列 + nextTick
    │   ├── dom.js              #   平台操作（DOM 增删改、事件、class/style）
    │   ├── createApp.js        #   createApp().mount() 应用入口
    │   └── index.js            #   统一导出
    │
    └── compiler/               # 【编译器】
        └── index.js            #   parse(AST) + generate(render 源码) + compile()
```

---

## 🧠 核心原理速览

### 1. 响应式：Proxy + 依赖收集

```
读取数据 (getter) ──track──▶ 把「当前运行的 effect」存进该数据的依赖集合(dep)
修改数据 (setter) ──trigger─▶ 取出 dep 里所有 effect 重新执行
```

- `reactive` 用 `Proxy` 拦截整个对象（相比 Vue2 的 `Object.defineProperty`，能监听新增/删除属性和数组）。
- `ref` 用 `{ value }` 包裹基本类型，在 `get/set value` 里手动 track/trigger。
- `computed` 是「lazy + 带 scheduler 的 effect」，用 `_dirty` 实现缓存。
- 组件渲染被包进一个 effect：用到的数据一变，就自动重渲染。

### 2. 虚拟 DOM 与 diff

- VNode 是描述 DOM 的 JS 对象；diff 在内存里比较新旧 VNode，只更新变化部分。
- 子节点 diff 采用「双端预处理 + 带 key 映射 + 最长递增子序列」，把 DOM 移动次数降到最低（见 `renderer.js` 的 `patchKeyedChildren` 与 `getSequence`）。
- 更新通过 `scheduler` 放入微任务队列去重，一次性刷新（即 `nextTick` 的原理）。

### 3. 编译器：template → render

```
template 字符串 ──parse──▶ AST ──generate──▶ render 函数源码 ──new Function──▶ render()
```

支持元素、文本、`{{ 插值 }}`、`v-if`、`v-for`、`@event`、`:bind`。在示例 ③ 里可以直接看到任意 template 生成的 render 源码。

---

## 📌 与真实 Vue3 的差异（为教学做的简化）

为了聚焦原理、保持可读性，本实现**刻意省略/简化**了：

- 调度器没有区分 pre/post 队列，也没有完整的 effect scope；
- diff 没有静态提升、Block Tree、PatchFlag 等编译期优化；
- 编译器的表达式处理用正则给标识符加 `_ctx.` 前缀（真实 Vue 用 Babel/AST），复杂表达式可能不被支持；
- 未实现 slots、provide/inject、Teleport、Suspense、KeepAlive、指令系统、异步组件等。

这些都是真实 Vue3 的重要能力，但不影响理解「响应式 + 虚拟 DOM + 编译」这条主线。

---

## 📖 建议的学习顺序

1. `src/reactivity/effect.js` → `reactive.js` → `ref.js` → `computed.js`（理解响应式闭环）
2. `src/runtime/vnode.js` → `renderer.js`（理解 VNode 与 diff）
3. `src/runtime/component.js` → `createApp.js`（理解组件如何与响应式联动）
4. `src/compiler/index.js`（理解 template 怎么变成 render）
5. 对照 `examples/` 边看边改，改完刷新页面立即生效。

## License

MIT
