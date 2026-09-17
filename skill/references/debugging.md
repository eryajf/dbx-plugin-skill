# 本地调试参考（`dbx-plugin dev`）

`dbx-plugin dev` 启动一个**独立的浏览器开发宿主**，加载声明的 workbench、运行可选的 Rust/Go Sidecar，**不会启动 DBX 桌面端**。

```bash
cd my-plugin
dbx-plugin dev --path . --port 5190
# 打开终端输出的 http://127.0.0.1:5190/
```

- 要求 **Node.js 22+**。纯前端插件不需要 Rust/Go；原生插件需要各自的工具链和已安装的依赖。
- 只监听 `127.0.0.1`；校验 Host、Origin、浏览器会话、CSRF、资源越界与符号链接边界。
- 端口被占用会自动选空闲端口；`--port 0` 显式要求随机端口。**用实际打印的端口**。

## 1. 项目配置

CLI 读取 `manifest.json` 与 `dbx-plugin.toml`：

- 存在 `[backend]` 时按 Rust/Go 构建并启动 Sidecar；缺失时视作纯前端。
- Manifest 声明了 backend 而 toml 没有（或反之）会直接报错。
- Rust 使用缓存的 debug target 目录；Go 使用缓存的输出目录。
- Rust 依赖若显式写了 `git`/`path` 源，**不会**被 crates.io patch 覆盖。

可选前端构建命令：

```toml
[dev]
ui_build = ["npm", "run", "build"]
ui_watch = ["npm", "run", "build:watch"]
```

- 命令是**可执行文件 + 参数数组，不经过 shell**，在插件目录下执行。
- **不会做框架探测，也不会自动安装依赖** —— 先自己 `npm install`。
- 未配置这些选项时，直接服务并监听已有的 UI 静态文件。

## 2. `DBX_UI_BUILD_SUCCESS` 契约（最容易踩）

配置了 `ui_watch` 时，监听命令必须在**每次完整成功的构建之后**，向 stdout 打印**独立一行**：

```
DBX_UI_BUILD_SUCCESS
```

- 只有这个信号会触发 UI 自动重载；部分输出、构建失败都**不会**触发。
- 必须挂在构建工具的**成功完成回调**上，**不要**放在失败路径或无条件的退出钩子里。
- 未配置 `ui_watch` 时，静态 UI 文件仍按文件变化做防抖重载。
- 该协议与前端框架无关。Svelte 模板已在 `vite.config.js` 里用 `closeBundle` 钩子实现。

> 改完 UI 页面不刷新，**九成是这里**：要么没配 `ui_watch`，要么构建脚本没打印（或打印在了失败分支）。

Manifest 或运行时变更需要**重启 `dev`**。

## 3. 调试面板

点击「重载页面」右侧的「调试」，底部面板显示最近 **500 条**内存日志（重启服务即清空），支持级别筛选、清空视图、自动滚动。终端同步输出 `[dbx-dev]` 前缀日志。

包含：监听端口、项目/UI/backend 路径、HTTP 路由与状态、RPC ID/方法/耗时、可展开的 JSON 入参出参、结构化错误数据、事件、会话拒绝原因。

脱敏规则：密码/令牌/凭据字段与 Manifest 声明的 secret 字段**递归脱敏**；二进制/base64 内容省略；过长/过深的值截断。**普通业务值仍然可见**（含连接名、SQL 等），所以只用开发数据。

Sidecar 的 stderr 会被消费但**不转发到日志**（因为任意插件可能打印凭据）。

## 4. 自动重载

- 默认**关闭**，开关对所有连接的浏览器生效；启用时会提示可能丢失草稿。
- 稳定 UI 产物变化 → 重载所有插件 frame；**编译型 UI 仍需要 `[dev].ui_watch`**。
- backend 目录下的 `.rs`/`.go` 与 Cargo/Go module 文件变化 → 防抖、串行化的重建 + 重启。
- 忽略 `target`、`.dbx-dev`、`vendor`、`node_modules`。
- 已保存的连接配置保留，但**后端重启后需要重新连接**。
- 构建失败会让后端保持停止，**不会回退到旧二进制**；写入不会被重放。
- 关闭开关只会取消待处理工作，**不会中断已开始的构建**；重启调试服务后回到关闭状态。
- 这是**重载/重启，不是保留状态的 HMR**。

## 5. 语言与主题

「调试」左侧的语言按钮同时切换**开发外壳与插件**的 locale（`zh-CN` / `en`）：外壳控件、对话框、诊断标签、Manifest 本地化文案一起更新。已保存的连接名与业务数据**不翻译**。

有活动页面时会确认（可能丢失草稿）后自动重载该页面；取消则语言不变。其它已打开的 frame 收到标准 `env` 消息。新页面用选中的 locale。

**插件内容必须自带翻译** —— Manifest 的 `localizations` 只覆盖声明元数据，不翻译插件 UI 文本。

## 6. 导入连接配置

用 UI 的 JSON 文件选择器导入：

```json
{
  "connections": [
    {
      "providerId": "example.connection",
      "values": { "display_name": "Example", "host": "localhost", "port": 0 },
      "readOnly": false
    }
  ]
}
```

字段名来自插件 manifest，不是运行时。导入的记录会分配新 ID。**没有内置协议预设、文件系统 RPC 或插件专用适配器。**

## 7. 诊断 API（脚本 / Agent 读取）

```bash
curl -sS 'http://127.0.0.1:5190/api/diagnostics?after=0&limit=100'
```

- **只支持 `GET`**；不需要 cookie 或自定义 header（Host/Origin 校验仍然生效，也不开放 CORS）。
- 端口用 `dev` 实际打印的值。

**查询参数**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `after` | `0` | 排他性条目标 ID（上一页的 `nextAfter`） |
| `limit` | `100` | 1–500 |
| `level` | 全部 | `debug` / `info` / `error`，**精确匹配** |
| `instanceId` | — | 上一页响应里的实例 ID |

**响应字段**：`entries`、`nextAfter`、`hasMore`、`instanceId`、`reset`、`truncated`、`oldestId`、`latestId`、`plugin`、`backendState`、`port`。

**轮询配方**

1. 首次：`?after=0&limit=100`（需要就加 `level=error`）。
2. 下一次：带上上一页的 `nextAfter`（作为 `after`）与 `instanceId`，**保持同样的筛选条件**。
3. `hasMore` 为真 → 立刻取下一页；否则以温和间隔轮询（例如每秒一次）。
4. `reset` → 服务实例变了或游标超出当前历史，响应已从可用历史开始。
5. `truncated` → 旧条目已从 500 条环形缓冲中丢弃。
6. **更改筛选条件要重新从 `after=0` 开始。**

轮询本身不会产生诊断条目；历史不持久化；该接口**不能调用插件操作**。

用随附脚本便捷读取（自动沿用 `nextAfter` + `instanceId`）：

```bash
node <skill-root>/scripts/dev-logs.mjs --port 5190 --level error --follow
```

## 8. 支持边界（dev 不模拟什么）

**支持**

- 声明式连接表单：字段、默认值、选项、binding、端口 0（框架层允许，语义由插件自己校验）。
- 连接生命周期 `connection/test` / `connect` / `disconnect`，`success: false` 按真实宿主规则视为失败。
- 工作台 Tab：按贡献点 + 可选连接 ID 建键，切换时保留 iframe，重复打开复用已有 Tab；关闭某个连接的最后一个 Tab 会在确认后断开连接。
- 自定义 RPC 方法与结果原样转发（不解释业务含义）。
- Host API 子集：`ready`、`context`、`locale`、`theme`、`request`、`invoke`、`notify`、`onInit`、`onContext`、`onEvent`、`onBinary`、`sendBinary`、资源读取、`openWorkbench`。
- 后端传输：默认 `stdio-jsonl` 与显式 `stdio-framed`，协议 v1；初始化会校验插件身份与版本。二进制通道需要 framed。
- 权限强制执行：event、binary、workbench 导航权限会被检查。
- 图标：workbench 条目/Tab/连接行使用贡献点 `icon`，回退到插件级 `icon`；图标路径相对**插件项目根**（不是 UI root），拒绝远程 URL 与越界路径；缺失时用宿主通用图标。

**不支持 / 必须在真实 DBX 复验**

- `host.openFilesystem` 等未实现方法**直接返回错误**。
- 原生连接动作（connection actions）、query-result 贡献点、完整 DBX 组件 kit **不模拟**。
- 安装、签名、真实 Secret Store、桌面端生命周期、生产权限**不模拟**。
- 不读取 DBX 用户 profile，不模拟 Keychain / 桌面端 Tab 恢复。
- 不启用直接的插件 UI 网络访问。

## 9. 数据与隔离

- 开发配置（**含凭据，明文**）默认存 `<项目>/.dbx-dev/connections.json`；支持的平台会设 0700/0600 权限。
- 自定义 `--data-dir` 必须**留在 `[package].include` 与 UI 资源根之外**，并从源码控制中排除。打包（含嵌套目录）会拒绝 `.dbx-dev`。
- 凭据不会出现在列表摘要与 iframe context 中；诊断会按规则脱敏。
- 页面的事件流断开后，其 frame 保留 **30 秒**重连宽限期，然后移除；仍被其它页面使用的连接保持打开。已保存的连接配置不受影响。
- **这不是 OS 沙箱**：Sidecar 以当前用户权限运行。

## 10. 在真实 DBX 中做最终验收

未签名包只用于自己构建的本地测试：

1. DBX 顶部工具栏 → **插件中心**。
2. 切到 **设置**。
3. 展开 **第三方与开发者选项**。
4. 开启 **允许安装未签名开发包**。
5. 点 **安装 `.dbxp`**，选择 `dist/` 里的文件。
6. 切到 **已安装**，打开插件的工作台或入口。

本地开发包允许用相同版本重新安装（DBX 会替换当前开发版本并重启插件运行时）；**正式签名包仍不允许覆盖同版本**。测试完建议关闭该开关 —— 它只影响手动本地安装，不会放宽官方商店的签名校验。

### 本地验收清单

- [ ] 关闭未使用的权限，确认 Manifest 权限与实际调用一致。
- [ ] 用空配置、错误凭据、超时、断网、Sidecar 重启分别测失败路径。
- [ ] 测 DBX 浅色/深色主题与 `zh-CN`/`en`；确认插件 UI 自己做了翻译。
- [ ] 测重新连接、关闭工作台、重复打开同一工作台、context 为空的情况。
- [ ] 检查包内资源路径、可执行文件权限，以及最终包是否包含不该发布的文件。
- [ ] 大文件传输、长任务、取消路径。

## 11. 排查流程

```bash
# 1) 项目本身是否自洽
node <skill-root>/scripts/check-project.mjs .

# 2) dev 是否起来
dbx-plugin dev --path . --port 5190

# 3) 看错误日志
node <skill-root>/scripts/dev-logs.mjs --port 5190 --level error --follow
```

| 现象 | 排查方向 |
| --- | --- |
| 页面白屏 | 调试面板看 HTTP 404 / CSP 报错；确认 UI 已构建进 `ui.root` |
| `dev requires a UI entrypoint` | manifest 缺 `entrypoints.ui.entry` |
| `UI entry must be inside its declared root` | `entry` 没落在 `root` 内（root=`ui` 时要写 `ui/index.html`） |
| `Project declares a backend but manifest does not` | `dbx-plugin.toml` 的 `[backend]` 与 manifest 的 `entrypoints.backend` 不一致 |
| `dev supports Rust and Go backends` | `[backend].language` 写了别的值 |
| 改了 UI 不刷新 | 见 §2 `DBX_UI_BUILD_SUCCESS` |
| 改了后端代码没重启 | 确认改的是 `[backend].directory` 内的 `.rs`/`.go`/module 文件；构建失败会让后端保持停止 |
| Sidecar 启动即退出 | 后端把日志写到了 stdout；日志必须走 stderr |
