# Sidecar Protocol v1 参考

## 1. 什么时候需要原生后端

只有**浏览器沙箱无法完成**的能力才需要 Sidecar：

- 原生协议客户端（S3、SSH、SFTP、数据库 wire protocol）
- 系统凭据 / 系统 API / 本地文件系统读写
- 长连接、PTY、流式传输
- 高性能计算或大文件处理

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
    "host": { "dbxVersion": "0.5.68", "hostApiVersion": "1.0.0", "protocolVersions": [1] },
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

`connection` 只在**后端生命周期请求**中携带补齐的 Secret；`runtime.host` / `runtime.port` 是经过 DBX 隧道/代理后的**最终端点**，直接连它。

## 7. 事件

插件通过 emitter 主动推送事件（JSON-RPC 通知）：

```
{"jsonrpc":"2.0","method":"<plugin>/progress","params":{...}}
```

前端用 `window.dbxPlugin.onEvent(fn)` 接收，**需要 `host.events` 权限**。转发后端事件必须有该权限。

**绝对不要在事件、context 或错误消息中泄露 Secret。**

## 8. Rust SDK

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

## 9. Go SDK

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

## 10. 构建集成

模板生成的项目已经接好 SDK，正常路径是直接用 CLI：

```bash
dbx-plugin package .          # Rust: cargo build --release；Go: go build -trimpath
dbx-plugin dev                # Rust 用 debug target；Go 用缓存输出目录
```

- 生成项目的 `Cargo.toml` 依赖 `dbx-plugin-sdk`（版本号由 CLI 注入），`go.mod` require `github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk`。
- CLI 会通过 `DBX_PLUGIN_SDK_ROOT` 把依赖 **patch/replace 到自带或指定的 SDK 源码**（npm 包内置 `sdk-root`，所以默认即生效）。
- **不要绕过 CLI 直接 `cargo build` / `go build`**，除非你自己设置了 `DBX_PLUGIN_SDK_ROOT`，或把依赖改成显式 path/git。
- 开发未发布的 SDK：`dbx-plugin create ... --sdk-root /path/to/dbx`，或打包前 `export DBX_PLUGIN_SDK_ROOT=/path/to/dbx`。

## 11. 工程约束清单

- [ ] stdout 只输出协议消息，日志一律 stderr。
- [ ] `plugin/initialize` 里的 id/version 与 manifest 一致。
- [ ] 请求 ID 支持并发关联（响应可乱序）。
- [ ] `connect` / `disconnect` 幂等。
- [ ] 长任务有超时、取消、分块确认。
- [ ] 不在事件/context/错误消息里泄露 Secret。
- [ ] 用 framed 时 manifest 声明 `stdio-framed` + `host.binary`。
- [ ] release 构建开启 strip/lto 控制体积（模板已配置）。

## 12. 常见错误

| 报错 | 原因 |
| --- | --- |
| `Sidecar identity or protocol does not match manifest` | 初始化响应的 `plugin.id`/`version` 与 manifest 不一致，或协议版本不兼容 |
| 后端启动后立即退出 | 用了 `println!` 污染 stdout；或 `jsonrpc` 字段缺失 |
| 请求一直不返回 | 没有用请求的 `id` 回填响应；或方法名含空格被拒 |
| `Binary messages require framed transport` | 没切换到 framed，或 manifest 未声明 |
| `plugin JSON line is too large` | 单条消息超过 8 MiB，需要分块 |
| 手动 `cargo build` 找不到 `dbx-plugin-sdk` | 没设置 `DBX_PLUGIN_SDK_ROOT`，请改用 `dbx-plugin package` |
