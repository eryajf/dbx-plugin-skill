---
name: dbx-plugin
description: DBX 插件开发全流程。Use when 创建、开发、调试、打包、签名、发布或上架 DBX 插件；处理 manifest.json、dbx-plugin.toml、.dbxp 包、贡献点（connection-provider / workbench / filesystem-provider / context-menu / result-view）、Host API（window.dbxPlugin 桥接）、Rust/Go Sidecar 协议、dbx-plugin CLI（create / dev / package / keygen）、dbx-store 候选 PR 与 catalog 校验时使用。
---

# DBX 插件开发

本 skill 覆盖 DBX 插件的**创建 → 开发 → 调试 → 打包 → 发布 → 官方商店上架**全链路。
所有契约以 Manifest v1 + Host API 1.x + Sidecar Protocol v1 + `.dbxp` 包格式为准。

## 0. 先建立正确的心智模型（读之前必看）

### 0.1 四个契约各自管什么

| 契约 | 载体 | 作用 |
| --- | --- | --- |
| Manifest v1 | `manifest.json` | 插件身份、权限、入口、贡献点、国际化。运行时契约，**拒绝未声明字段** |
| 构建配置 | `dbx-plugin.toml` | 打包包含哪些目录、是否有原生后端、dev 构建命令。**不进入插件包** |
| Host API 1.x | `window.dbxPlugin` | 沙箱 UI 与 DBX 宿主通信 |
| Sidecar Protocol v1 | stdin/stdout JSON-RPC | 可选原生后端与 DBX 通信 |
| 包格式 | `.dbxp`（ZIP 容器） | DBX 实际安装的东西 |

SDK **不需要启动**：没有常驻 SDK Server。开发时只用三类工具——`dbx-plugin` CLI、Rust/Go SDK（仅原生后端链接用）、DBX 注入的 `window.dbxPlugin`。

### 0.2 三个仓库的分工（最常见的错误来源）

| 你要改的东西 | 提交到哪里 |
| --- | --- |
| 你的插件前端、Rust/Go 后端、测试、发布脚本 | **你自己的插件源码仓库** |
| 新插件上架、版本更新、商店图标/介绍 | `t8y2/dbx-store`，目标分支 `main` |
| DBX Host、Manifest/Marketplace Schema、SDK、CLI、Packager、官方示例、插件开发文档 | `t8y2/dbx` |
| 某个第三方插件自身的 Bug | 该插件自己的源码仓库（**不要**提到 `dbx-store`） |
| 数据库厂商 JDBC Driver JAR | 不提交到任何 Git 仓库，用户本机导入 |

> 上架 PR 提到 `t8y2/dbx-store`，**不是** `t8y2/dbx`。普通插件源码也不要复制进 `t8y2/dbx`。

### 0.3 包与签名模型

```
插件源码仓库                          DBX Store（t8y2/dbx-store）
  dbx-plugin package .                     人工审核
        │                                        │
        ├─ dist/<id>-<ver>-<target>.dbxp         │  受保护 Workflow 用仓库 Ed25519 密钥签名
        ├─ dist/<id>-<ver>-<target>.artifact.json│        │
        └─ release-candidates.json  ─────────────┘        ▼
             （未签名候选）                     最终签名 .dbxp + artifact metadata + signing receipt
                                                         │
                                                         ▼
                                             catalog/index.json（DBX 客户端读取）
```

- 开发者**永远不接触官方私钥**，也**不自行填写 `signingKeyId`**。
- 未签名包只能本地开发测试：插件中心 → 设置 → 第三方与开发者选项 → 允许安装未签名开发包。
- 签名保证「装到的字节 = 审核过的字节」，**不是** OS 沙箱，也不代表插件安全。

---

## 1. 我要做什么 → 读哪个 reference

| 任务 | 读 |
| --- | --- |
| 写/改 `manifest.json`、权限、入口、`localizations` | `references/manifest.md` |
| 加连接表单、工作台、文件系统、右键菜单、结果视图 | `references/contributions.md` |
| 写沙箱 UI、调 `window.dbxPlugin`、主题适配、CSP/网络 | `references/host-api.md` |
| 写 Rust/Go Sidecar、连接生命周期、二进制帧 | `references/sidecar-protocol.md` |
| 用 `dbx-plugin` 命令、装 CLI、模板选择 | `references/cli.md` |
| 起 dev host 调试、看日志、诊断接口 | `references/debugging.md` |
| 打包、`dbx-plugin.toml`、target、包体积限制 | `references/packaging.md` |
| 发布 Release、候选 PR、审核签名、上架/更新版本 | `references/publishing.md` |
| 报错信息 → 原因 → 修法 | `references/troubleshooting.md` |

---

## 2. 标准工作流

### 步骤 1：装 CLI 并创建项目

```bash
npm install --global @dbx-app/plugin-cli   # 或 npx @dbx-app/plugin-cli
dbx-plugin --help                          # 验证安装与版本

dbx-plugin create my-plugin \
  --template svelte \
  --id com.example.my-plugin \
  --name "My Plugin" \
  --publisher example \
  --description "A DBX plugin." \
  --version 0.1.0 \
  --yes
```

模板选择（不要为了「像完整插件」而强行加 Sidecar）：

| 模板 | 组成 | 产物 | 适用 |
| --- | --- | --- | --- |
| `frontend` | 沙箱前端 | 一个 `universal` 包 | 纯 UI / 调 Host API |
| `svelte` | Svelte 5 + Vite 前端 | 一个 `universal` 包 | 自定义工作台 |
| `rust` | 前端 + Rust Sidecar | 每平台一个包 | 终端、SSH、复杂协议、高性能 |
| `go` | 前端 + Go Sidecar | 每平台一个包 | Go 生态、网络服务 |

### 步骤 2：开发

- 前端入口由 `entrypoints.ui.entry` 指定，必须落在 `ui.root` 内（root 为 `ui` 时写 `ui/index.html`）。
- 所有 UI 必须构建为包内静态资源；**不要把 Vite dev server 或 CDN 地址写进发行包**。
- 需要原生能力（S3/SSH/系统凭据/长连接/高性能）才写 Sidecar。Sidecar 不是 OS 沙箱，以当前用户权限运行。

### 步骤 3：本地调试

```bash
dbx-plugin dev --path . --port 5190          # 不启动 DBX，浏览器开发宿主，需 Node.js 22+
curl -sS 'http://127.0.0.1:5190/api/diagnostics?after=0&limit=100&level=error'   # 脚本/Agent 读脱敏日志
```

细节（自动重载、`DBX_UI_BUILD_SUCCESS` 约定、数据目录、能力边界）见 `references/debugging.md`。

### 步骤 4：打包未签名候选

```bash
dbx-plugin package .
# 前端：dist/<id>-<ver>-universal.dbxp + .artifact.json
# 原生：dist/<id>-<ver>-<os>-<arch>.dbxp + .artifact.json（必须在对应平台构建）
```

打包前先跑随附预检脚本（见 §5），它能提前发现 manifest/toml/include/资源不一致。

### 步骤 5：发布 Release（在自己的插件仓库）

生成的 `.github/workflows/plugin-release.yml` 会在发布 GitHub Release 时产出各平台候选包、`.artifact.json` 和合并的 `release-candidates.json`。**不要把 `.dbxp` 提交进 Git**。

### 步骤 6：进入官方商店

- 已登记 `autoUpdate: true`：Store 的定时 Workflow 自动读取最新 Release 的 `release-candidates.json`，创建/更新 `candidates/<id>.json` 候选 PR（分支 `automation/plugin-release/<id>/<version>`）。作者不需要手工建 Issue/PR。
- 未登记：Fork `t8y2/dbx-store`，向 `main` 提**一个** PR，包含 `publishers/<publisher-id>.json`（仅首次）和 `candidates/<plugin-id>.json`。
- 之后由维护者审核 → 运行受保护签名 Workflow（PR 下评论 `/sign`）→ 回写 `plugins/<id>.json` + `catalog/index.json` → 合并。
- CI 在签名前**故意保持红色**（`open candidate(s) awaiting DBX Store signing`），这是设计如此。

完整字段、`.dbx-store.json`、校验规则与常见坑见 `references/publishing.md`。

### 步骤 7：发新版本

```bash
# 1. 改代码，递增 manifest.json 的 version（不要复用旧版本号）
# 2. 打新 Tag、发新 Release（旧 Release 资产不可覆盖）
# 3. 等同步 Workflow 建候选 PR → 审核 → 签名 → 合并
```

**已发布的字节不可覆盖**：任何字节变化都必须递增版本并重新审核。

---

## 3. 硬性约束（违反必然失败）

**Manifest**
- `manifest.json` 必须在包根目录；Manifest v1 **拒绝任何未声明字段**（顶层白名单只有 `$schema`、`manifest_version`、`id`、`name`、`icon`、`version`、`publisher`、`description`、`source`、`homepage`、`engines`、`permissions`、`entrypoints`、`contributions`、`localizations`）。
- `id` 只能小写字母/数字/`.`/`_`/`-`，首字符为字母或数字；发布后不可更改。`version` 必须是合法 SemVer。
- 包内路径相对包根，**不能**以 `/` 开头、不能含 `..`、反斜杠或重复斜杠。
- `entrypoints.ui.entry` 必须位于 `ui.root` 内。
- 已废弃字段会被 CLI 拒绝：`entrypoints.ui.kind`、`entrypoints.backend.binaries`、`entrypoints.backend.protocol`。

**权限**
- 只声明真正用到的权限，取最小集合：`host.workbench`、`host.events`、`host.filesystem`、`host.binary`、`host.network:https://host[:port]`（HTTPS、无路径/通配符/Token，最多 8 个）。
- `host.network` 只影响浏览器 CSP 的 `connect-src`，**不是** Sidecar 的网络防火墙，也仍受目标服务 CORS 约束。

**安全**
- 密码、Token、私钥**绝不**放进 `config`、Workbench context、事件或日志；需要持久化的敏感值用 `binding: "secret"`。
- `.dbx-dev/` 可能含明文凭据，必须加入 `.gitignore`，不得提交、不得打包（打包会直接报错）。
- 不要导入 DBX 的 Vue/Tauri 模块；不要假设页面能直接访问 Node.js、文件系统或网络。

**打包/发布**
- `.dbxp` 是安装包不是源码；不要把 `dist/` 当输入目录再次打包。
- 打包会拒绝：符号链接、越界路径、`..`、`.dbx-dev`、超限文件、不安全输出位置。
- 候选包**必须未签名**且 `.artifact.json` 里**不含 `signingKeyId`**；候选 URL 必须 HTTPS，且不能指向 `t8y2/dbx-store` 的 Release。
- 候选的 `id`/`version`/`publisher` 必须与包内 `manifest.json` 完全一致（签名时逐一比对）。
- `plugins/*.json` 和 `catalog/index.json` **永远不要手工编辑**（由签名 Workflow 生成）。

---

## 4. 命令速查

```bash
# 安装
npm install --global @dbx-app/plugin-cli
npx @dbx-app/plugin-cli create my-plugin

# 创建（--template frontend|svelte|rust|go；--backend 为别名；--language rust|go 兼容别名）
dbx-plugin create my-plugin --template rust --sdk-root /path/to/dbx

# 调试（Node.js 22+）
dbx-plugin dev [--path DIR] [--port 5190] [--data-dir DIR]

# 打包（始终产出未签名候选）
dbx-plugin package . [--target universal] [--output-dir dist] [--artifact-url https://...]

# 仅私有/自定义仓库运营方需要
dbx-plugin keygen company.plugins.release   # 生成 0600 权限的私钥 env 文件

# 其他
dbx-plugin version
NO_COLOR=1 dbx-plugin --help
```

相关环境变量：`DBX_PLUGIN_TARGET`（打包 target）、`DBX_PLUGIN_SDK_ROOT`（改用本地/自带 SDK 源码）、`DBX_PLUGIN_DEV_RUNTIME`、`DBX_PLUGIN_NODE`（dev 运行时）、`DBX_PLUGIN_CLI_BINARY`（npm launcher 覆盖二进制）、`NO_COLOR` / `CLICOLOR` / `CLICOLOR_FORCE`。

---

## 5. 随附脚本（零依赖，Node.js 18+）

脚本位于本 skill 的 `scripts/` 目录（下文记为 `<skill-root>/scripts`）。

```bash
# 1) 打包前预检：manifest / dbx-plugin.toml / include 覆盖 / 资源存在 / 前后端一致 / 权限语法
node <skill-root>/scripts/check-project.mjs [项目目录] [--json]

# 2) 解包检查 .dbxp：条目清单、manifest、checksums 校验、签名状态、bin 目标一致性
node <skill-root>/scripts/inspect-dbxp.mjs dist/my-plugin-0.1.0-universal.dbxp [--json] [--extract DIR]

# 3) 从 dist/*.artifact.json 生成 candidates/<id>.json 与 release-candidates.json
node <skill-root>/scripts/make-candidate.mjs [项目目录] [--release-notes "..."] [--out dist]
#    会自动校验每个 .artifact.json 的 sha256/size 与 .dbxp 实际字节一致

# 4) 读取 dev host 脱敏日志（轮询/api/diagnostics，自动沿用 nextAfter+instanceId）
node <skill-root>/scripts/dev-logs.mjs --port 5190 [--level error] [--follow] [--json]
```

---

## 6. 排错入口

先跑预检，再对症查表：

1. `node <skill-root>/scripts/check-project.mjs` —— 覆盖绝大多数 manifest/toml/include 类错误。
2. 打包/签名/上架报错 → `references/troubleshooting.md` 的错误信息对照表。
3. dev host 起不来或 UI 不刷新 → `references/debugging.md` 的「能力边界」与「自动重载」两节。

高频真相（避免误判）：

- `Sidecar identity or protocol does not match manifest`：初始化响应里的 `plugin.id`/`version` 与 `manifest.json` 不一致，或协议版本不在双方支持范围内。
- 改完 UI 页面不刷新：编译型前端需要 `[dev].ui_watch`，且构建成功必须打印**独立一行** `DBX_UI_BUILD_SUCCESS`。
- `manifest.json contains unknown top-level field(s): ...`：写进了 Manifest v1 不接受的字段（常见于手写 `signingKeyId`、`verified`、自定义键）。
- `... is not covered by [package].include`：`icon` / `ui.entry` 所指文件不在 `[package].include` 声明的目录内。
- 原生插件 `target 'X' does not match build host 'Y'`：原生包必须在目标平台构建，用 CI 矩阵而不是本机交叉打包。
- 商店校验 `candidate URLs must not reference DBX Store releases`：候选只能指向你自己仓库的**未签名**包。

---

## 7. 事实来源

- 官方文档：<https://dbxio.com/cn/docs/plugin-development>
- 上游权威源码与 Schema（`t8y2/dbx`，`main` 分支）：
  - `plugins/manifest.schema.json`、`plugins/marketplace.schema.json`
  - `plugins/README.md`（完整贡献点与协议）、`plugins/RELEASING.md`、`plugins/SIGNING.md`
  - `plugins/sdk/cli`、`plugins/sdk/packager`、`plugins/sdk/dev-host`、`plugins/sdk/{rust,go}`
- 官方商店仓库：<https://github.com/t8y2/dbx-store>（`CONTRIBUTING.md`、`schemas/plugin-candidate.schema.json`、`scripts/validate.mjs`）

注意：模板中 `manifest.json` 的 `$schema` 默认指向 `.../t8y2/dbx/plugin-sdk-v1/plugins/manifest.schema.json`，该 ref 目前**不存在（404）**。若你依赖编辑器校验，请改为 `main` 或具体版本 tag。以 CLI 与运行时校验为准，Schema 只是编辑期辅助，不是安全边界。

---

## 8. 分析/审查插件时的输出要求

被要求 review 一个 DBX 插件或候选包时，按以下顺序给结论，并标注证据（文件:行 或命令输出）：

1. **身份一致性**：`id` / `version` / `publisher` 在 `manifest.json`、`.dbx-store.json`、`candidates/*.json`、`artifact.json` 中是否一致。
2. **权限最小化**：声明的每个权限是否都有实际调用点；`host.network` origin 是否精确。
3. **Secret 处理**：有无把凭据写入 `config`、context、事件或日志。
4. **包内容**：`inspect-dbxp.mjs` 输出中是否有 `.dbx-dev`、多余文件、错误 target 的 `bin/`。
5. **可复现性**：`sha256`/`size` 是否与实际字节一致；是否覆盖了已发布版本。
6. **上架合规**：候选未签名、URL 为 HTTPS 且非 dbx-store Release、未手工改 `plugins/` 或 `catalog/`。
