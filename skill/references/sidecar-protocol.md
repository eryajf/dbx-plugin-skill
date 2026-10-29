# Sidecar Protocol v1 参考

## 1. 什么时候需要原生后端

通常只有**浏览器沙箱无法完成**的能力才需要 Sidecar；宿主明确要求原生入口的扩展也是例外：

- 原生协议客户端（S3、SSH、SFTP、数据库 wire protocol）
- 系统凭据 / 系统 API / 本地文件系统读写
- 长连接、PTY、流式传输
- 高性能计算或大文件处理
- 宿主 Redis Plugin 解码扩展（即使算法能用浏览器实现，该入口也要求原生 backend）

> Sidecar **不是 OS 沙箱**，以当前用户权限运行。签名只证明「哪个仓库批准并发布了这个包」，**不保证代码无害**。能纯前端实现就不要加后端。

## 2. 进程模型

- Sidecar 是**持久子进程**，按插件共享（不是每个 Tab 一个）。插件自己维护内部会话注册表。
- **stdout 只用于协议消息**；所有日志/诊断写 **stderr**。
- 宿主支持并发在途请求、按请求超时、严格 JSON-RPC 校验、崩溃传播、状态上报、有界事件缓冲；握手/协议/输出失败会自动终止子进程。
- 安装/回滚/替换/卸载前，DBX 会先拆除插件拥有的连接池；**仍有已保存连接引用该插件时不允许卸载**。

## 3. 初始化握手

DBX 启动每个 Sidecar 后首先发送 `plugin/initialize`：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "plugin/initialize",
  "params": {
    "host": { "dbxVersion": "0.5.68", "hostApiVersion": "1.1.0", "features": ["host.requestUserInput"], "protocolVersions": [1] },
    "plugin": { "id": "vendor.example", "version": "1.0.0" },
    "permissions": ["host.events"]
  }
}
```

插件必须回应（**使用相同的 `id`**）：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "capabilities": ["connections", "events"],
    "plugin": { "id": "vendor.example", "version": "1.0.0" }
  }
}
```

- 响应至少包含 `protocolVersion`、`capabilities`、`plugin: { id, version }`。
- `plugin.id` / `plugin.version` **必须与 `manifest.json` 完全一致**，否则报
  `Sidecar identity or protocol does not match manifest`。
- 协议版本必须在双方支持范围内，否则返回 `-32001`。
- **初始化 `capabilities` 描述后端能力，不等于 Manifest 的 Host 权限列表** —— 两者是不同概念。

## 4. JSON-RPC 消息

请求/响应遵循 JSON-RPC 2.0；插件的**事件是 JSON-RPC 通知**（无 `id`）。

- 请求必须声明 `jsonrpc: "2.0"`；缺失会被拒绝。
- `id` 必须支持**并发关联** —— 响应可以乱序，但必须回填相同 `id`。
- **方法名规则**：非空、长度 ≤256、**不含任何空白字符**。违反返回 `-32600`。
- 通知（无 `id`）**不发送响应**。

### 错误码

| 码 | 含义 |
| --- | --- |
| `-32600` | 非法请求（缺 `jsonrpc`、方法名非法、消息过大） |
| `-32601` | 方法不存在（SDK 的 `method_not_found` / `MethodNotFound`） |
| `-32602` | 参数非法 |
| `-32603` | 内部错误 |
| `-32000` | 通用失败（IO 错误、锁中毒、二进制传输未启用） |
| `-32001` | DBX 与插件没有共同协议版本 |

## 5. 传输

### `stdio-jsonl`（默认）

一行一个 JSON 值，以 `\n` 分隔。**单条 JSON 消息 ≤ 8 MiB。**

### `stdio-framed`

需要 PTY / SFTP / 文件传输等二进制流时使用，**并同时声明 `host.binary`**。

```
kind: u8 | payload_length: u32 big-endian | payload
```

- `kind = 0`：UTF-8 JSON payload。
- `kind = 1`：`channel_length: u16 big-endian | channel UTF-8 | binary bytes`。
- 二进制单帧 **≤ 64 MiB**；channel 名同样受方法名规则约束。

### 尺寸限制总表

| 位置 | 上限 |
| --- | --- |
| Sidecar JSON 单条消息 | 8 MiB |
| Sidecar 二进制单帧 | 64 MiB |
| UI ↔ 宿主 JSON 桥参数 | 2 MiB |
| UI ↔ 宿主 二进制消息 | 8 MiB |
| Workbench context 快照 | 2 MiB |
| 显式桥接超时 | 1–120000 ms |

**大文件传输必须自己做分块、偏移、确认、取消与进度事件**，不要塞进一个巨大的 JSON/base64 值。

## 6. 连接生命周期方法

固定方法名（详见 `contributions.md` §2）：

| 方法 | 说明 |
| --- | --- |
| `connection/test` | 校验连接，通常返回 `{ "success": true, "message": "..." }` |
| `connection/connect` | 建立会话，用 `connection.id` 作为 key；**幂等** |
| `connection/disconnect` | 拆除会话；**幂等**（重复断开不应报错） |
| `connection/action` | 自定义表单动作，参数额外含 `action: { id }` |
| `contextMenu/<contribution-id>` | 连接右键菜单，返回 `{ "message": "..." }` 弹 toast |
| `filesystem/*` | 声明 filesystem-provider 时实现 |

`connection` 只在**后端生命周期请求**中携带补齐的 Secret；`runtime.host` / `runtime.port` 是经过 DBX 隧道/代理后的**最终逻辑端点**，直接连它。多端点协议若在 connection-provider 上声明 `proxy_route: true`，还会收到 `runtime.proxy` SOCKS5 路由，插件应通过它连接广播端点。

### 媒体范围读取

桌面 `dbxPlugin.media.open("filesystem/media/read", params)` 为 audio/video 创建本插件媒体 URL。Host 调用同名 Sidecar 方法时会加入 `head: boolean`，并在浏览器发起 Range 请求时加入 `range: string`；超时为 30 秒。返回 `{ size, offset?, length?, dataBase64?, partial?, rangeNotSatisfiable?, contentType?, etag? }`：`size` 是总字节数，GET 的 base64 解码长度必须等于 `length`，HEAD 可不返回字节。不满足范围时返回 `rangeNotSatisfiable: true` 与总大小，Host 转为 HTTP 416；部分读取转为 206/Content-Range。后端自行实现范围读取，不能把整个大文件一次塞进 JSON。

## 7. 事件

插件通过 emitter 主动推送事件（JSON-RPC 通知）：

```
{"jsonrpc":"2.0","method":"<plugin>/progress","params":{...}}
```

前端用 `window.dbxPlugin.onEvent(fn)` 接收，**需要 `host.events` 权限**。转发后端事件必须有该权限。

**绝对不要在事件、context 或错误消息中泄露 Secret。**

浏览器桥还提供 `dbxPlugin.stream(method, params, options)`：后端收到 `streamId` 后，用 `host.stream.chunk` 推送 `{ streamId, dataBase64 }`，以 `host.stream.end` 或 `host.stream.error`（`message`）结束。取消默认调用 `filesystem/stream/close` 并传 `{ streamId }`。这是事件层封装，不改变 Protocol v1 的帧大小或自动提供背压。

## 8. Host API 1.1：请求用户输入

连接期间需要 MFA、主机密钥确认或账号选择时，Sidecar 可以在宿主已通告 `hostApiVersion >= 1.1.0` 或 `host.features` 含 `host.requestUserInput` 后发起 `host/requestUserInput`。插件发起的请求使用字符串 id；响应为 `{ "action": "submit", "value": "123456" }`、`{ "action": "cancel" }` 或 `{ "action": "timeout" }`。只有 `submit` 带值，其余必须失败关闭。`prompt` 最多 2000 字符，`timeoutSecs` 为 5–600（默认 300），同时最多 4 个未关闭提示。错误 `-32001` 表示无 UI，`-32601` 表示宿主不支持，`-32602` 表示参数非法；均应优雅降级。宿主在提示期间会暂停等待该提示的连接请求超时计时。

Rust SDK 提供 `dbx_plugin_sdk::host_client()`、`HostClient::supports("host/requestUserInput")` 与 `HostClient::request_user_input(...)`。

## 9. 向 DBX 内置 AI Agent 提供工具

原生 Sidecar 可实现 `mcp/tools` 和 `mcp/call`，让用户在「插件中心 → 已安装 → 内置 AI 工具」开启后，由 Agent 模式调用已打开插件连接上的工具。这与工作台的 `host.ai` 快照对话是两条独立能力。

- `mcp/tools` 接收宿主绑定的 `{ "connectionId": "<已打开连接 ID>" }`，返回 `{ "tools": [{ "name", "description", "inputSchema", "annotations"? }] }`；可依据连接是否只读隐藏写工具。
- `mcp/call` 接收 `{ "tool", "arguments", "lifecycle" }`，返回 MCP `CallToolResult`，例如 `{ "content": [{ "type": "text", "text": "..." }], "isError": false }`。内置 Agent 的 `lifecycle` 是已打开连接的 `connection/connect` 快照；外部 MCP 后端在调用时依据宿主保存的连接配置生成载荷。不要把密钥放进工具参数或输出。
- 如需声明工具暴露面，在 Manifest 增加一个 `mcp` contribution：`ai_tools`（默认 `true`）控制内置 AI，`external_tools`（默认 `false`）控制外部 `dbx` MCP 服务；它要求 backend entrypoint，每个 Manifest 最多一个。外部面还可声明 `toolsets`（设置界面分组）、`tools`（最多 64 个工具的 `read` / `write` / `full` 访问级别）和一个 `scope`（连接下的 namespace、目录等子范围）。外部面仍受全局工具/连接白名单约束。
- 内置 Agent 只向已打开的连接提供工具。模型看到的 schema 不含 `connectionId` / `connectionName`，绑定连接 ID 由宿主注入；多个连接由额外的 `dbx_connection` 参数选择。
- 仅 `annotations.readOnlyHint: true` 的工具可直接执行；其他调用会展示完整转发参数，请用户逐次允许或拒绝，五分钟未响应即拒绝。插件自身仍须落实只读和写入保护。
- 外部 `dbx` MCP 面还要同时通过全局 MCP 工具策略和连接白名单；策略支持对带插件前缀的工具名使用通配符，但插件不能把它当作默认授权。外部调用绑定已保存的连接；插件应在 Sidecar 内检查本次 lifecycle 的连接身份、策略与会话归属，不要套用内置 Agent 的“必须已打开”边界。
- 启用 `external_tools` 时，只有在 Manifest `tools` 中声明且带 `access` 的 `mcp/tools` 返回项才会暴露；未声明项不会因 MCP annotation 自动暴露，宿主会按声明级别重写 `readOnlyHint` / `destructiveHint`。工具可引用 `toolsets` 分组；`scope` 的 `argument` 会在每次外部调用中检查，缺少必要范围时返回 `SCOPE_REQUIRED`。不要把 `*`、空值或父路径解释成更宽范围。
- 外部工具还受插件授权、访问上限、逐工具开关与调用安全策略约束；`access: "full"` 可要求用户确认，新工具或访问级别提升必须重新获得授权。插件声明 `mcp` 后，商店目录条目应设置 `mcpTools: true`，让安装前的 MCP 标记可见。
- 内置 Agent 名称为 `<前缀>__<工具名>`，外部 MCP 为 `dbx_<前缀>__<工具名>`；参数名使用字母、数字和下划线，Schema 仅使用宿主支持的可移植子集：`type`、`description`、`properties`、`required`、`items`、字符串 `enum` 及数值、长度和数组数量边界。单次调用最多 120 秒，长任务应返回后台任务句柄。工具输出是供模型读取的不可信数据，只返回事实，不夹带指令。

### 有状态工具：发现、执行与失败

- `mcp/tools` 只返回描述，不创建插件监听器、不连接数据库、不注入故障。宿主为发现而启动 Sidecar，不代表授权启动工作负载。需要会话管理时提供显式 start/stop 工具，标为修改型，并限制会话数量、存活时长和清理时间。
- `mcp/call` 执行前重新检查宿主绑定的连接身份及本次可用策略。发现时隐藏写工具不等于授权，`readOnlyHint` 不授予额外权限；故障实验必须在只读连接或未显式开启注入时拒绝执行。
- 已保存连接配置变化不会保证刷新运行中会话；内置 Agent 使用打开时的 lifecycle 快照，外部调用读取保存配置。无法安全协调差异时，要求先停止再重启会话。
- 转发 PostgreSQL `COMMIT` 后遇到超时/断连，不能据此宣称回滚。没有独立验证时报告事务结果 `unknown`，禁止自动重试可能已经提交的写操作。测试时分别验证传输故障、已提交数据和锁清理；这是插件设计约定，不是 DBX 的通用事务状态 API。

## 10. Rust SDK

`dbx-plugin-sdk`（协议 v1，支持 JSONL 与 framed）。

```rust
use dbx_plugin_sdk::{PluginEmitter, PluginError, PluginHandler, PluginMetadata, PluginServer, RequestContext};
use serde_json::{json, Value};

struct Plugin;

impl PluginHandler for Plugin {
    fn handle(&self, _context: RequestContext, method: &str, params: Value, emitter: &PluginEmitter)
        -> Result<Value, PluginError> {
        match method {
            "example/echo" => {
                emitter.event("example/progress", json!({ "done": true }))?;
                Ok(params)
            }
            _ => Err(PluginError::method_not_found(method)),
        }
    }
}

fn main() -> std::io::Result<()> {
    let metadata = PluginMetadata::new("com.example.files", env!("CARGO_PKG_VERSION"))
        .with_capability("connections");
    PluginServer::new(metadata, Plugin).serve()
}
```

API 速览：

| 项 | 说明 |
| --- | --- |
| `PluginMetadata::new(id, version)` | `.with_capability(name)` 追加能力 |
| `PluginServer::new(metadata, handler)` | `.transport(PluginTransport::Framed)`、`.worker_threads(n)`、`.work_queue_capacity(n)`、`.serve()` |
| `PluginHandler::handle(ctx, method, params, emitter)` | 主分发；`ctx` 含 `request_id`、`driver` |
| `PluginHandler::handle_binary(channel, data, emitter)` | framed 下的宿主→插件二进制；默认返回「不支持」 |
| `PluginError::new(code, msg)` / `PluginError::method_not_found(m)` | 错误构造 |
| `PluginEmitter::event(method, params)` / `PluginEmitter::binary(channel, data)` | 事件与二进制输出 |

- 默认 **2–16 个 worker 线程**（按可用并行度）与 **256 任务队列**；`worker_threads(0)` / `work_queue_capacity(0)` 会被 clamp 到 1。
- `PluginTransport::Framed` 需要在 manifest 声明 `"transport": "stdio-framed"`。

## 11. Go SDK

```go
metadata := dbxpluginsdk.Metadata{
    ID:           "vendor.example",
    Version:      "1.0.0",
    Capabilities: []string{"connections"},
}
server := dbxpluginsdk.NewServer(metadata, handler)
if err := server.Serve(); err != nil {
    log.Fatal(err)   // 日志走 stderr
}
```

API 速览：

| 项 | 说明 |
| --- | --- |
| `Metadata{ID, Version, Capabilities}` | 身份与能力 |
| `NewServer(metadata, handler)` | `.WithTransport(TransportFramed)`、`.WithIO(in, out, errOut)`、`.Serve()` |
| `Handler` / `HandlerFunc` | `Handle(ctx, method, params json.RawMessage, emitter) (any, *PluginError)` |
| `BinaryHandler` | `HandleBinary(channel string, data []byte, emitter *Emitter) *PluginError` |
| `Emitter.Event(method, params)` / `Emitter.Binary(channel, data)` | 事件与二进制输出 |
| `NewError(code, msg)` / `MethodNotFound(method)` | 错误构造 |

- Go SDK 当前支持 JSONL；**framed 也支持**（`TransportFramed`）。
- 不要只改 Manifest 的 `transport` 就认为 Go 已具备二进制帧处理能力 —— 必须真正用 framed 并实现 `HandleBinary`。

## 12. 构建集成

模板生成的项目已经接好 SDK，正常路径是直接用 CLI：

```bash
dbx-plugin package .          # Rust: cargo build --release；Go: go build -trimpath
dbx-plugin dev                # Rust 用 debug target；Go 用缓存输出目录
```

- 生成项目的 `Cargo.toml` 依赖 `dbx-plugin-sdk`（版本号由 CLI 注入），`go.mod` require `github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk`。
- CLI 会通过 `DBX_PLUGIN_SDK_ROOT` 把依赖 **patch/replace 到自带或指定的 SDK 源码**（npm 包内置 `sdk-root`，所以默认即生效）。
- **不要绕过 CLI 直接 `cargo build` / `go build`**，除非你自己设置了 `DBX_PLUGIN_SDK_ROOT`，或把依赖改成显式 path/git。
- 开发未发布的 SDK：`dbx-plugin create ... --sdk-root /path/to/dbx`，或打包前 `export DBX_PLUGIN_SDK_ROOT=/path/to/dbx`。

## 13. 工程约束清单

- [ ] stdout 只输出协议消息，日志一律 stderr。
- [ ] `plugin/initialize` 里的 id/version 与 manifest 一致。
- [ ] 请求 ID 支持并发关联（响应可乱序）。
- [ ] `connect` / `disconnect` 幂等。
- [ ] 长任务有超时、取消、分块确认。
- [ ] 不在事件/context/错误消息里泄露 Secret。
- [ ] 用 framed 时 manifest 声明 `stdio-framed` + `host.binary`。
- [ ] release 构建开启 strip/lto 控制体积（模板已配置）。

## 14. 常见错误

| 报错 | 原因 |
| --- | --- |
| `Sidecar identity or protocol does not match manifest` | 初始化响应的 `plugin.id`/`version` 与 manifest 不一致，或协议版本不兼容 |
| 后端启动后立即退出 | 用了 `println!` 污染 stdout；或 `jsonrpc` 字段缺失 |
| 请求一直不返回 | 没有用请求的 `id` 回填响应；或方法名含空格被拒 |
| `Binary messages require framed transport` | 没切换到 framed，或 manifest 未声明 |
| `plugin JSON line is too large` | 单条消息超过 8 MiB，需要分块 |
| 手动 `cargo build` 找不到 `dbx-plugin-sdk` | 没设置 `DBX_PLUGIN_SDK_ROOT`，请改用 `dbx-plugin package` |

## 15. Redis 值解码器（`redis-value-codec-v1`）

Manifest 顶层声明 `capabilities: [{ "id": "my-codec", "label": "My format", "kind": "redis-value-codec-v1" }]`，并提供原生 `entrypoints.backend`。只列出兼容的原生插件；不需要发明新的 Host 权限或 contribution 类型。

Redis String/bitmap 或集合成员详情页的 Decode 行提供 **Plugin** 选项。枚举插件不会传输值；用户显式选择一个 codec 后，选择仅保留在当前视图，之后可见载荷变化会重新解码，过时响应被丢弃。

宿主向被选中的 Sidecar 发送 JSON-RPC 方法 `redis/codec/decode`，params 示例：

```json
{
  "codecId": "my-codec",
  "rawBase64": "AP+A",
  "context": { "db": 0, "keyRaw": "opaque-key-identity", "redisType": "string" }
}
```

- `rawBase64` 必须是原始字节的规范标准 Base64，保留 NUL 和非 UTF-8 字节；不是已显示文本的二次编码。`keyRaw` 是 Redis API 的不透明键标识，不要猜测编码。
- 集合场景传入当前选中成员/字段值的字节，`redisType` 是所属 Redis 类型；不提供字段或索引身份。
- context 不含数据库凭据、连接配置、连接串或宿主驱动，不要将它当作 `connection/connect` lifecycle。

JSON-RPC `result` 只能是下列形状之一：

```json
{ "format": "json", "value": { "message": "decoded" } }
```

```json
{ "format": "text", "value": "UTF-8 text" }
```

JSON 的 `null`、布尔值、数字、字符串等原始值同样有效；数值遵循 JavaScript 语义，需要精确保留大整数时返回字符串。宿主使用 JSON 树或转义文本渲染，不能返回 HTML 格式。

每次调用超时 **10 秒**；解码前原始输入和 `JSON.stringify(value)` 后的 UTF-8 字节各限 **2 MiB**（文本转义也计入），截断预览不会传给插件。错误会清空旧结果，切换内置 codec 可返回原始视图。此入口只读，不调用 encoder，也不写回 Redis；编码和 round-trip 测试可在插件自己的工作台提供。调用外部程序时使用二进制 stdin/stdout、限制执行时长和输出量，并把诊断写到 stderr；Sidecar 自身 stdout 仍只输出 DBX 协议。

需要带 Redis plugin codec view 的 DBX 构建；旧宿主可能安装插件但不展示解码入口。官方未给出精确最低发行版本，不要猜测 `engines.dbx`。旧 npm CLI 若拒绝 `capabilities`，应使用当前源码 CLI 打包，不要删掉必需元数据。验收应覆盖显式选择、可见值变化、过时响应、二进制保真、非规范 Base64、超限输入/结果及错误后旧结果清空。
