# Host API 参考（`window.dbxPlugin`）

插件 UI 运行在**隔离的 iframe** 中：`sandbox="allow-scripts"`、严格 CSP、**无父页面 DOM 访问**、**无 Tauri 对象**、**默认完全无网络**。DBX 通过 `window.dbxPlugin` 提供桥接对象。

> **不要**导入 DBX 的 Vue/Tauri 模块，也**不要**假设页面能直接访问 Node.js、文件系统或任意网络。所有能力必须通过 Manifest 权限 + Host API 显式暴露。

## 1. 启动顺序

```js
// ✅ 所有启动逻辑放在 ready 之后
await window.dbxPlugin.ready;

const context = window.dbxPlugin.context;
const locale = window.dbxPlugin.locale;
```

`ready` 在 Host 完成初始化后 resolve。不要在模块顶层同步读取 `context`/`theme` —— 此时桥接可能还没就绪。

## 2. API 全表

| API | 作用 | 需要的权限 |
| --- | --- | --- |
| `ready` | 等待 Host 完成初始化 | — |
| `context` | 读取当前工作台 context | — |
| `onContext(fn)` | 监听 context 变化，返回取消订阅函数 | — |
| `locale` | 当前语言（`en`、`zh-CN` 等） | — |
| `theme` | `{ appearance: "light" \| "dark", tokens }` | — |
| `request(method, params)` | 调用 **Host API** | — |
| `invoke(method, params, { timeoutMs })` | 调用**自己 Sidecar** 的 RPC（有响应） | — |
| `notify(method, params)` | 向自己 Sidecar 发通知（无业务返回值） | — |
| `sendBinary(channel, data)` | 发送二进制（`ArrayBuffer`，可 transfer） | `host.binary` + `stdio-framed` |
| `onBinary(fn)` | 接收二进制，回调参数 `{ channel, data: Uint8Array }` | `host.binary` |
| `readAsset(path)` | 读取包内资源 | — |
| `readAssetUrl(path)` | 读取包内资源并返回对象 URL | — |
| `openWorkbench(id, context)` | 打开本插件另一个工作台 | `host.workbench` |
| `openFilesystem(id, context)` | 打开本插件的文件系统入口 | `host.filesystem` |
| `onInit(fn)` | 监听初始化/环境变化 | — |
| `onEvent(fn)` | 监听后端事件 | `host.events` |

常用 Host 内部方法（通过 `request` 调用）：`host.getContext`、`ui.readAsset`。
**只调用协议中声明的方法**，不要调用未公开的 DBX 内部函数。

## 3. context 与快照规则

跨边界传递的 context 是 **JSON 数据快照**，宿主会递归剥离 Vue 响应式包装并发送独立副本。因此插件**不能**依赖 Vue ref、Proxy、DOM 节点、函数、组件实例或凭据。

- **允许**：`null`、布尔、有限数字、字符串、数组、普通对象。
- **拒绝**（返回错误）：`Date`、`Map`、`Set`、`Symbol`、`BigInt`、非有限数字、循环引用、自定义 class 实例。
- 对象中的 `undefined` 字段被省略；数组中的 `undefined` 变成 `null`。
- UTF-8 编码后**上限 2 MiB**。

`onContext` 推送变化时**不重载 iframe**，所以插件 UI 状态可以跨导航保留。组件销毁时调用 `onContext`/`onEvent`/`onBinary` 返回的取消订阅函数，避免重复监听。

不同贡献点拿到的 context 不同：普通工作台是打开的导航上下文；`result-view` 额外带 `context.result`（有界快照）。

## 4. 主题与样式

DBX 把设计 tokens 注入文档根元素，并更新 `data-dbx-theme`。**不要**依赖父页面 CSS 自动穿透 iframe。

```css
body {
  margin: 0;
  background: var(--color-background, #fff);
  color: var(--color-foreground, #18181b);
}
button {
  background: var(--color-primary, #2563eb);
  color: var(--color-primary-foreground, #fff);
  cursor: pointer;
}
```

官方内置轻量组件类（用同一套 token，随明暗主题与自定义调色板自动适配）：

```html
<button class="dbx-btn dbx-btn--primary">Connect</button>
<input class="dbx-input" placeholder="Endpoint" />
<span class="dbx-badge">Ready</span>
```

可用类：`dbx-card`、`dbx-section-title`、`dbx-btn`（`--primary` / `--danger` / `--ghost`）、`dbx-label`、`dbx-input`、`dbx-select`、`dbx-textarea`、`dbx-hint`、`dbx-row`、`dbx-table`、`dbx-badge`、`dbx-link`。

`document.documentElement.dataset.dbxTheme` 反映当前外观。

**环境变化事件**：先读 `dbxPlugin.locale`/`theme` 初始化，再监听：

```js
window.addEventListener("dbx-plugin-env", () => {
  document.body.dataset.theme = window.dbxPlugin.theme.appearance;
  // 重新渲染本地化文案
});
```

> 开发宿主（`dbx-plugin dev`）**不模拟完整组件 kit**。用自定义 token 样式的插件在 dev 与真实宿主中表现更一致；用内置类的插件要在真实 DBX 里复验外观。

## 5. 国际化（两层）

1. **Manifest 层**：`manifest.json > localizations` 覆盖插件名称、说明、连接字段、按钮、贡献点文案（见 `manifest.md` §5）。
2. **插件 UI 层**：DBX **不会替你翻译插件 UI 文本**。按 `window.dbxPlugin.locale` 选择文案或接入自己的 i18n 库。

```js
const copy = {
  en: { title: "Files" },
  zh: { title: "文件" }
};
const text = window.dbxPlugin.locale.toLowerCase().startsWith("zh") ? copy.zh : copy.en;
```

## 6. 资源读取

```js
await window.dbxPlugin.ready;

const assetUrl = await window.dbxPlugin.readAssetUrl("assets/empty-state.svg");
img.src = assetUrl;
// 不用时释放
URL.revokeObjectURL(assetUrl);

const text = await window.dbxPlugin.readAsset("assets/config.json");
```

**路径相对于 `ui.root`**：`assets/empty-state.svg` 对应包内 `ui/assets/empty-state.svg`。路径不能越出插件资源根目录。

UI 资源必须是**内联**或通过 `readAssetUrl` 加载的。发行包里的相对模块 URL 不是资源桥的替代品 —— 宿主把入口及资源转换成沙箱可加载内容；CSP 报错时先检查构建产物是否存在、路径是否落在 `ui.root` 内。

**不要把 Vite dev server 或 CDN 的脚本地址写进发行包。**

## 7. 二进制通道

需要二进制帧时必须同时满足：`manifest.json` 的 `backend.transport = "stdio-framed"`、声明 `host.binary` 权限、Sidecar 实现 framed 传输。

```js
await window.dbxPlugin.ready;

const off = window.dbxPlugin.onBinary(({ channel, data }) => {
  // data 是 Uint8Array
});
window.dbxPlugin.sendBinary("transfer", buffer);   // 单条消息 8 MiB
```

- UI 侧单条二进制消息 **8 MiB**；更大传输要自己分块（偏移、确认、取消、进度事件）。
- 默认 `stdio-jsonl` 传输**不支持**二进制。

## 8. 导航到本插件其它入口

```js
await window.dbxPlugin.openWorkbench("com.example.files.main", { path: "/" });   // 需 host.workbench
await window.dbxPlugin.openFilesystem("com.example.files.fs", { uri: "s3://b/" }); // 需 host.filesystem
```

只能打开**本插件**声明的工作台/文件系统。所有后端调用会被宿主重新绑定到所属插件 ID，**插件 UI 无法调用另一个插件**。

## 9. 网络访问

沙箱默认**完全无网络**。要访问外部服务，在 Manifest 里声明精确 origin：

```json
{ "permissions": ["host.network:https://api.vendor.com"] }
```

- 只有 HTTPS；主机 + 可选端口；**无路径、无通配符、无 Token**；最多 8 个。
- 声明后这些 origin 才被加入 `connect-src`。**仍受目标服务 CORS 约束。**
- 该权限**不影响**原生 Sidecar 的网络能力（Sidecar 不受浏览器 CSP 限制）。

## 10. 错误处理与 UI 约定

- 失败以 **Promise rejection** 返回。要展示可理解的错误并允许重试，不要静默吞掉。
- 用插件自己的对话框组件处理删除/重命名/确认 —— **不要用沙箱里的原生 `alert` / `confirm` / `prompt`**（不可靠）。
- `request` 的宿主方法、参数和返回值以当前 Host API 版本为准。

## 11. 开发宿主的能力边界

`dbx-plugin dev` **只模拟受支持的 Host API 子集**：

| 支持 | 不支持 / 需真实 DBX |
| --- | --- |
| `ready`、`context`、`locale`、`theme`、`request`、`invoke`、`notify`、`onInit`、`onContext`、`onEvent`、`onBinary`、`sendBinary`、资源读取、`openWorkbench` | `host.openFilesystem` 等未实现方法会直接报错 |
| 事件、二进制、工作台导航权限会被强制执行 | 原生连接动作、query-result 贡献点、完整 DBX 组件 kit **不模拟** |
| 声明式连接表单、工作台 Tab、RPC、主题切换 | 安装、签名、真实 Secret Store、桌面端生命周期、生产权限 |

桥接载荷上限（与真实宿主基线一致）：JSON 桥参数 2 MiB、UI 二进制消息 8 MiB、Sidecar JSON 8 MiB、Sidecar 二进制 64 MiB；显式超时被 clamp 到 1–120000 ms。

**生产行为必须在真实 DBX 里复验。**

## 12. 常见错误

| 现象 | 原因 |
| --- | --- |
| `dbxPlugin` 是 `undefined` | 在 `await dbxPlugin.ready` 之前访问；或该页面不是沙箱工作台 |
| context 报「不支持的类型」 | 传了 `Date`/`Map`/`Set`/class 实例/循环引用 |
| 图片/CSS 404 或 CSP 报错 | 资源路径没落在 `ui.root` 内，或没构建进包 |
| `连接被拒绝` / CORS 错误 | 没有声明 `host.network:https://...`，或目标服务未放行 CORS |
| 自定义组件在 dev 正常、真实 DBX 里样式错乱 | 依赖了父页面 CSS 穿透或未使用 token 变量 |
| 重复收到事件 | 没有调用取消订阅函数 |
| 内存增长 | 未 `URL.revokeObjectURL` 释放 `readAssetUrl` 结果 |
