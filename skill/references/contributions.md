# 贡献点（Contributions）参考

所有贡献点声明在 `manifest.json` 的 `contributions` 数组里。Schema 用 `oneOf` 校验，所以每一项必须**精确匹配**其中一种类型。

| 类型 | 必需字段 | 用途 |
| --- | --- | --- |
| `connection-provider` | `type`、`id`、`database_type`、`fields` | 声明连接表单与连接生命周期 |
| `workbench` | `type`、`id`、`label` | 从侧边栏/插件入口打开的工作台 |
| `filesystem-provider` | `type`、`id`、`label`、`schemes` | 接入 DBX 通用文件管理器 |
| `context-menu` | `type`、`id`、`label`、`menu` | 连接右键菜单项（v1 仅 `connection`） |
| `result-view` | `type`、`id`、`label` | 查询/任务结果的插件视图 |

通用可选字段：`description`、`icon`（包内相对路径，缺失时回退到插件级 `icon`）。

> 声明了贡献点**不等于**实现了业务逻辑。`filesystem-provider` 必须真的实现对应后端方法；`context-menu` 必须真的有后端。

---

## 1. `connection-provider`

负责声明连接表单；**DBX 负责渲染表单和保存生命周期**，插件只处理自己的连接协议。

```json
{
  "type": "connection-provider",
  "id": "com.example.files.connection",
  "label": "Example Service",
  "icon": "assets/connection.svg",
  "database_type": "example-files",
  "description": "Connect to an Example Service.",
  "fields": [
    { "key": "display_name", "label": "Name", "type": "text", "binding": "name", "required": true },
    { "key": "endpoint", "label": "Endpoint", "type": "text", "binding": "host", "required": true },
    { "key": "port", "label": "Port", "type": "number", "binding": "port", "default": 443 },
    { "key": "region", "label": "Region", "type": "radio",
      "options": [{ "label": "US", "value": "us" }, { "label": "EU", "value": "eu" }], "binding": "config" },
    { "key": "token", "label": "Access token", "type": "password", "binding": "secret", "required": true }
  ],
  "workbench": "com.example.files.main",
  "capabilities": ["test", "connect", "disconnect"],
  "actions": [
    { "id": "refresh", "label": "Refresh metadata", "variant": "outline",
      "when": "edit", "requires_valid_form": true, "timeout_ms": 30000 }
  ]
}
```

### `database_type`
插件自定义的连接类型标识（如 `ssh`、`example-files`）。**它不会给 DBX 内置数据库枚举添加成员**；保存后存放在 `plugin_connection_type`。

### `fields`
每个字段必须有 `key`（`identifier`）、`label`（非空）、`type`。

- `type` 枚举：`text`、`password`、`number`、`boolean`、`select`、`radio`、`textarea`。
- `select` / `radio` **必须**提供非空 `options`；每项 `{ "label": 非空, "value": 字符串 }`。其它类型**不允许**出现 `options`。
- 可选：`description`、`placeholder`、`required`（bool）、`default`（string|number|boolean|null，必须符合字段类型）、`binding`。
- 条件字段：
  - `visible_when` / `required_when`：`{ "field": "<ident>", "one_of": ["v1", "v2"] }`（`one_of` 至少 1 项）。
- `binding: "port"` **必须** `type: "number"`。
- `binding` 为 `secret` / `name` / `host` / `username` / `password` / `database` 时，`type` 只能是 `text`、`password`、`select`、`radio`、`textarea`（不能是 `number`/`boolean`）。

### `binding` 语义（决定存储位置）

| binding | 存储 |
| --- | --- |
| `name`、`host`、`port`、`username`、`password`、`database` | 映射到标准连接字段 |
| `config` | 写入 `external_config[field.key]`（非敏感） |
| `secret` | 写入 Secret Store 的 `connection_secrets[field.key]`（**不落 `config_json`**） |
| 省略且 `type: "password"` | 默认按 `secret` 处理 |
| 省略其它类型 | 不持久化到上述任一位置（仅表单值） |

> **绝对不要**把密码、Token、私钥放到 `config`、Workbench context、事件或日志里。非敏感的补充配置才用 `config`。

插件连接的 `external_config` 会在新建、编辑、保存和重新连接流程中保留；升级插件时要显式迁移自己拥有的 `external_config`。

### `capabilities`
枚举 `test`、`connect`、`disconnect`，unique。声明什么就要实现什么（见 §2）。

### `workbench` / `filesystem_provider`
- `workbench`：指向本插件已声明的 workbench。打开该连接时进入自定义工作台。
- `filesystem_provider`：指向本插件已声明的 filesystem-provider。打开该连接时连接生命周期 + 打开 DBX 通用文件管理器。
- **同时声明两者时默认打开工作台**；沙箱 UI 可用 `openFilesystem(providerId, context)`（需 `host.filesystem`）主动切到文件管理器。

### `actions`（连接对话框自定义动作）
- 只声明按钮元数据。点击后 DBX 调用固定的 `connection/action`，参数含 `action: { id }`；**插件不能自定义 RPC 方法名**。
- `id`（identifier）、`label`（非空）必需；可选 `description`、`variant`（`default` | `outline` | `secondary` | `destructive` | `ghost`）、`when`（`always` | `create` | `edit`）、`close_on_success`（bool）、`requires_valid_form`（bool）、`timeout_ms`（1–120000）。
- `test`、`save`、`save-and-connect` 是**宿主拥有**的动作，由 capabilities 与对话框模式生成，不走 `actions`。
- 只有 `requires_valid_form: false` 才允许表单不完整时执行；但 DBX 仍会校验已声明字段的类型、secret key 与传输配置。

**`connection/action` 返回值**：

```json
{
  "success": true,
  "message": "Endpoint discovered",
  "fieldValues": { "host": "db.internal", "port": 5432 }
}
```

- `fieldValues` 只能包含**该 provider 已声明**的字段，且必须符合声明类型；`null` 表示清空。
- 返回 `success: false` 表示失败。
- 插件不能写任意 `ConnectionConfig` 键，也不能绕过 DBX 的保存、Secret 持久化、传输层和连接生命周期。

---

## 2. 连接生命周期方法（后端必需）

固定方法名：`connection/test`、`connection/connect`、`connection/disconnect`；自定义动作走 `connection/action`。

**请求参数**：

```json
{
  "provider": { "id": "com.example.files.connection", "databaseType": "example-files" },
  "connection": { "id": "...", "db_type": "plugin", "...": "..." },
  "runtime": { "host": "127.0.0.1", "port": 49152 },
  "action": { "id": "refresh" }
}
```

- `connection` 只在**后端生命周期请求**中携带补齐的 Secret；前端只能拿到 `connectionId` 和非敏感导航上下文。
- `runtime.host` / `runtime.port` 是**经过 DBX 隧道/代理转换后的最终端点**。协议插件必须连这里，**不要自己重建 DBX 隧道**。
- 后端用 `connection.id` 保存会话。连接/断开应当**幂等**；长任务要有超时、取消与分块确认。
- `test` 通常返回 `{ "success": true, "message": "..." }`。

---

## 3. `workbench`

注册一个可从侧边栏或插件入口打开的工作台。UI 在 `sandbox="allow-scripts"` 的 iframe 中运行，**无父页面 DOM 访问、无 Tauri 对象、默认无网络**。宿主注入 `window.dbxPlugin`，详见 `host-api.md`。

```json
{ "type": "workbench", "id": "com.example.files.main", "label": "Files", "icon": "assets/plugin.svg" }
```

- 打开工作台时把 context 以 **2 MiB 内的 JSON 快照**传给插件（递归去除 Vue 响应式包装）。
- 切换 Tab 时 iframe 保留（不重载），所以插件 UI 状态可跨导航保留。

---

## 4. `filesystem-provider`

让 DBX 通用文件管理器接管浏览/分页/预览，插件只实现存储协议。

```json
{
  "type": "filesystem-provider",
  "id": "com.example.files.fs",
  "label": "Object storage",
  "icon": "assets/filesystem.svg",
  "schemes": ["s3"],
  "root_uri": "s3://bucket/",
  "capabilities": ["read", "write", "delete", "rename", "mkdir"]
}
```

- `schemes`：非空、unique 的字符串数组（`capability` 形态：`^[a-z0-9][a-z0-9._:-]*$`）。
- `root_uri`：可选，`^[a-z0-9._-]+:.+$`，长度 2–4096，例如 `s3://bucket`。
- `capabilities` 枚举 `read`、`write`、`delete`、`rename`、`mkdir`。**写操作未声明对应 capability 会被拒绝。**

### 后端 RPC 方法

所有方法都携带 `providerId` 与可选 `connectionId`。

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `filesystem/list` | `uri`、可选 `cursor`、有界 `limit` | `{ entries, nextCursor? }` |
| `filesystem/read` | `uri`、有界 `maxBytes` | `{ dataBase64, contentType?, truncated, etag? }` |
| `filesystem/write` | `uri`、`dataBase64`、`create`、`overwrite`、可选 `etag` | `{ success, message?, entry? }` |
| `filesystem/createDirectory` | `uri` | `{ success, message?, entry? }` |
| `filesystem/delete` | `uri`、`recursive` | `{ success, message?, entry? }` |
| `filesystem/rename` | `sourceUri`、`targetUri`、`overwrite` | `{ success, message?, entry? }` |

### 目录项与分页规则

- 每项包含：`name`（**单个文件名**，不含 `/`、`\`，不能是 `.` 或 `..`）、完整 `uri`、`kind`（`file` | `directory` | `symlink` | `other`），可选 `size`、`modifiedAt`、`contentType`。
- 完整路径放在 `uri`，不要把路径塞进 `name`。
- **最后一页必须省略 `nextCursor`**；不要返回已经使用过的 cursor。
- 图片预览要返回**真实 MIME + base64 字节**，不要把二进制当 UTF-8 文本。
- **内联读写上限 4 MiB**。大文件传输要用 `stdio-framed` 二进制通道 + 自定义传输方法（分块、进度、取消、确认），**不能**塞进一个巨大的 JSON/base64。
- DBX 会在前端拿到结果前校验 scheme、响应大小、base64、cursor 和条目元数据。

---

## 5. `context-menu`

```json
{ "type": "context-menu", "id": "com.example.inspect", "label": "Inspect endpoint", "menu": "connection" }
```

- `menu` 目前只能是 `"connection"`（已保存连接的侧边栏右键菜单）。
- 由 DBX **原生渲染**（无 iframe，跟随原生主题与键盘行为）。
- 点击后向后端发送 `contextMenu/<contribution-id>`，payload 是非敏感连接摘要 `{ id, dbType, name, database }`。
- **必须有后端入口**。返回 `{ "message": "..." }` 会在界面上弹 toast。

---

## 6. `result-view`

```json
{ "type": "result-view", "id": "com.example.graph", "label": "Graph" }
```

- 在结果网格旁加一个工具栏按钮；点击后用当前结果作为 context 打开**本插件的 workbench**（因此需要 UI 入口）。
- `context.result` 是**有界快照**：`{ columns, rows (≤ 500), truncated }`，外加 `sql`、`connectionId`、`database`。
- 需要完整/流式结果时，用 `sql` + 连接引用通过自己的后端重新执行查询。

---

## 7. 组合与引用规则

- 同一插件内通过 `id` 互相引用：Connection Provider 的 `workbench` 必须指向已声明的 workbench；`filesystem_provider` 必须指向已声明的 filesystem-provider。悬空引用会在运行时校验失败。
- 图标优先级：Contribution 的 `icon` → 插件级 `icon` → DBX 内置通用图标。
- 声明图标文件必须留在包内，可用 SVG、PNG、JPEG、GIF、WebP、ICO。**商店目录只接受 SVG / PNG**（见 `publishing.md`）。SVG 以图片 URL 渲染，不会注入 DBX 文档。

---

## 8. 常见错误

| 现象 | 原因 |
| --- | --- |
| `select`/`radio` 没有 `options`，或 `text` 出现 `options` | Schema 的 `allOf` 条件校验 |
| `binding: "port"` 但 `type` 不是 `number` | 同上 |
| `binding: "secret"` 配 `type: "number"` | 同上（secret 只允许文本类字段） |
| 连接表单能保存但后端收不到值 | 字段没声明 `binding`（非 password 类型不会持久化） |
| 打开连接后菜单/文件管理器没反应 | 声明了 Contribution 但没实现 `contextMenu/<id>` 或 `filesystem/*` |
| 文件列表翻页死循环或重复项 | 最后一页没有省略 `nextCursor`，或复用了旧 cursor |
| 大文件上传失败/超时 | 用了内联 `filesystem/write`（4 MiB 上限）而非 framed 分块传输 |
| 结果视图拿不到完整数据 | `context.result` 是有界快照（≤500 行），需要重新执行查询 |
