# 打包参考

## 1. `dbx-plugin.toml`（构建配置，不进入插件包）

```toml
schema_version = 1

# 只有原生后端项目才有这一段；纯前端项目必须完全省略
[backend]
language = "rust"        # rust | go | golang
directory = "backend"    # 相对项目根的相对路径
binary = "dbx-plugin-my-plugin"   # 纯文件名，不能含 / 或 \

[package]
include = ["assets", "ui"]        # 只有这里声明的目录才会被打包

[dev]
ui_build = ["npm", "run", "build"]
ui_watch = ["npm", "run", "build:watch"]
```

校验规则：

- `schema_version` 必须为 `1`，否则 `Unsupported dbx-plugin.toml schema version N`。
- `[backend].directory` 必须是安全相对路径；`[backend].binary` **必须是文件名**（不含路径分隔符）。
- `[package].include` 每一项必须是安全相对路径（不能绝对、不能含 `.`/`..`），且**不能包含 `.dbx-dev` 组件**，否则 `Package input cannot contain .dbx-dev development data`。
- `[dev]` 的子段是**字符串数组**（`ui_build="npm run build"` 会解析失败）。`[dev]` 使用 `deny_unknown_fields`，写错键会报错。
- `[backend]` 存在性与 `manifest.json` 的 `entrypoints.backend` **必须一致**，否则
  `dbx-plugin.toml and manifest.json must either both declare a backend or both omit it`。

## 2. 打包流程

```bash
dbx-plugin package .
```

1. 解析 `dbx-plugin.toml`，校验 `schema_version`、backend 与 include 路径。
2. 读取并校验 `manifest.json`：拒绝未知顶层字段、校验 `manifest_version`、`id`、`name`、`version`、`publisher`、`engines.host_api`；比对 backend 一致性。
3. 决定 target（`--target` → `DBX_PLUGIN_TARGET` → 原生项目当前主机 → `universal`），校验 target 字符集，原生项目还会校验 target 与构建主机一致。
4. 校验 `icon` 与 `ui.entry`：文件存在、路径安全、`entry` 在 `root` 内、且**被 `[package].include` 覆盖**。
5. 建临时 stage 目录 `dist/.stage-<id>-<target>`，原生项目先构建 Sidecar 到 `bin/<target>/`。
6. 生成**包内 manifest**（见 §4），与 include 的内容一起复制进 stage。
7. 用 `dbx-plugin-packager` 打成 ZIP 容器 `dist/<id>-<version>-<target>.dbxp`，写入 `checksums.json`。
8. 写 `dist/<id>-<version>-<target>.artifact.json`。
9. 清理临时 stage / build 目录（成功与失败都会清理）。

## 3. `.dbxp` 内部结构

```
<id>-<version>-<target>.dbxp        # ZIP 容器
├── manifest.json                   # 已被 CLI 重写过的那份
├── checksums.json                  # {"algorithm":"sha256","files":{路径: sha256}}
├── signature.json                  # 仅签名后存在（未签名候选包没有）
├── bin/<target>/<binary>           # 仅原生项目；保留可执行权限
├── assets/…                        # 由 [package].include 决定
└── ui/…
```

未签名候选包**故意不含 `signature.json`**，其 `.artifact.json` 也**不含 `signingKeyId`**。

## 4. 包内 manifest 的重写规则

CLI 在打包时会改写**包内那份** `manifest.json`（你的源码文件不变）：

1. 拒绝已废弃字段：`entrypoints.ui.kind`、`entrypoints.backend.binaries`、`entrypoints.backend.protocol`。
2. `entrypoints.backend.executable` 被强制设为 `bin/<target>/<binary>`（Windows 加 `.exe`）。
3. 若 `protocol_versions` 恰为 `[1]`，删除该字段。
4. 若 `transport` 恰为 `"stdio-jsonl"`，删除该字段。

含义：源码里 `backend.executable` 写什么都会被覆盖，**真正决定路径的是 target**；默认值不必显式写出来。

## 5. target 规则

| 项目类型 | 默认 target | 说明 |
| --- | --- | --- |
| 纯前端（`frontend` / `svelte`） | `universal` | 跨平台单包 |
| 原生（`rust` / `go`） | 当前主机 | `darwin-arm64`、`darwin-x64`、`linux-x64`、`linux-arm64`、`windows-x64`、`windows-arm64` |

- target 只允许 `[a-z0-9-]`，长度 ≤64。
- **原生项目不能交叉打包**：显式指定与构建主机不同的 target 会报错。正式发布用 CI 矩阵在各自平台构建。
- 商店目录实际使用的 target 词表：`darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`、`windows-arm64`、`windows-x64`。
- 只有「同一个包在所有支持的 DBX 平台都有效」时才用 `universal`。

## 6. 体积与数量限制

| 限制 | 值 | 触发时机 |
| --- | --- | --- |
| 输出包大小 | 512 MiB | packager，`Output package exceeds N bytes` |
| 解压后总大小 | 1 GiB | packager，`Package source exceeds N uncompressed bytes` |
| 单文件 | 256 MiB | packager，`Package file '<name>' exceeds N bytes` |
| 归档条目数 | 10000 | packager，`Package source contains more than N files` |
| 商店候选 `size` | 1 … 512 MiB | 商店 `validate.mjs` |

> 打包时还会做**读取期间一致性校验**：如果源文件在读取过程中被改动，会报
> `Package source changed while reading <path>`。所以不要在打包过程中同时改文件。

## 7. 被拒绝的输入

- **符号链接**：`Package input cannot contain symbolic link <path>`（packager 也会检查）。
- **`.dbx-dev`**（含嵌套）：`Package input cannot contain .dbx-dev development data`。
- **越界路径**：绝对路径、含 `.`/`..` 的路径 → `... must be a safe relative path`。
- **不存在的 include**：`Package include <path> does not exist`。
- **输出位置不安全**：输出包必须在源目录之外（`Output package must be outside the source directory`）；artifact metadata 也必须在源目录之外且不能等于包路径。
- **扩展名**：输出必须是 `.dbxp`。
- **源目录缺 manifest**：`<dir> is missing manifest.json`。
- **未覆盖的资源**：`manifest icon 'assets/plugin.svg' is not covered by [package].include`。

**不要把 `dist/` 或 `.dbx-dev/` 再作为 include 输入。**

## 8. `.artifact.json`

```json
{
  "target": "universal",
  "url": "com.example.my-plugin-0.1.0-universal.dbxp",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "size": 123456
}
```

- `sha256` / `size` 绑定**确切字节**。任何字节变化都必须递增插件版本并重新审核。
- `url` 默认是文件名；用 `--artifact-url` 写入发布后的 HTTPS 地址：

```bash
dbx-plugin package . --artifact-url https://github.com/me/my-plugin/releases/download/v0.1.0/com.example.my-plugin-0.1.0-universal.dbxp
```

- 签名后 packager 才会补上 `signingKeyId`。**候选包里不要有它。**
- 上游 `.artifact.json` 与商店侧的最终 `.artifact.json` **同名但不同物**：前者由你生成（用于聚合 `release-candidates.json`），后者由签名步骤生成并随包发布。

## 9. Release 工作流

`dbx-plugin create` 生成的 `.github/workflows/plugin-release.yml` 在发布 GitHub Release 时构建候选包：

```yaml
name: Release DBX plugin
on:
  release:
    types: [published]
permissions:
  contents: write
jobs:
  release:
    uses: t8y2/dbx/.github/workflows/plugin-release-reusable.yml@plugin-sdk-v1
    with:
      release-tag: ${{ github.event.release.tag_name }}
      package-command: dbx-plugin package .
      package-path: dist/*.dbxp
      metadata-path: dist/*.artifact.json
      plugin-cli-version: 0.1.6
      # 纯前端插件加这一行，只构建一个 universal 包：
      build-matrix: '{"include":[{"runner":"ubuntu-24.04","target":"universal"}]}'
```

- **同时 pin 住 reusable workflow 的 ref 与 `plugin-cli-version`**，保证本地与 CI 用同一套 SDK 契约。
- 原生项目的默认矩阵覆盖 `darwin-arm64`、`darwin-x64`、`windows-x64`、`linux-x64`、`linux-arm64`。
- 工作流会：安装 pin 的 CLI → 各 target 构建 → 拒绝含 `signature.json` 或含 `signingKeyId` 的候选 → 校验 target/sha256/size/包名与统一 Manifest 身份 → 上传候选包与合并的 `release-candidates.json`。
- **官方作者不需要配置任何签名 Secret 或 Key ID。**

## 10. 打包后自检

```bash
node <skill-root>/scripts/check-project.mjs .                       # 打包前：项目自洽
node <skill-root>/scripts/inspect-dbxp.mjs dist/*.dbxp              # 打包后：包内容 + checksums 校验
node <skill-root>/scripts/make-candidate.mjs .                      # 生成候选 JSON 并复核 sha256/size
```

`inspect-dbxp.mjs` 会逐条重算 `checksums.json` 里的 SHA-256，并检查 `bin/` 下的 target 是否与文件名一致、是否存在 `signature.json`。

## 11. 常见错误

| 报错 | 原因 |
| --- | --- |
| `Invalid dbx-plugin.toml: ...` | TOML 语法错，或 `[dev]` 里写了未支持的键 |
| `Unsupported dbx-plugin.toml schema version N` | `schema_version` 不是 1 |
| `dbx-plugin.toml and manifest.json must either both declare a backend or both omit it` | 两边不一致 |
| `manifest.json contains unknown top-level field(s): X` | 写了 Manifest v1 不接受的字段 |
| `manifest UI entry 'ui/index.html' is not covered by [package].include` | include 里没有 `ui` |
| `manifest icon 'assets/plugin.svg' does not exist at ...` | 图标文件缺失 |
| `Package include <path> does not exist` | include 声明了不存在的目录 |
| `Native plugin target 'X' does not match build host 'Y'` | 交叉打包；请在目标平台构建 |
| `Target directory is not empty; use --force`（create） | 与打包无关，但常一起遇到 |
| `Package source cannot contain symbolic link ...` | 删掉符号链接或改成真实文件 |
