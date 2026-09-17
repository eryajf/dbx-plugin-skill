# 排错对照表

按**报错原文**定位。每条给出原因与修法；需要背景时点回对应 reference。

排错顺序建议：

```bash
node <skill-root>/scripts/check-project.mjs .                    # 1) 项目自洽性
dbx-plugin package .                                             # 2) 复现打包错误
node <skill-root>/scripts/inspect-dbxp.mjs dist/*.dbxp           # 3) 包内容
node <skill-root>/scripts/dev-logs.mjs --port 5190 --level error # 4) dev 运行期
```

---

## 1. 安装与 CLI

| 报错 | 原因 | 修法 |
| --- | --- | --- |
| `dbx-plugin: command not found` | npm 全局 bin 不在 `PATH` | 加 `PATH`，或改用 `npx @dbx-app/plugin-cli ...` |
| `The optional package @dbx-app/plugin-cli-<platform> was not installed. Reinstall @dbx-app/plugin-cli without --no-optional.` | 安装时跳过了可选依赖 | 重新 `npm i -g @dbx-app/plugin-cli`（不要 `--no-optional`） |
| `DBX Plugin CLI does not provide a binary for <platform>` | 平台/架构不受支持（32 位、musl 等） | 用受支持平台，或从源码构建并设 `DBX_PLUGIN_CLI_BINARY` |
| `DBX_PLUGIN_CLI_BINARY does not exist: <path>` | 覆盖路径写错 | 检查路径 |
| `Unknown command '<cmd>'` | 命令拼错 | 只有 `create`/`dev`/`package`/`keygen`/`version`/`help` |
| `Unknown create option '<x>'` / `Unknown package option '<x>'` / `Unknown dev argument '<x>'` | 选项不属于该命令 | 看 `dbx-plugin <cmd> --help` |
| `Option requires a value` | 选项后没给值 | 补值 |
| `--signing-key-id is no longer used when creating plugins; official packages are signed by DBX Store after review` | 用了已移除的选项 | 删掉该参数（见 `publishing.md`） |
| `--key-id is no longer supported by dbx-plugin package; build an unsigned candidate, then let the repository operator sign it after review` | 同上 | 删掉该参数 |

## 2. `create`

| 报错 | 原因 | 修法 |
| --- | --- | --- |
| `<dir> is not empty; use --force to overwrite generated files` | 目标目录非空 | 换目录，或确认后 `--force` |
| `<dir> exists and is not a directory` | 同名文件占位 | 改名/删除 |
| `Project directory name must contain letters or digits` | 目录名全是符号 | 用含字母数字的目录名 |
| `plugin id must use lowercase letters, digits, dots, underscores, or hyphens`（或 `publisher`） | id/publisher 含大写或非法字符 | 改成小写标识符（`com.example.my-plugin`） |
| `Version must be valid SemVer such as 1.0.0 or 1.0.0-beta.1` | 版本号非法 | 用严格 SemVer |
| `Plugin template must be 'frontend', 'svelte', 'rust', or 'go'` | 模板名错 | 见 `cli.md` §2 |
| `Backend language must be 'rust' or 'go'` | `--language` 值错 | 用 `rust`/`go`/`golang` |
| `SDK root is only supported by Rust or Go plugin templates` | 对纯前端模板用了 `--sdk-root` | 去掉该参数，或换模板 |
| `Rust plugin SDK was not found at <path>` | `--sdk-root` 指向的不是 DBX 工作区 | 指向仓库根（内含 `plugins/sdk/...`） |
| `Generated template <file> contains unresolved marker {{X}}` | 模板占位符未替换（CLI bug） | 升级 CLI 并反馈 |
| `Cannot set both --template and --backend with different values` | `--template`/`--backend`/`--language` 冲突 | 只用一个 |

## 3. 调试（`dbx-plugin dev`）

| 报错 / 现象 | 原因 | 修法 |
| --- | --- | --- |
| `dev requires Node.js 22+` | Node 版本低 | 升级 Node 或用 `DBX_PLUGIN_NODE` 指向 22+ |
| `Cannot read dbx-plugin.toml: ...` / `Invalid dbx-plugin.toml: ...` | 文件缺失或 TOML 语法错 | 校验项目；`[dev]` 只接受 `ui_build`/`ui_watch`，且必须是字符串数组 |
| `Unsupported project configuration version` | `schema_version` 不是 1 | 改为 1 |
| `Cannot read manifest.json: ...` / `Invalid manifest.json: ...` | 缺失或 JSON 语法错 | 修 `manifest.json` |
| `dev requires a UI entrypoint` | Manifest 缺 `entrypoints.ui.entry` | 补上（见 `manifest.md` §3） |
| `UI entry must be inside its declared root` | `entry` 没落在 `root` 内 | `root="ui"` → `entry="ui/index.html"` |
| `Expected a project-relative path: <p>` | `--path`/entry/root 是绝对路径或含 `..` | 用项目内相对路径 |
| `dev build commands must start with an executable` | `[dev].ui_build` 首项是空字符串 | 修正数组 |
| `Project declares a backend but manifest does not`（或反向） | `[backend]` 与 `entrypoints.backend` 不一致 | 两边同时加或同时删 |
| `Backend binary must be a filename` | `[backend].binary` 含 `/`、`\` 或为 `.`/`..` | 只写文件名 |
| `dev supports Rust and Go backends` | `[backend].language` 是其它值 | 用 `rust`/`go` |
| `Go backend is missing go.mod` | 目录结构不符 | 修正 `[backend].directory` |
| `Rust SDK root is invalid` / `Go SDK root is invalid` | `DBX_PLUGIN_SDK_ROOT` 指向不对 | 指向含 `plugins/sdk/...` 的 DBX 根 |
| `Development runtime is missing...` | 用了源码构建的 CLI 但没建 dev runtime | 装 npm 版 CLI，或设置 `DBX_PLUGIN_DEV_RUNTIME` |
| 页面白屏 / 资源 404 | UI 未构建进 `ui.root`，或路径越界 | 看调试面板 HTTP 状态与 CSP；确认构建产物落在 `ui` 下 |
| **改完 UI 不自动刷新** | 没配 `[dev].ui_watch`，或构建脚本没打印 `DBX_UI_BUILD_SUCCESS` | 见 `debugging.md` §2（必须是**独立一行**且在成功回调里） |
| 改完后端没重启 | 改的不是 `[backend].directory` 内的源码；或构建失败导致后端停止 | 看日志；构建失败**不会**回退旧二进制 |
| CSP 报 `connect-src` 拒绝 | 没声明 `host.network:https://...` | 在 Manifest 声明精确 origin（最多 8 个） |
| 原生 `alert`/`confirm` 无效 | 沙箱不允许 | 用插件自己的对话框组件 |

## 4. 打包（`dbx-plugin package`）

| 报错 | 原因 | 修法 |
| --- | --- | --- |
| `Failed to resolve <path>: ...` / `<path> is not a directory` | 项目路径错 | 传正确的项目目录 |
| `Failed to read dbx-plugin.toml: ...` | 文件缺失 | 补 `dbx-plugin.toml` |
| `Invalid dbx-plugin.toml: ...` | TOML 语法错/键名错 | 见 `packaging.md` §1 |
| `Unsupported dbx-plugin.toml schema version N` | `schema_version != 1` | 改为 1 |
| `backend directory must be a safe relative path` / `package include must be a safe relative path` | 绝对路径或含 `.`/`..` | 改成项目内相对路径 |
| `Package input cannot contain .dbx-dev development data` | include 里含 `.dbx-dev`，或目录内有它 | 从 include 移除并把 `.dbx-dev/` 加入 `.gitignore` |
| `Failed to read manifest.json: ...` | 文件缺失 | 补上，且必须在包根 |
| `Invalid manifest.json: ...` | JSON 语法错 | 修 |
| `manifest.json contains unknown top-level field(s): X` | 写了 Manifest v1 不接受的字（如 `signingKeyId`、`verified`、`license`） | 删掉，见 `manifest.md` §1 |
| `Unsupported manifest.json version N; dbx-plugin packages require version 1` | `manifest_version != 1` | 改为 1 |
| `manifest plugin id must use lowercase letters, ...` | id 含大写/非法字符 | 改小写标识符 |
| `Version must be valid SemVer ...` | 版本号非法 | 用严格 SemVer |
| `dbx-plugin.toml and manifest.json must either both declare a backend or both omit it` | 两侧 backend 声明不一致 | 对齐 |
| `Artifact target contains unsupported characters` | target 含大写/下划线/空格 | 只用 `[a-z0-9-]` |
| `Native plugin target 'X' does not match build host 'Y'; run this package command on the target platform` | 交叉打包 | 在目标平台构建，或用 CI 矩阵 |
| `manifest UI entry 'ui/index.html' must be inside root 'ui'` | entry 未落在 root 内 | 修正 |
| `manifest UI entry '...' does not exist at ...` | 文件真的不存在 | 构建 UI 或修正路径 |
| `manifest icon '...' is not covered by [package].include` | include 没覆盖该路径 | 把所在目录加进 `include` |
| `manifest icon '...' does not exist at ...` | 图标缺失 | 补文件或改路径 |
| `entrypoints.ui.kind is obsolete; DBX plugin UI is always sandboxed` | 用了废弃字段 | 删除 |
| `entrypoints.backend.binaries is obsolete; package one target and declare executable` | 用了废弃字段 | 删除 |
| `entrypoints.backend.protocol is obsolete; DBX manifest v1 uses the DBX JSON-RPC protocol` | 用了废弃字段 | 删除 |
| `Package include <path> does not exist` | include 指向不存在的目录 | 修正 |
| `Package input cannot contain symbolic link <path>` | 目录里有符号链接 | 删除或替换为真实文件/目录 |
| `Package source cannot contain symbolic link <path>` | 同上（packager 层） | 同上 |
| `Rust backend build failed with ...` / `Go backend build failed with ...` | 后端编译失败 | 先单独修编译错误 |
| `Go backend is missing <dir>/go.mod` | 目录不符 | 修正 `[backend].directory` |
| `Failed to copy Rust backend ...` | 产物名与 `[backend].binary` 不符 | 让 Cargo 包名 == `binary` |
| `Artifact metadata path must differ from the package output` | 输出参数异常 | 检查 `--output-dir` |
| `Output package must be outside the source directory` | 输出落在源码目录内 | 用外部 `--output-dir` |
| `Package source changed while reading <path>` | 打包过程中文件被改 | 停掉并发的构建/编辑器保存 |
| `Package file '<name>' exceeds N bytes` / `Output package exceeds N bytes` | 超限 | 见 `packaging.md` §6 |
| `[dev]` 相关解析失败但看着没问题 | `[dev]` 里写了未支持的键 | 只保留 `ui_build`/`ui_watch` |

## 5. 包内容与签名

| 报错 | 原因 | 修法 |
| --- | --- | --- |
| `... is missing manifest.json` | 包根没有 manifest（stage 出错） | 用 `inspect-dbxp.mjs` 看包内条目 |
| `checksums.json` 校验失败（自检脚本报出） | 包被篡改或打包中断 | 重新打包；不要手工改包内容 |
| `Official signing accepts only unsigned candidates` | 提交了已签名包 | 只能提交**未签名**候选（自己不要签名） |
| `Candidate SHA-256 mismatch: expected <e>, got <a>` | 写了哈希之后又改了/重新打包 | 重新生成 `release-candidates.json` |
| `Candidate size mismatch: expected <e>, got <a>` | 同上 | 同上 |
| `Expected plugin <id>, got <x>` / `Expected publisher <p>...` / `Expected version <v>...` | 候选与包内 manifest 身份不一致 | 对齐 `id`/`publisher`/`version` |
| `R2 object already exists and cannot be overwritten: <key>` | 该版本已发布 | 递增版本号，重新走审核 |

## 6. 上架（dbx-store）

完整表见 `publishing.md` §15。最高频的几条：

| 报错 | 原因 | 修法 |
| --- | --- | --- |
| `Invalid candidate artifact '<v>'` | `release-candidates.json` 里 `artifacts[].url` 不是纯 `.dbxp` 文件名 | 改成纯文件名（自动同步脚本会自己拼 GitHub URL） |
| `No published candidate release found for <repo>` | 最新 Release 里没有名为 `release-candidates.json` 的资产，或 Release 是 draft/prerelease | 确认资产名精确、Release 已发布 |
| `publisher '<p>' is not registered` | publisher 记录不在 base 分支（PR 里新增的会被签名 overlay 删掉） | **先把 publisher 记录合并进 main**，再跑 `/sign` |
| `candidate URLs must not reference DBX Store releases; submit the unsigned candidate artifact` | 指向了官方已签名产物 | 指向你自己仓库的未签名包 |
| `version '<v>' is already listed for plugin '<id>'` | 复用版本号 | 升版本 |
| `'<f>' must be a non-empty string when provided` | `.dbx-store.json` 里有空字符串字段 | 删掉该字段或填值 |
| `Unsupported store metadata field '<k>'` | `.dbx-store.json` 写了白名单外的键 | 只用那 10 个字段 |
| `Repository file exceeds 1 MiB: <path>` | 工作树里有大文件（**含未跟踪/被 ignore 的文件**） | 清理，或不要在含 `node_modules` 的目录跑校验 |
| `Binary plugin package must not be committed: <path>` | 仓库里有 `.dbxp` | 删除并加入 `.gitignore` |
| `open candidate(s) awaiting DBX Store signing` | **正常状态**：等待维护者签名 | 不用处理，等审核 |

## 7. 运行期（真实 DBX）

| 现象 / 报错 | 原因 | 修法 |
| --- | --- | --- |
| `Sidecar identity or protocol does not match manifest` | 初始化响应的 `plugin.id`/`version` 与 manifest 不一致，或协议版本不兼容 | 让 SDK metadata 与 manifest 对齐；见 `sidecar-protocol.md` |
| Sidecar 启动即退出 | 日志写到了 stdout（污染协议流） | 所有日志改 stderr |
| RPC 一直超时 | 没有用请求的 `id` 回填响应；或方法名含空白/超长被拒 | 回填 `id`；方法名非空、≤256、无空白 |
| `Binary messages require framed transport` | 未切 framed 或 manifest 未声明 | 改 `transport` + 声明 `host.binary` |
| `plugin JSON line is too large` | 单条消息 > 8 MiB | 分块 |
| 连接表单保存了但后端没收到值 | 字段没声明 `binding`（非 password 类型不会持久化） | 补 `binding` |
| 打开连接后文件管理器/右键菜单没反应 | 声明了 Contribution 但没实现对应后端方法 | 实现 `filesystem/*` 或 `contextMenu/<id>` |
| 文件列表重复/死循环 | 最后一页没省略 `nextCursor`，或复用了旧 cursor | 修正分页语义 |
| 大文件上传失败 | 用了 4 MiB 上限的内联 `filesystem/write` | 改用 framed 分块传输 |
| 插件出现在「已安装」但功能不可用 | 权限未声明或未重新连接 | 检查 Manifest 权限与实际调用是否一致 |
| 正式签名包无法覆盖同版本重装 | 设计如此 | 本地开发用未签名包；正式包必须升版本 |
| 卸载被拒绝 | 仍有已保存连接引用该插件 | 先删除相关连接 |

## 8. 快速定位手法

```bash
# manifest / toml / include / 资源一致性
node <skill-root>/scripts/check-project.mjs . --json

# 包内到底有什么（条目、manifest、checksums、签名、bin target）
node <skill-root>/scripts/inspect-dbxp.mjs dist/*.dbxp --json
node <skill-root>/scripts/inspect-dbxp.mjs dist/*.dbxp --extract /tmp/dbxp

# 候选 JSON 与哈希复核
node <skill-root>/scripts/make-candidate.mjs .

# dev 运行日志
node <skill-root>/scripts/dev-logs.mjs --port 5190 --level error --follow
```

**万能第一步**：确认「源码 manifest」与「包内 manifest」不是同一份 —— 包内那份的 `backend.executable` 已被 CLI 改写为 `bin/<target>/<binary>`。很多「明明写了却不对」的问题都出在这里。
