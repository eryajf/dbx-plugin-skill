# `dbx-plugin` CLI 参考

CLI 有四个命令：`create`、`dev`、`package`、`keygen`。npm 包会把当前平台的**预编译二进制**、匹配版本的 Rust/Go SDK 源码和 dev host 运行时一起装好 —— **不需要 Rust，也不需要克隆 DBX 源码**。

## 1. 安装

```bash
# 全局安装（推荐）
npm install --global @dbx-app/plugin-cli
dbx-plugin --help

# 不安装，直接用
npx @dbx-app/plugin-cli create my-plugin

# 验证版本
dbx-plugin version
```

- npm 包要求 **Node.js >= 18.18**；`dev` 子命令要求 **Node.js >= 22**。
- 平台二进制通过 `optionalDependencies` 分发（`darwin-arm64`、`darwin-x64`、`linux-arm64-gnu`、`linux-x64-gnu`、`win32-arm64`、`win32-x64`）。**不要用 `--no-optional` 安装**，否则 launcher 会报缺少平台包。
- launcher（`bin/dbx-plugin.js`）行为：
  - 按 `process.platform` + `process.arch` 选择平台二进制；
  - `DBX_PLUGIN_CLI_BINARY` 可覆盖二进制路径（用于本地源码构建的二进制）；
  - `dev` 子命令会设置 `DBX_PLUGIN_NODE` 与 `DBX_PLUGIN_DEV_RUNTIME`，并在 Node < 22 时直接报错；
  - **总是**把 `DBX_PLUGIN_SDK_ROOT` 指向包内自带的 `sdk-root`（除非你自己已设置）—— 这就是「不用克隆 DBX 也能构建原生后端」的原因；
  - `dbx-plugin --verify-platform` 只校验平台包存在，不执行命令。

**仅当开发 CLI 本身**时才从源码安装：

```bash
cd /path/to/dbx
CARGO_TARGET_DIR=/tmp/dbx-plugin-cli-target cargo install --locked --path plugins/sdk/cli --force
```

## 2. `dbx-plugin create`

```bash
dbx-plugin create [directory] [options]
```

| 选项 | 说明 |
| --- | --- |
| `-t, --template TYPE` | `frontend`（默认）、`svelte`、`rust`、`go`；别名：`frontend-only`/`ui`/`none` → `frontend`，`golang` → `go` |
| `--backend TYPE` | `--template` 的别名，同样接受 `none`/`svelte`/`rust`/`go` |
| `-l, --language LANG` | 兼容别名，只接受 `rust` / `go` / `golang` |
| `--id ID` | 反域名插件 ID（如 `com.example.my-plugin`） |
| `--name NAME` | 显示名 |
| `--publisher NAME` | 发布者标识 |
| `--description TEXT` | 插件说明 |
| `--version VERSION` | 严格 SemVer，默认 `0.1.0` |
| `--sdk-root PATH` | 使用本地 DBX 工作区的 SDK 源码（**仅 Rust/Go 模板**） |
| `--force` | 覆盖已生成的文件 |
| `-y, --yes` | 跳过交互向导，使用默认值 |
| `-h, --help` | 帮助 |

- 交互模式条件：**未传 `--yes` 且 stdin/stdout 都是 TTY**。会彩色向导、逐项校验、显示汇总并在写文件前确认。
- 未 `--yes` 且非 TTY 时按非交互处理（缺值报错）。
- `--signing-key-id` 已移除：官方包由 DBX Store 审核后签名，CLI 会直接报错。

**完整参数示例（CI/脚本用）**：

```bash
dbx-plugin create my-plugin \
  --template svelte \
  --id com.example.my-plugin \
  --name "My Plugin" \
  --publisher example \
  --description "A DBX plugin." \
  --version 0.1.0 \
  --yes
```

### 目录名决定的东西

`directory` 的 basename 会被规范化为 slug（非字母数字 → `-`，折叠连续 `-`，转小写），然后：

- 原生后端二进制名 = `dbx-plugin-<slug>`；
- 生成的方法名前缀 = slug（`_` → `-`）；
- `database_type` / `CONNECTION_TYPE` = slug；
- Go module = `github.com/<publisher>/<slug>`。

所以目录名要有字母或数字，且建议只用小写字母、数字和 `-`。

### 生成的文件

| 模板 | 文件 |
| --- | --- |
| 全部 | `.gitignore`、`assets/plugin.svg` |
| `frontend` | `dbx-plugin.toml`、`manifest.json`、`README.md`、`ui/index.html`、`.github/workflows/plugin-release.yml` |
| `svelte` | 上述 + `package.json`、`svelte.config.js`、`vite.config.js`、`index.html`、`src/main.js`、`src/App.svelte` |
| `rust` | `frontend` 的基础文件换成 `common/*`，另加 `backend/Cargo.toml`、`backend/src/main.rs` |
| `go` | 同上，另加 `backend/go.mod`、`backend/main.go` |

生成的 `.gitignore` 已包含 `/dist/`、`/.dbx-dev/`、`.dbx-repository-signing-key.env`。

### create 的校验规则

- 目标目录存在且非空 → 必须 `--force`，否则报 `... is not empty; use --force to overwrite generated files`。
- `--id` / `--publisher`：只允许小写字母、数字和 `.` `_` `-`，首字符不能是标点。
- `--version`：必须能被 semver 解析（`1.0.0`、`1.0.0-beta.1`）。
- `--name` / `--description`：非空且不能含控制字符。
- `--sdk-root` 用在 `frontend` / `svelte` 模板会报 `SDK root is only supported by Rust or Go plugin templates`。
- 模板渲染后若有未替换的 `{{MARKER}}` 会报错（模板 bug 防护）。

## 3. `dbx-plugin dev`

```bash
dbx-plugin dev [--path DIR] [--port PORT] [--data-dir DIR]
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--path DIR` | `.` | 插件项目目录 |
| `--port PORT` | `5190` | 回环端口；`0` 或被占用时自动选空闲端口 |
| `--data-dir DIR` | `<项目>/.dbx-dev` | 开发数据（**含明文凭据**） |

- **要求 Node.js 22+**；只监听 `127.0.0.1`。
- 不会启动 DBX 桌面端，也**不会自动安装插件依赖**。
- 前端构建由 `dbx-plugin.toml` 的 `[dev]` 决定（见 `debugging.md`）。
- 详细能力边界、诊断接口见 `debugging.md`。

## 4. `dbx-plugin package`

```bash
dbx-plugin package [project] [--target TARGET] [--output-dir DIR] [--artifact-url URL]
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `project`（位置参数） | `.` | 项目目录 |
| `--target TARGET` | 见下 | artifact target，也读环境变量 `DBX_PLUGIN_TARGET` |
| `--output-dir DIR` | `dist` | 相对路径按项目目录解析；绝对路径原样使用 |
| `--artifact-url URL` | 包文件名 | 写进 artifact metadata 的 URL |

- `--key-id` 已移除：`package` **始终产出未签名候选包**；签名是仓库运营方在审核后做的独立步骤。

**target 规则**：

- 纯前端项目默认 `universal`。
- 原生项目默认当前主机 target（`darwin-arm64`、`darwin-x64`、`linux-x64`、`linux-arm64`、`windows-x64`、`windows-arm64` 形态）。
- 原生项目**显式指定与构建主机不同的 target 会报错**：
  `Native plugin target 'X' does not match build host 'Y'; run this package command on the target platform`。
- target 只允许 `[a-z0-9-]`，长度 ≤64。

**产物**：

```
dist/<plugin-id>-<version>-<target>.dbxp
dist/<plugin-id>-<version>-<target>.artifact.json
```

`artifact.json` 内容（未签名时**不含** `signingKeyId`）：

```json
{
  "target": "universal",
  "url": "com.example.my-plugin-0.1.0-universal.dbxp",
  "sha256": "<64 位十六进制>",
  "size": 123456
}
```

**打包行为要点**（详见 `packaging.md`）：只打包 `[package].include` 声明的目录；重写包内 `manifest.json` 的 backend executable；拒绝符号链接、`.dbx-dev`、越界路径、过大文件与不安全输出位置。

## 5. `dbx-plugin keygen`（仅私有/自定义仓库运营方）

```bash
dbx-plugin keygen [KEY_ID] [--output FILE] [--force]
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `KEY_ID`（位置参数或 `--key-id`） | 交互输入 | 公钥稳定标识，如 `company.plugins.release` |
| `-o, --output FILE` | `.dbx-repository-signing-key.env` | 私钥输出文件 |
| `--force` | 关 | 覆盖已存在文件 |

- 生成 **32 字节 Ed25519 seed** 的 env 文件，Unix 权限 `0600`，已存在则拒绝覆盖（除非 `--force`）。
- 文件内容形如：

```bash
# Keep this file secret. Do not commit it.
export DBX_PLUGIN_SIGNING_KEY=<base64 私钥>
export DBX_PLUGIN_SIGNING_KEY_ID=<key id>
export DBX_PLUGIN_SIGNING_PUBLIC_KEY=<base64 公钥>
```

- 终端只打印 Key ID 与公钥，**不打印私钥**。
- **官方商店插件作者不要运行 `keygen`，也不要填写 `signingKeyId`。**
- Key ID 命名建议「仓库 + 用途 + 轮换版本」，最长 128 字符，可用字母数字 `.` `-` `_` `:`。**同一 Key ID 必须永远对应同一把公钥**；轮换要换新 ID。

## 6. 终端颜色

颜色在交互终端自动启用。关闭与强制：

```bash
NO_COLOR=1 dbx-plugin --help        # 纯文本（优先级最高）
CLICOLOR=0 dbx-plugin --help        # 同上
CLICOLOR_FORCE=1 dbx-plugin --help  # 管道输出时也保留颜色
```

## 7. 环境变量汇总

| 变量 | 作用 |
| --- | --- |
| `DBX_PLUGIN_TARGET` | `package` 的默认 target |
| `DBX_PLUGIN_SDK_ROOT` | 用本地/自带的 Rust+Go SDK 源码构建后端（npm launcher 默认指向包内 `sdk-root`） |
| `DBX_PLUGIN_DEV_RUNTIME` | `dev` 运行时入口（覆盖默认 `dist/runtime.mjs`） |
| `DBX_PLUGIN_NODE` | `dev` 使用的 node 可执行文件 |
| `DBX_PLUGIN_CLI_BINARY` | launcher 使用的 CLI 二进制路径 |
| `NO_COLOR` / `CLICOLOR` / `CLICOLOR_FORCE` | 颜色控制 |

## 8. 常见错误

| 报错 | 原因与修法 |
| --- | --- |
| `dbx-plugin: command not found` | npm 全局 bin 不在 `PATH`；或直接用 `npx @dbx-app/plugin-cli` |
| `The optional package @dbx-app/plugin-cli-<platform> was not installed` | 用了 `--no-optional` 安装，重新安装 |
| `DBX Plugin CLI does not provide a binary for <platform>` | 不支持的平台/架构（如 32 位或 musl） |
| `dev requires Node.js 22+` | 升级 Node，或设置 `DBX_PLUGIN_NODE` 指向 22+ |
| `... is not empty; use --force to overwrite generated files` | 目标目录非空，加 `--force` 或换目录 |
| `--signing-key-id is no longer used when creating plugins` | 删掉该参数，官方包由 DBX Store 签名 |
| `--key-id is no longer supported by dbx-plugin package` | 删掉该参数，`package` 只产出未签名候选 |
| `Native plugin target 'X' does not match build host 'Y'` | 在目标平台构建，或用 CI 矩阵 |
| `Failed to start Rust backend build: No such file or directory` | 未安装 `cargo`（Rust 模板才会用到） |
| `Go backend is missing <dir>/go.mod` | 目录结构与 `[backend].directory` 不一致 |
