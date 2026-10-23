# DBX 官方插件体系对齐记录（2026-10-23）

## 基线与方法

- DBX：`0297c5ecf9d727b18e918175d1bcc2f8aa08f08f`。
- dbx-store：`823f2a22e4645bace5dd63c8dbd91ac682ea1c01`。
- npm `@dbx-app/plugin-cli`：`0.1.9`，本次在线查询未变。
- 本 skill：`0.1.18` → `0.1.19`。

先执行 `npm run upstream:sync`，再执行 `npm run upstream:report`。扩展 `tools/upstream-sources.json`，纳入 Redis codec 的实现和两份测试后再次同步，两个 commit 未变。最终 DBX 选取 100 个文件，dbx-store 完整快照 152 个文件；快照及 SHA-256 报告仅保留在忽略的 `tmp/upstream/`，不进入发行包或提交。

与上次 DBX `cb4406c715bc778d101f7ca3c9f8737b53392071`、dbx-store `4f64d038405a2c31e631c7e340408a860ab34bf9` 做逐文件对比，再结合当前中英文开发文档、Schema、实现与测试复核。DBX 原有选取范围只有两篇开发文档和 `plugins/README.md` 改变；新增纳入的四个 Redis 文件也是本轮上游新增文件。Store 的 41 个变化文件全部属于 catalog、插件记录、publisher 或自动登记数据，Schema、脚本、说明文档及 Workflow 未变。

## 实质变化与证据

下列 DBX 路径均相对于 `tmp/upstream/dbx/`，对应上述完整 DBX commit。

| 分类 | 上游证据 | 处理 |
| --- | --- | --- |
| 新增支持 | `plugins/README.md` 的 Redis value codec capability；`apps/desktop/src/lib/redis/redisPluginCodec.ts` 的 `listRedisPluginCodecs`、`decodeRedisPluginValue` 和输入/结果校验 | 在 `manifest.md`、`sidecar-protocol.md`、`SKILL.md` 补充 `redis-value-codec-v1`、原生后端条件、`redis/codec/decode` params/result、规范 Base64、2 MiB/10 秒和只读边界 |
| 新增支持 | `apps/desktop/src/components/redis/RedisPluginCodecView.vue` 的 `discover`/`decode`/watch；同目录 `RedisPluginCodecView.spec.ts` 与 `lib/__tests__/redis/redisPluginCodec.spec.ts` | 补充显式选择才传值、载荷更新重解码、丢弃过时响应、失败清空结果、转义文本及 JSON 原始值；`debugging.md` 增加真实宿主验收点 |
| 已过时 | 旧 `manifest.md` 将顶层 capabilities 用途全部标为未定义；当前源码按指定 kind 发现 Redis codec | 改为已定义 Redis kind、其它 kind 不推断；保留与权限、UI 初始化能力位的区别 |
| 已过时 | `SKILL.md` 顶层白名单漏写已被 Schema/CLI 接受的 `capabilities` | 修复入口白名单和任务路由 |
| 新增预检 | `redisPluginCodec.ts` 仅列出兼容且有 backend 的插件；Schema 本身不要求该 kind 必须带 backend | `check-project.mjs` 对缺少后端给出警告，不额外发明 Schema 错误；新增有/无后端两项回归用例 |
| 新增约定 | `docs/content/docs/plugin-development.cn.mdx`“有状态工具的生命周期与失败语义”；英文对应 Lifecycle and failure semantics for stateful tools | `sidecar-protocol.md`、`contributions.md`、`debugging.md`、`SKILL.md` 补充无副作用发现、显式修改型 start/stop、执行时策略校验、会话限制与配置变更协调 |
| 已过时 | 两篇开发文档区分内置 Agent 的已打开连接 lifecycle 快照和外部 MCP 调用时的已保存连接配置 | 修正 `sidecar-protocol.md`、`contributions.md` 把外部面也限定为已打开连接的说法，并区分外部 `dbx_<prefix>__<tool>` 名称 |
| 新增约定 | 两篇开发文档的 COMMIT 后超时/断连说明 | 记录 `unknown` 事务结果、不可自动重试可能已提交的写操作，分别验证提交数据和锁清理；明确不是宿主新增事务状态 API |

## 全部 skill 文件复核

| 文件 | 状态 | 核对结论 |
| --- | --- | --- |
| `skill/SKILL.md` | 已过时 / 新增支持 | 修正白名单，加入 codec 与有状态 MCP 路由和工作流；签名、入口、权限边界仍有效 |
| `skill/references/manifest.md` | 已过时 / 新增支持 | 明确 Redis capability 用途；身份、权限、entrypoints、本地化与 Schema 形状仍有效 |
| `skill/references/contributions.md` | 已过时 / 新增约定 | 区分内置与外部 MCP 连接边界；八种贡献点、表单、命令、菜单、文件系统接口仍有效 |
| `skill/references/host-api.md` | 仍有效 | 已选取 Host bridge、Workbench、浮动窗口、AI/媒体及资源协议源码未变；codec 不伪装为新的 window.dbxPlugin API |
| `skill/references/sidecar-protocol.md` | 已过时 / 新增支持 | 新增 codec 协议和 MCP 生命周期说明；Protocol v1、握手、JSONL/framed 与 Rust/Go SDK 契约未变 |
| `skill/references/cli.md` | 仍有效 / 兼容说明更新 | CLI 仍为 0.1.9；更新基线，记录旧 CLI 拒绝 capabilities 时使用源码 CLI 的官方建议 |
| `skill/references/debugging.md` | 仍有效 / 新增验收项 | dev host 子集、32 MiB、诊断接口不变；增加真实 Redis 入口和有状态 MCP 验收 |
| `skill/references/packaging.md` | 仍有效 | CLI/packager 未变；include、安全路径、target、checksums、后端重写不变 |
| `skill/references/publishing.md` | 仍有效 | Store 全部 Schema、校验/同步/签名/finalize 脚本、README、CONTRIBUTING 与 Workflow 未变；现有文档冲突处理继续适用 |
| `skill/references/troubleshooting.md` | 仍有效 | 已有错误语义不变；Redis 失败与兼容性诊断收录到协议及 CLI 文档 |
| `skill/scripts/check-project.mjs` | 新增预检 | 保留现有校验，增加 Redis codec 缺少 backend 的发现警告 |
| `skill/scripts/inspect-dbxp.mjs` | 仍有效 | ZIP、checksums、签名及包身份边界未变 |
| `skill/scripts/make-candidate.mjs` | 仍有效 | 候选字段、权限来源、URL、hash/size 与聚合产物规则未变 |
| `skill/scripts/dev-logs.mjs` | 仍有效 | diagnostics 游标、筛选、500 条环形缓冲规则未变 |

本轮没有需要单独同步的纯排版变化。商店新增插件和版本属于目录数据，不作为开发契约复制到 skill。`plugins/RELEASING.md` 的历史 Issue/catalog PR 描述与当前 Store 单 PR 流程仍冲突，继续以 Store 脚本及 Workflow 为准；官方私钥、候选无签名、最终签名不可覆盖等边界不变。

## 需要人工确认的边界

- 官方未明确 Redis codec view 的最低 DBX 发行版本；只确认该 main commit 已实现，未运行真实 DBX 安装验收，不编造 `engines.dbx` 下限。
- npm CLI 版本没有变化，main 的能力不能自动视为已经包含在 0.1.9 发布二进制中。使用 codec 前确认目标宿主，旧 CLI 若拒绝 capabilities 则按官方说明构建当前源码 CLI。
- 未定义的其它 capability kind 不推断运行时语义；MCP 新增内容是插件设计与安全约定，没有新增协议版本或通用事务状态查询 API。

## 验证

- `npm test`：85 项通过、0 失败，含 Redis codec 有/无 backend 回归用例。
- `npm run upstream:check -- --snapshot`：通过；两份 Schema 指纹及 npm CLI 版本均未漂移，因此不改写 `.github/upstream-baseline.json`，也无需运行 `upstream:update`。
- `npm run verify:package`：默认缓存目录被沙盒阻止写入；改用 `npm_config_cache=/private/tmp/dbx-plugin-skill-npm-cache` 重跑通过，19 个文件（9 篇 reference、4 个脚本），无上游快照或开发产物。
- `git diff --check`：通过。

发布使用 `v0.1.19` 标签；本仓库 `.github/workflows/release.yml` 由标签 push 触发测试、打包、npm 发布及 GitHub Release 资产生成，不是由 Release published 事件触发。
