# Manifest v1 参考

`manifest.json` 是**运行时契约**，必须位于插件包根目录。DBX 与 CLI 都会校验它。

- 编辑器 Schema（上游，`main` 分支）：`https://raw.githubusercontent.com/t8y2/dbx/main/plugins/manifest.schema.json`
- Manifest v1 **拒绝任何未声明的字段**（`additionalProperties: false`）。Schema 只是编辑期辅助，**运行时校验才是边界**。

> ⚠️ CLI 生成的模板里 `$schema` 指向 `.../t8y2/dbx/plugin-sdk-v1/plugins/manifest.schema.json`，该 ref 当前**不存在（404）**。需要编辑器提示就改成 `main` 或某个版本 tag。

## 1. 顶层字段

| 字段 | 必需 | 约束 |
| --- | --- | --- |
| `$schema` | 否 | 任意字符串，不参与身份校验 |
| `manifest_version` | **是** | 必须为数字 `1` |
| `id` | **是** | `^[a-z0-9][a-z0-9._-]*$`，Schema/商店上限 128 字符；CLI 宽松到 256，但**上架请控制在 128 内**。发布后不可更改 |
| `name` | **是** | 非空字符串 |
| `icon` | 否 | 包内相对路径，见 §4 路径规则 |
| `version` | **是** | 严格 SemVer（CLI 用 semver 解析，如 `1.0.0`、`1.0.0-beta.1`）。相同 `id`+`version` 的正式包不可覆盖 |
| `publisher` | **是** | 非空字符串。Schema 不限格式，但**上架时商店要求**候选 `publisher` 匹配 `^[a-z0-9][a-z0-9._-]{0,127}$` 且已登记，且与包内 manifest 完全一致。实践：用小写标识符 |
| `description` | 否 | 字符串 |
| `source` | 否 | `^https?://\S+$`，源码仓库地址 |
| `homepage` | 否 | `^https?://\S+$` |
| `engines` | **是** | 至少含 `host_api`，见 §2 |
| `permissions` | 否 | 见 §2 |
| `entrypoints` | 否 | 有贡献点/后端时按需声明，见 §3 |
| `contributions` | 否 | 见 `contributions.md` |
| `localizations` | 否 | 见 §5 |

**因未知字段被拒的典型**：手写 `signingKeyId`（属于商店 artifact metadata，不是 Manifest 字段）、`verified`、`author`、`license`、`repository` 等自造键。

## 2. `engines` 与 `permissions`

```json
{
  "engines": { "dbx": ">=0.5.68", "host_api": "1" },
  "permissions": [
    "host.workbench",
    "host.events",
    "host.filesystem",
    "host.binary",
    "host.network:https://s3.example.com:443"
  ]
}
```

- `engines.host_api` 必需（`minLength: 1`，推荐 `"1"` 或 `"^1.0"`）；`engines.dbx` 可选，是产品版本范围（模板默认 `>=0.5.68`）。
- 固定权限枚举：`host.events`、`host.binary`、`host.workbench`、`host.filesystem`。
- 网络权限 `host.network:https://<host>[:port]`：
  - **必须 HTTPS**；主机名只允许 `[A-Za-z0-9._-]`，端口可选数字；
  - **不允许路径、通配符、Token**；
  - **最多 8 个**，重复会被拒绝；
  - 作用仅是把这些 origin 加入沙箱 CSP 的 `connect-src`，**仍受目标服务 CORS 约束**；
  - 它**不是** Sidecar 的防火墙 —— 原生后端不受此限制。
- `permissions` 数组本身要求 `uniqueItems`。只声明真正用到的权限；reviewer 会逐一核对调用点。

## 3. `entrypoints`

```json
{
  "entrypoints": {
    "ui": { "root": "ui", "entry": "ui/index.html" },
    "backend": {
      "protocol_versions": [1],
      "transport": "stdio-jsonl",
      "executable": "bin/linux-x64/backend"
    }
  }
}
```

### ui
- 只要求 `entry`（`minLength: 1`）；`root` 可选，默认 `ui`。
- **`entry` 必须位于 `root` 内**：`root` = `ui` 时写 `ui/index.html`，**不是** `index.html`。路径按字符串前缀判断。
- `entrypoints.ui.kind` 已废弃，打包时**直接报错**（UI 永远是沙箱化）。

### backend
- 只要求 `executable`（`assetPath`）。
- `transport` 枚举 `stdio-jsonl`（默认）| `stdio-framed`；需要二进制帧时必须用 `stdio-framed` **并**声明 `host.binary`。
- `protocol_versions`：正整数数组，`minItems: 1`，unique；当前协议只有 `1`。
- 已废弃字段会导致打包失败：`binaries`、`protocol`。

**打包时 CLI 会重写 backend 入口**（`package` 阶段，只影响包内那份 manifest）：

1. `executable` 被强制改写为 `bin/<target>/<binary>`（`<binary>` 来自 `dbx-plugin.toml` 的 `[backend].binary`，Windows 追加 `.exe`）；
2. `protocol_versions` 恰为 `[1]` 时**删除该字段**；
3. `transport` 恰为 `"stdio-jsonl"` 时**删除该字段**。

所以源码 manifest 里写 `bin/<platform>/...` 没有意义，按 §4 的规则，实际由 `target` 决定。

## 4. 包内路径规则（`assetPath`）

所有包内路径（`icon`、`ui.root`、`ui.entry`、`backend.executable`、Contribution 的 `icon`）：

- **不能**以 `/` 开头；
- **不能**包含反斜杠 `\`；
- **不能**包含 `.` 或 `..` 作为路径段；
- **不能**出现重复斜杠 `//`；
- 必须相对包根且实际存在。

CLI 打包还会校验：`icon` / `ui.entry` 指向的文件必须存在，且**被 `[package].include` 覆盖**，否则报
`manifest UI entry 'ui/index.html' is not covered by [package].include`。

## 5. `localizations`

覆盖插件级与贡献点级文案。locale key 形如 `^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$`（如 `zh-CN`、`en`）。

```json
{
  "localizations": {
    "zh-CN": {
      "name": "示例文件",
      "description": "示例插件说明。",
      "contributions": {
        "com.example.files.connection": {
          "label": "示例服务",
          "description": "由插件声明的连接表单。",
          "fields": {
            "host": { "label": "主机", "placeholder": "请输入主机" }
          },
          "actions": {
            "refresh": { "label": "刷新元数据" }
          }
        }
      }
    }
  }
}
```

- 可覆盖：`name`、`description`；每个 Contribution 的 `label`、`description`、`fields`（`label`/`description`/`placeholder`/`options`）、`actions`（`label`/`description`）。
- `fields.<key>.options` 是 **`value → 显示文案` 的映射对象**（`{"readonly": "只读"}`），不是数组。
- DBX 匹配顺序：精确 locale → 基础语言 → manifest 默认文案。
- **它不翻译插件 UI 自己的文本**，UI 文案要按 `window.dbxPlugin.locale` 自行处理。

## 6. 最小可用示例

```json
{
  "$schema": "https://raw.githubusercontent.com/t8y2/dbx/main/plugins/manifest.schema.json",
  "manifest_version": 1,
  "id": "com.example.files",
  "name": "Example Files",
  "version": "0.1.0",
  "publisher": "example",
  "description": "Browse files from an example service.",
  "icon": "assets/plugin.svg",
  "source": "https://github.com/example/dbx-plugin-files",
  "homepage": "https://github.com/example/dbx-plugin-files",
  "engines": { "host_api": "1", "dbx": ">=0.5.68" },
  "permissions": [],
  "entrypoints": { "ui": { "root": "ui", "entry": "ui/index.html" } },
  "contributions": [
    {
      "type": "workbench",
      "id": "com.example.files.main",
      "label": "Files",
      "icon": "assets/plugin.svg"
    }
  ]
}
```

## 7. 带原生后端的完整示例

```json
{
  "manifest_version": 1,
  "id": "com.example.files",
  "name": "Example Files",
  "version": "0.1.0",
  "publisher": "example",
  "description": "Browse files from an example service.",
  "icon": "assets/plugin.svg",
  "engines": { "dbx": ">=0.6.0", "host_api": "1" },
  "permissions": ["host.workbench", "host.events", "host.binary", "host.network:https://s3.example.com:443"],
  "entrypoints": {
    "ui": { "root": "ui", "entry": "ui/index.html" },
    "backend": {
      "protocol_versions": [1],
      "transport": "stdio-framed",
      "executable": "bin/darwin-arm64/dbx-plugin-example-files"
    }
  },
  "contributions": [
    {
      "type": "connection-provider",
      "id": "com.example.files.connection",
      "label": "Example Service",
      "icon": "assets/connection.svg",
      "database_type": "example-files",
      "fields": [
        { "key": "display_name", "label": "Name", "type": "text", "binding": "name", "required": true },
        { "key": "endpoint", "label": "Endpoint", "type": "text", "binding": "host", "required": true },
        { "key": "port", "label": "Port", "type": "number", "binding": "port", "default": 443 },
        { "key": "token", "label": "Access token", "type": "password", "binding": "secret", "required": true }
      ],
      "workbench": "com.example.files.main",
      "capabilities": ["test", "connect", "disconnect"]
    },
    {
      "type": "workbench",
      "id": "com.example.files.main",
      "label": "Files",
      "icon": "assets/plugin.svg"
    }
  ]
}
```

## 8. CLI 与 Schema 的差异（容易踩）

| 项 | Schema / 运行时 | CLI `package` |
| --- | --- | --- |
| `id` 长度 | ≤128 | ≤256（更宽松，但商店按 128 校验） |
| `version` 格式 | 正则 `^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$` | semver crate 严格解析（`1.0.0-alpha+build` 只在 semver 侧通过） |
| `icon` 存在性 | 不校验 | **必须存在且被 `[package].include` 覆盖** |
| UI entry 在 root 内 | 不校验 | **校验** |
| backend 与 toml 一致 | 不校验 | **校验**（要么都有要么都没有） |
| 未知字段 | `additionalProperties: false` | 打包时显式拒绝并列出字段名 |
| `executable` | 按声明 | **改写为 `bin/<target>/<binary>`** |

## 9. 自检

```bash
node <skill-root>/scripts/check-project.mjs <项目目录>
```

它覆盖：未知字段、id/version 格式、`engines.host_api`、权限语法与数量、`ui.entry` 是否在 `root` 内、资源是否存在、是否被 `include` 覆盖、manifest 与 `dbx-plugin.toml` 的后端一致性、已废弃字段。
