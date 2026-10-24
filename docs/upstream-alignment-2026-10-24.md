# DBX 官方插件体系对齐记录（2026-10-24）

## 基线与方法

- DBX：`c6fb06c035bac863731999072b85f82e63083765`。
- dbx-store：`06bd80d275fddf274c0a12b0f5e9c470c275e733`。
- npm `@dbx-app/plugin-cli`：在线核验为 `0.1.9`。
- 本 skill：`0.1.19` → `0.1.20`。

执行 `npm run upstream:sync` 和 `npm run upstream:report`，快照与文件 SHA-256 保存在忽略的 `tmp/upstream/`。将本次两个 commit 分别与上次 DBX `0297c5ecf9d727b18e918175d1bcc2f8aa08f08f`、Store `823f2a22e4645bace5dd63c8dbd91ac682ea1c01` 做逐文件 Git 比较，而非仅比较最新一条提交或 Schema 指纹。

DBX 的 `tools/upstream-sources.json` 全部选取范围无文件变化，包括中英文开发文档、Manifest/Marketplace Schema、CLI 模板与实现、Rust/Go SDK、dev-host、packager、发布与签名说明、reusable workflow、Host bridge/窗口/媒体实现及 Redis codec 实现与测试。Store 全仓库比较仅有以下 11 个数据文件变化：

- `catalog/index.json`
- `plugins/com.dbx.dbf.json`
- `plugins/com.dbx.wsl.json`（新增）
- `plugins/com.leavingrain.imrepo.json`
- `plugins/io.dbx.xxljob-console.json`
- `plugins/io.github.caichangqing1120.apollo.json`
- `plugins/io.github.caizong10.rdp.json`（新增）
- `plugins/io.github.lieng618.dbx-mini-games.json`
- `plugins/io.github.nixing178.jenkins.json`
- `publishers/caizong10.json`（新增）
- `publishers/w89588.json`（新增）

这些变化是具体插件上架、版本与发布者记录，不构成新的插件开发契约。Store 的全部 Schema、脚本、Workflow、README、CONTRIBUTING 与签名密钥/撤销规则文件未变。上游路径均相对于对应仓库，证据版本为上述完整 commit。

## 逐项结论

| 本仓库文件 | 分类 | 核验结论与上游证据 |
| --- | --- | --- |
| `skill/SKILL.md` | 仍有效 / 仅文字变化 | 更新核验基线；`docs/content/docs/plugin-development*.mdx`、`plugins/README.md` 仍支持已有路由与工作流 |
| `skill/references/manifest.md` | 仍有效 | `plugins/manifest.schema.json` 的身份、权限、入口、capabilities、本地化字段未变 |
| `skill/references/contributions.md` | 仍有效 | Schema、两篇开发文档与 README 的八类贡献点、连接表单、命令及 MCP 暴露面未变 |
| `skill/references/host-api.md` | 仍有效 | `apps/desktop/src/lib/plugins/pluginHostBridge.ts`、窗口、AI、图形、媒体与资源协议实现未变 |
| `skill/references/sidecar-protocol.md` | 仍有效 | `plugins/sdk/{rust,go}`、开发文档以及 `apps/desktop/src/lib/redis/redisPluginCodec.ts` 未变；保留 codec、有状态工具和不确定事务结果约定 |
| `skill/references/cli.md` | 仍有效 / 仅文字变化 | `plugins/sdk/cli` 无变更，npm 最新仍为 0.1.9；更新核验日期和源码 commit |
| `skill/references/debugging.md` | 仍有效 | `plugins/sdk/dev-host` 无变更，保留诊断、32 MiB 资源上限与真实宿主验收边界 |
| `skill/references/packaging.md` | 仍有效 | `plugins/sdk/packager`、CLI 和 `.github/workflows/plugin-release-reusable.yml` 未变 |
| `skill/references/publishing.md` | 仍有效 | Store `schemas/`、`scripts/`、`.github/workflows/` 与 `CONTRIBUTING.md` 未变，单 PR 候选与 R2 签名规则继续适用 |
| `skill/references/troubleshooting.md` | 仍有效 | 上述校验实现及错误契约未变 |
| `skill/scripts/check-project.mjs` | 仍有效 | Manifest/CLI 与 codec 发现条件未变，无新增校验行为 |
| `skill/scripts/inspect-dbxp.mjs` | 仍有效 | Packager 的归档、校验和与签名约束未变 |
| `skill/scripts/make-candidate.mjs` | 仍有效 | Store `validate.mjs`、`sync-release-candidate.mjs` 与候选 Schema 未变 |
| `skill/scripts/dev-logs.mjs` | 仍有效 | dev-host `diagnostics.mjs` 与 `server.mjs` 未变 |

本轮无新增支持或已确认过时的开发契约，无需更改校验脚本或增加测试。最近的实质新增仍为 10 月 23 日已对齐的 Redis codec 与有状态 MCP 约定，详见前次记录。本次修改 `skill/SKILL.md`、`skill/references/cli.md`、README、版本号与本记录。

## 仍需确认的边界

- main 源码能力不自动代表已进入 npm CLI 0.1.9 或某个正式 DBX 版本；未进行真实桌面端跨平台运行验收，不编造最低版本。
- `plugins/RELEASING.md` 的历史 Issue/catalog PR 描述仍与 Store 单 PR 流程冲突；继续以 Store 实际脚本和 Workflow 为准。
- 上述“无变化”结论限定于选取的 DBX 插件范围及完整 Store；不代表 DBX 全仓库无其他产品变化。

## 验证与发布

- `npm run upstream:sync`、`npm run upstream:report`：通过。
- `npm run upstream:check -- --snapshot`：沙盒内联网失败，沙盒外重跑通过；Manifest 指纹 `986277569eaf4293f2ac28162d8f860c6e2dbc2eda04431b008329779ceb79aa`、候选 Schema 指纹 `ad79a8bea4c24ef54fb9e7aa61e40090fc9d8810994d65155f548c39b55715ee`、CLI 0.1.9 均无漂移，不改写基线。
- 发布前运行 `npm test`、`npm run verify:package -- --tag v0.1.20` 和 `git diff --check`，结果见发布提交前的验证记录。
- 本仓库 `.github/workflows/release.yml` 由 `v*` 标签 push 触发，依次测试、打包、发布 npm、创建 GitHub Release 并上传 tgz、zip 和校验和；不是由 Release published 事件触发。
- 不提交上游快照、构建产物、缓存、凭据或私钥。
