# Host API 参考（`window.dbxPlugin`）

插件 UI 运行在**隔离的 iframe** 中：`sandbox="allow-scripts"`、严格 CSP、**无父页面 DOM 访问**、**无 Tauri 对象**、**默认完全无网络**。DBX 通过 `window.dbxPlugin` 提供桥接对象。

> **不要**导入 DBX 的 Vue/Tauri 模块，也**不要**假设页面能直接访问 Node.js、文件系统或任意网络。所有能力必须通过 Manifest 权限 + Host API 显式暴露。

## 1. 启动顺序

```js
// ✅ 所有启动逻辑放在 ready 之后
await window.dbxPlugin.ready;

const contributionId = window.dbxPlugin.contributionId;
const context = window.dbxPlugin.context;
const locale = window.dbxPlugin.locale;
```

`ready` 在 Host 完成初始化后 resolve。不要在模块顶层同步读取 `context`/`theme` —— 此时桥接可能还没就绪。

`contributionId` 是宿主选中的贡献点身份，在 `ready` resolve 前已记录；多个 Workbench/result-view 共用 UI 入口时据此路由。不要从 `context` 猜身份，也不要仅监听一次性的 `dbx-plugin-init`（延迟注册可能错过）；旧宿主缺少该属性时需要降级。

## 2. API 全表

| API | 作用 | 需要的权限 |
| --- | --- | --- |
| `ready` | 等待 Host 完成初始化 | — |
| `contributionId` | 初始化后可读的贡献点身份，与 context 独立 | — |
| `context` | 读取当前工作台 context | — |
| `onContext(fn)` | 监听 context 变化，返回取消订阅函数 | — |
| `locale` | 当前语言（`en`、`zh-CN` 等） | — |
| `theme` | `{ appearance: "light" \| "dark", tokens }` | — |
| `capabilities` | 初始化消息公布的 `downloadFile`、`planApi`、`schemaMetadataApi`、`dataApi`、`storage`、`ai`、`aiModelDiscovery`、`aiCompletion`、`aiRecommendations`、`aiCompletionStream`、`clipboardWrite`、`clipboardRead`、`clipboardImageRead`、`mediaUrl`、`floating`、`fileTransfer` 等能力位 | — |
| `request(method, params)` | 调用 **Host API** | — |
| `invoke(method, params, { timeoutMs })` | 调用**自己 Sidecar** 的 RPC（有响应） | — |
| `notify(method, params)` | 向自己 Sidecar 发通知（无业务返回值） | — |
| `sendBinary(channel, data)` | 发送二进制（`ArrayBuffer`，可 transfer） | `host.binary` + `stdio-framed` |
| `onBinary(fn)` | 接收二进制，回调参数 `{ channel, data: Uint8Array }` | `host.binary` |
| `readAsset(path)` | 读取包内资源 | — |
| `readAssetUrl(path)` | 读取包内资源并返回对象 URL | — |
| `openWorkbench(id, context, options?)` | 打开本插件另一个工作台；dock 面板可用 `target: "tab"` 请求主工作台标签页 | `host.workbench` |
| `closeWorkbench()` | 请求关闭当前 tab/dock/window，与 Ctrl/Cmd+W 同一路径；不返回关闭完成的 Promise | — |
| `floating.open(options)` | 打开同插件 workbench 的桌面浮动窗口，需检查 `capabilities.floating` | `host.workbench` |
| `floating.close(id?)` / `beginDrag()` / `endDrag(options?)` / `setSize(w, h)` | 关闭本插件窗口或控制当前浮动窗口几何；见下文 | — |
| `executeCommand(commandId, context?)` | 执行本插件自己声明的命令，重新检查 enablement 并按命令的 tab/panel 语义复用或打开实例 | `host.workbench` |
| `openFilesystem(id, context)` | 打开本插件的文件系统入口 | `host.filesystem` |
| `getPlanCapabilities(connectionId)` / `explainPlan(request)` | 读取指定连接的估算执行计划 | `host.plans:read` |
| `getTableMetadata({ connectionId, database?, schema?, table })` | 读取已打开连接中单个 table 的窄化结构元数据 | `host.schema:read` |
| `queryData({ connectionId, database?, schema?, sql, maxRows?, timeoutMs? })` | 在用户已授权的连接上执行单条只读 SQL | `host.data:read` |
| `copy(text)` / `clipboard.writeText(text)` | 写入系统剪贴板 | — |
| `clipboard.readImage()` | 读取 PNG 图片，失败会 reject；检查 `clipboardImageRead` | `host.clipboard:read` |
| `clipboard.readText()` | 读取系统剪贴板 | `host.clipboard:read` |
| `storage.get(key)` / `storage.set(key, value)` / `storage.delete(key)` | 持久化本插件工作台的小型 JSON 状态 | `host.storage` |
| `ai.openConversation({ title, prompt, context, send?, mode? })` | 在 DBX 内置 AI 面板创建插件对话；`mode` 默认 `ask`，可选 `agent` 使用当前连接的插件工具 | `host.ai` |
| `ai.listProviders()` / `ai.discoverModels(configId)` | 列出可用的 API 提供商，或由宿主使用已保存凭据发现模型 | `host.ai` + `capabilities.aiModelDiscovery` |
| `ai.listModels()` | 返回已配置 API 模型的脱敏选择项；不返回 endpoint、Key、header 或 CLI agent | `host.ai` + `capabilities.aiCompletion` |
| `ai.generateTextStream({ requestId, configId, model, prompt, task? })` / `ai.cancelGeneration(requestId)` | 流式文本与按请求取消；检查 `aiCompletionStream` | `host.ai` |
| `ai.generateText({ configId, model, prompt, task? })` | 经宿主确认后生成纯文本；不启用工具或文件写入 | `host.ai` + `capabilities.aiCompletion` |
| `ai.setRecommendations({ context, items })` / `ai.clearRecommendations()` | 更新或清空当前 Workbench 的全局 AI 推荐问题（最多 5 条） | `host.ai` + `capabilities.aiRecommendations` |
| `fileTransfer` | 按能力位区分桌面原生选择/保存/拖放和 Web 选择/下载回退 | — |
| `stream(method, params, options?)` | 把 Sidecar 的 stream 事件转为 ReadableStream，见下文 | 后端事件需 `host.events` |
| `media.open(method, params)` / `media.close(token)` | 为音视频提供本插件媒体 URL；检查 `mediaUrl` | 无新增 Manifest 权限 |
| `onInit(fn)` | 监听初始化/环境变化 | — |
| `onEvent(fn)` | 监听后端事件 | `host.events` |

常用 Host 内部方法（通过 `request` 调用）：`host.getContext`、`ui.readAsset`。
**只调用协议中声明的方法**，不要调用未公开的 DBX 内部函数。

计划 API 仅支持宿主允许的只读估算模式；实际执行计划和会产生副作用的语句会被宿主拒绝。初始化消息中的 `capabilities.planApi` 为假或缺失时，应隐藏相关 UI，而不是用请求试探能力。

计划 API 属于 Host API 1.2。若插件不能在旧宿主上降级，应在 Manifest 中声明 `engines.host_api: "^1.2"`；即使声明了版本下限，也要保留 `capabilities.planApi` 的运行时检查。

### 表结构元数据（Host API 1.3）

声明 `host.schema:read` 后，插件可以读取 DBX 已打开连接中一个 table 的窄化、只读 schema metadata。调用前检查 `capabilities.schemaMetadataApi`，不要通过真实请求试探旧宿主：

```js
await window.dbxPlugin.ready;
if (window.dbxPlugin.capabilities.schemaMetadataApi) {
  const metadata = await window.dbxPlugin.getTableMetadata({
    connectionId,
    database,
    schema,
    table: "users",
  });
  renderColumns(metadata.columns);
}
```

返回的 `columns` 只包含 `name`、`dataType`、`nullable` 以及可选的 `length`、`precision`、`scale`、`default`；不会返回注释、索引/键、凭据、连接串、驱动对象或任意 SQL 结果。`fieldCapabilities` 对可选字段报告 `supported`、`unsupported` 或 `unknown`，`unknown` 不应当作支持。

`connectionId` 与 `table` 必须是非空 identity 值（最多 256 字符）；`database`、`schema` 不可用时省略，不要传空字符串。DBX 只复用已经打开的 Host connection/session：已保存但断开的连接、未打开的数据库 session 会返回错误，宿主不会替插件重连、建立连接池或执行 SQL。

该 API 属于 Host API 1.3。无法在缺少它时工作的插件应声明 `engines.host_api: "^1.3"`，同时保留 `schemaMetadataApi` 能力检查；没有 `host.schema:read` 时，调用会在到达 backend 前被拒绝。

### 只读数据查询（Host API 1.4）

声明 `host.data:read`，调用前检查 `capabilities.dataApi`。宿主会在插件首次查询每个连接时请求用户同意；授权可在「插件中心 → 已安装」撤销，拒绝在当前工作台会话内保留。Web 宿主无法显示授权确认时会拒绝调用。

```js
await window.dbxPlugin.ready;
if (window.dbxPlugin.capabilities.dataApi) {
  const result = await window.dbxPlugin.queryData({
    connectionId,
    database,
    sql: "SELECT status, count(*) AS total FROM orders GROUP BY status",
    maxRows: 200,
  });
  render(result.columns, result.rows, result.truncated);
}
```

返回 `{ dbType, columns, rows, truncated, elapsedMs }`，其中列项包含 `name` 和 `dataType`。只允许一条经宿主风险分类器判定为只读的 SQL；写入、DDL、`SELECT … FOR UPDATE`、多语句和 `USE` 均会被拒绝。仅复用已打开的 SQL 连接，不会重新连接或提供凭据。`maxRows` 默认 500、最大 5000，序列化行数据最多 8 MiB；`timeoutMs` 不超过连接自身超时和 60 秒。授权撤销后会收到 `PLUGIN_DATA_ACCESS_NOT_GRANTED` 错误。必须依赖该能力时声明 `engines.host_api: "^1.4"`，并保留能力检查。每个桥接实例最多同时执行 4 个查询，插件应排队，避免占满共享连接池。

### 系统剪贴板（读取属于 Host API 1.3）

沙箱不能直接使用 `navigator.clipboard`。写入用 `copy(text)` 或 `clipboard.writeText(text)`，不需要额外权限；读取用 `clipboard.readText()`，需声明 `host.clipboard:read`。调用前分别检查 `capabilities.clipboardWrite` 和 `capabilities.clipboardRead`；旧宿主缺失能力位时按不支持处理。读取失败时应保留键盘粘贴等降级方式。必须依赖读取能力时声明 `engines.host_api: "^1.3"`。

当前源码增加 `clipboard.readImage()`：返回 `{ contentType: "image/png", dataBase64, width, height }`，无图片或读取失败会 reject，检查 `capabilities.clipboardImageRead` 并声明同一读取权限。读取文本和图片共用会话首次确认与 1000 ms 间隔限制，审计最多保留 200 条结果/大小记录，不保存剪贴板内容。没有确认界面的宿主首次读取会拒绝；应保留手动粘贴路径。公开文档中“读取没有后续用户交互”的描述落后于源码。拒绝后的重复读取门控仍需上游确认，插件不要自动重试拒绝请求。

### 持久化 UI 状态

`window.dbxPlugin.storage` 为每个插件隔离的 JSON 键值存储，数据位于宿主的 `plugin-data/<id>` 下。键必须非空、不超过 256 字符且不能含控制字符；单个值最大 256 KiB，插件总量最大 1 MiB；大数据应放到 Sidecar 的 `DBX_PLUGIN_DATA_DIR`。旧宿主不会提供该能力，调用前检查初始化消息中的 `capabilities.storage`，并在无法降级时把 `host.storage` 作为必要权限、把 `engines.host_api` 设置为对应的最低版本。

```js
await window.dbxPlugin.ready;
if (window.dbxPlugin.capabilities.storage) {
  await window.dbxPlugin.storage.set("filters", { sort: "name" });
  const filters = await window.dbxPlugin.storage.get("filters");
  await window.dbxPlugin.storage.delete("filters");
}
```

### 在 DBX AI 中分析插件数据

声明 `host.ai` 后，插件可以把当前数据的 JSON 快照交给内置 AI 面板，也可以为当前 Workbench 提供推荐问题：

```js
await window.dbxPlugin.ready;
if (window.dbxPlugin.capabilities.ai) {
  await window.dbxPlugin.ai.openConversation({
    title: "分析结果",
    prompt: "请找出异常并解释原因。",
    context: { rows, source: "example", fetchedAt: new Date().toISOString() },
    mode: "ask",
    send: true,
  });
}
```

`title` 最多 200 字符，`prompt` 最多 32000 字符，`context` 必须是 JSON 对象且不超过 2 MiB。`mode` 默认为 `ask`；设为 `agent` 时，宿主可通过当前已打开的插件连接提供实时 Sidecar 工具。宿主保存快照作为会话历史，不向插件返回模型回复或模型配置；未配置模型时由用户在 DBX 面板中选择。旧宿主不广播 `capabilities.ai` 时应隐藏入口，不要用请求试探。

Workbench 默认推荐项写在 Manifest 的 `workbench.ai.recommendations` 中；资源切换时可运行时替换：

```js
if (dbxPlugin.capabilities.aiRecommendations) {
  await dbxPlugin.ai.setRecommendations({
    context: { resource },
    items: [
      { id: "health", label: "检查 {{resource.name}}", prompt: "分析 {{resource.kind}}/{{resource.name}} 的健康状态", order: 10 },
    ],
  });
} else {
  // 旧宿主没有推荐能力时隐藏入口
}

await dbxPlugin.ai.clearRecommendations();
```

`items` 最多 5 条；`label` 最多 200 字符，`prompt` 最多 32000 字符。`{{path.to.value}}` 支持对象属性和数组下标，无法解析的路径会隐藏推荐，`__proto__`、`prototype`、`constructor` 等路径会被拒绝。运行时 context 会与当前 Workbench 的 `connectionId` 等绑定信息合并，点击推荐后由 DBX 创建新的 Agent 对话并立即发送。插件不会收到模型输出。

### AI 模型发现与文本生成

Host API 还可以让插件使用 DBX 已配置的 API 模型完成一次受控的纯文本生成。它与 `ai.openConversation` 分开：对话 API 不把模型结果返回给插件，文本生成 API 会返回生成文本，但不会开放工具、文件写入或凭据。

```js
if (window.dbxPlugin.capabilities.aiModelDiscovery) {
  const providers = await window.dbxPlugin.ai.listProviders();
  const models = await window.dbxPlugin.ai.discoverModels(providers[0].configId);
}

if (window.dbxPlugin.capabilities.aiCompletion) {
  const models = await window.dbxPlugin.ai.listModels();
  const text = await window.dbxPlugin.ai.generateText({
    configId: models[0].configId,
    model: models[0].model,
    prompt: "Summarize the selected rows.",
  });
}
```

- `listProviders` 只返回 `configId` 与显示名称；`discoverModels` 由宿主在内部使用保存的凭据，可返回不含密钥的模型选择项。CLI agent 不会出现在文本生成列表中，手工填写模型 ID 也不会修改全局默认值。
- 首次生成前桌面宿主会显示包含插件名、模型名、prompt 首行预览和字节数的确认；用户可选择仅在当前 Workbench 会话记住允许，重新打开工作台需再次确认。每个 Workbench 同时只允许一次生成。`prompt` 必须非空且不超过 100000 字符，返回文本不超过 16000 字符。
- 提供商错误会被归一化，插件不会看到 endpoint、header、Token 或其它凭据。旧宿主可能不提供这两个能力位，应隐藏对应入口并保留其它功能。

`generateText` 与 `generateTextStream` 都可选 `task: "command-generation" | "rewrite" | "classify"`，仅选择宿主预置指令，不能传自定义 system prompt。流式请求额外提供非空、最多 128 字符的 `requestId`；先通过 `onEvent` 订阅 `host.ai.generationChunk`，按 `params.requestId` 过滤 `{ delta, done }`。Promise 完成时返回完整文本；`ai.cancelGeneration(requestId)` 返回 `{ cancelled }`，只能取消当前 Workbench 自己启动的请求。能力位为 `aiCompletionStream`，此宿主 AI 事件由桥直接推送，无需为它额外声明 `host.events`；Sidecar 事件仍需该权限。

`openWorkbench` 还接受可选的 `{ forceNew?: boolean, target?: "tab" }`。`target: "tab"` 只对 dock 等面板宿主有意义，用于把当前插件工作台打开到主工作区标签页；省略时保持原有面板行为。`executeCommand(commandId, context?)` 走与菜单相同的命令注册表路径，会重新检查 `enablement`，合并调用方 context 并由宿主重写保留的身份字段；命令的 `instance_key` 占位符可按 `{{connectionId}}` 等路径隔离面板实例。预期的未知命令或 enablement 拒绝通过 `{ error }` 返回，只有权限或桥接故障才 reject。

### 桌面文件传输与系统拖放

桌面宿主可通过 `window.dbxPlugin.fileTransfer` 将用户明确选择或拖入工作台的本地文件按分块提供给插件。使用 `pick`/`beginSave` 打开原生对话框，使用 `read` 逐块读取；拖放通过 `onDrop` 接收。拖入文件夹会展开为普通文件，并保留 `relativePath`，方便插件重建目录结构。句柄按需打开，选择数量超过共享句柄池时会降级为惰性条目，不会静默丢文件。

`onDrop` 的监听器签名为 `(files, { dropId, truncated })`：`dropId` 用于整组文件的取消和进度记账，`truncated` 表示展开因 2000 个文件或 8 层深度上限被截断。点文件和点目录会跳过。能力探测使用 init 消息中的 additive `capabilities.fileTransfer` 标志（`pick`、`beginSave`、`read`、`drop`、`folderExpansion`），不要靠试调用。Web 宿主可把 `pick`/`beginSave` 降级到浏览器选择和下载，但 `drop` / `folderExpansion` 为 false，且句柄不含 `relativePath`；只在拖放落点位于本插件工作台区域内时触发 `onDrop`。

```js
const transfer = window.dbxPlugin.fileTransfer;
if (transfer && window.dbxPlugin.capabilities.fileTransfer?.drop) {
  const off = transfer.onDrop((files, meta) => {
    for (const file of files) {
      // file.relativePath 可为 folder/nested/file.csv
      uploadFile(file.handleId, file.relativePath ?? file.name, meta.dropId);
    }
    if (meta.truncated) showWarning("文件夹内容已截断，请分批拖放");
  });
}
```

### 桌面浮动窗口

浮动窗口复用已声明的 `workbench`，无需新贡献点、`host.floating` 权限或新的 Manifest 字段。打开需 `host.workbench`，运行前检查能力：

```js
await dbxPlugin.ready;
if (dbxPlugin.capabilities.floating) {
  const { windowId, reused } = await dbxPlugin.floating.open({
    contributionId: "com.example.files.main",
    title: "Files", width: 320, height: 200,
    context: { path: "/" },
  });
}
```

- 同一插件、同一 contribution 只有一个浮动窗口，重复打开会前置已有窗口；UI 是独立实例，共享状态通过 Sidecar 或 `storage`，不能依赖模块内存。
- `open` 可选 `x`/`y`（物理屏幕像素）、`width`/`height`（逻辑像素）、`alwaysOnTop`（默认 true）、`skipTaskbar`（默认 true）、`resizable`（默认 false）。窗口不透明，插件自行绘制背景；位置按插件/contribution 跨重启保留。
- `beginDrag()` 在鼠标按住且越过插件自身拖动阈值后调用；宿主读取原生光标并移动窗口，不需要逐帧传坐标。`endDrag({ snap: true })` 结束、吸附、记忆位置，返回物理矩形或 null；`setSize(width, height)` 使用逻辑像素并受宿主限制。这三项只能在 `context.surface === "window"` 内使用。边缘停靠后先保持可见，光标离开约 2.5 秒后收起，悬停恢复。
- `floating.close(contributionId)` 只关闭指定的本插件窗口；**源码中不传 ID 会关闭本插件全部浮动窗口，即使调用者在小组件中**。公开文档的“内部无参只关自己”与实现不符。要关闭当前承载界面，用 `closeWorkbench()`，或显式传 `dbxPlugin.contributionId`。
- 浮动窗口里的 `openWorkbench` / `openFilesystem` 转交 DBX 主窗口。`executeCommand` 在此 surface 不提供，当前实现会报 `Host command execution is unavailable`，不能把文档中的“成功但不可见”当成返回契约。
- Web 和开发宿主不模拟该能力；未知或缺失能力位时保留 tab/dock 入口。

### Sidecar 流与媒体 URL

`stream(method, params, { streamId?, closeMethod?, timeoutMs? })` 返回 `{ stream: ReadableStream, metadata }`，为调用注入 `streamId`，并消费后端 `host.stream.chunk`（`dataBase64`）、`host.stream.end`、`host.stream.error`（`message`）事件。消费流后应释放 reader；取消会调用 `closeMethod`（默认 `filesystem/stream/close`），参数为 `{ streamId }`。后端必须实现对应业务方法和事件，且声明 `host.events`。它不自动把任意 RPC 变成流，也不能替代插件自己的分块/背压设计。

音视频可检查 `capabilities.mediaUrl`，用 `media.open("filesystem/media/read", params)` 获得 `{ token, url }`，把 URL 交给 audio/video；销毁时 `media.close(token)`。桌面宿主只接受该后端方法，按插件隔离 token，最多 32 个活动源，6 小时过期；资源协议转发 GET/HEAD 与 Range，后端需支持范围读取。完整后端响应字段见 `sidecar-protocol.md`，不要把凭据拼进媒体 URL。

## 3. context 与快照规则

跨边界传递的 context 是 **JSON 数据快照**，宿主会递归剥离 Vue 响应式包装并发送独立副本。因此插件**不能**依赖 Vue ref、Proxy、DOM 节点、函数、组件实例或凭据。

- **允许**：`null`、布尔、有限数字、字符串、数组、普通对象。
- **拒绝**（返回错误）：`Date`、`Map`、`Set`、`Symbol`、`BigInt`、非有限数字、循环引用、自定义 class 实例。
- 对象中的 `undefined` 字段被省略；数组中的 `undefined` 变成 `null`。
- UTF-8 编码后**上限 2 MiB**。

`onContext` 推送变化时**不重载 iframe**，所以插件 UI 状态可以跨导航保留。组件销毁时调用 `onContext`/`onEvent`/`onBinary` 返回的取消订阅函数，避免重复监听。

宿主保留 `workbenchId`、`restored`、`surface` 三个字段，不应由插件伪造。`surface` 当前为 `tab`、`dock` 或 `window`，未知值按 tab 降级；同一 contribution 可同时存在多个 surface，生命周期独立。

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

### 主题负载中的编辑器设置

`dbxPlugin.theme` 与 `dbx-plugin-env` 环境消息中的主题负载可以包含 `{ appearance, tokens, editor? }`。`tokens` 是从文档根节点按 `--color-*`、`--radius-*`、`--font-*` 前缀收集的 CSS 变量；`editor` 是 SQL 编辑器设置的结构化快照，不会转换成 CSS token。

| 宿主设置 | 插件可读值 |
| --- | --- |
| 外观 | `theme.appearance`：`light` 或 `dark` |
| 调色板、自定义颜色 | `theme.tokens` 中的 `--color-*` |
| 圆角风格 | `theme.tokens` 中的 `--radius-*` |
| UI 字体 | `theme.tokens["--font-sans"]` |
| 编辑器等宽字体 | `theme.tokens["--font-mono"]` 与 `theme.editor.fontFamily` |
| 编辑器字号 | `theme.editor.fontSize` |
| SQL 编辑器语法主题 | `theme.editor.theme` |

宿主窗口缩放、数据网格字体和类型配色、编辑器背景图不会传给插件。插件可以将 `theme.editor.fontSize` 用作自身控件的默认字号；字号仍由插件 UI 自己决定。字体族变化通过主题修订更新，字号和语法主题变化也会经 `dbx-plugin-env` 推送，无需刷新页面。

### 动态导入与代码分割

发行包的 UI 入口脚本由宿主内联进沙箱文档。其它 `ui/` 资源仍可通过插件资源协议按需加载，因此动态 `import()` 和 CSS chunk 可用。宿主会向文档注入 `<base>`，插件资源地址限定在本插件的 `ui.root` 下；Vite 请设置 `base: "./"`，webpack 请设置 `output.publicPath: "./"`，让 chunk 与样式表使用相对地址。

不要使用 `/assets/...` 这样的根绝对路径：它缺少插件 ID，无法解析到插件资源，会在宿主中返回 404。DBX 会将资源请求限制在各插件自己的 `ui.root` 内；WebView2 使用 `http://dbx-plugin.localhost/<plugin-id>/...` 映射，其它平台使用 `dbx-plugin://localhost/<plugin-id>/...`。更新插件后不会复用旧资源缓存。

### 样式表、全屏与图形引擎

包内 `<link rel="stylesheet">` 会内联成 `<style>` 并保留 id、`data-*`、media 等属性。`disabled` 内容属性不能可靠控制 `<style>` 的 CSSStyleSheet；默认禁用的样式需加载后显式设 `style.sheet.disabled = true`。不要只查找原来的 link 节点。

真实宿主 iframe 委派 `fullscreen`。调用 `requestFullscreen()` 前检查 `document.fullscreenEnabled`，并由用户动作触发；旧宿主不支持时回退到页面内最大化。

图形引擎（如需 `new Function` 的 WebGL 引擎）有用户按插件开启的授权，默认关闭；宿主据此向 `script-src` 增加 `unsafe-eval`，更改会重建沙箱。它不是 Manifest 权限，不要自行添加 `host.webgl` 或 `unsafe-eval` 字段；也不放宽网络、跨插件或原生访问权限。

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

UI 静态资源可由宿主处理包内链接、使用相对模块 URL/动态 import，或通过 `readAssetUrl` 加载。外部模块的相对依赖应按模块自身 URL 解析，srcdoc 内联 CSS 等相对地址使用宿主注入的 base；CSP 报错时先检查构建产物、相对路径与 `ui.root` 边界。

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
| `ready`、`contributionId`、`context`、`locale`、`theme`、`request`、`invoke`、`notify`、`onInit`、`onContext`、`onEvent`、`onBinary`、`sendBinary`、资源读取、`openWorkbench` | `host.openFilesystem` 等未实现方法会直接报错 |
| 事件、二进制、工作台导航权限会被强制执行 | 原生连接动作、query-result 贡献点、完整 DBX 组件 kit **不模拟** |
| 声明式连接表单、工作台 Tab、RPC、主题切换 | 安装、签名、真实 Secret Store、桌面端生命周期、生产权限 |
| 初始化后读取 contribution identity | floating、closeWorkbench、AI 流式生成、剪贴板图片、媒体流和图形引擎授权均需真实 DBX 验证 |

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
