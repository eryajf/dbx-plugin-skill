# DBX 官方插件体系对齐记录（2026-10-29）

## 基线与方法

- DBX：`1b8dfd9673e993f65a6253c0faa0882bd49a544b`。
- dbx-store：`f8b87d4eaced4beb53077dbf3eab46411f3a49ae`。
- 上一轮基线：DBX `c6fb06c035bac863731999072b85f82e63083765`，Store `06bd80d275fddf274c0a12b0f5e9c470c275e733`。
- 本 skill：`0.1.20` → `0.1.21`。

执行 `npm run upstream:sync` 与 `npm run upstream:report`，再用两个上游仓库的基线 commit 做逐文件差异。DBX 的选取范围覆盖 Manifest/Marketplace Schema、插件开发文档、CLI、Packager、dev-host、Rust/Go SDK、发布 Workflow、Host bridge/Workbench 与媒体实现、Redis codec；dbx-store 使用完整浅克隆。

## 实质变化

| 上游事实 | 分类 | 本仓库修改 |
| --- | --- | --- |
| `plugins/manifest.schema.json` 的 `mcpContribution` 新增 `toolsets`、`scope`、`tools`；外部工具按 `read` / `write` / `full` 声明访问级别，最多 64 项 | 新增支持 | `skill/references/contributions.md`、`skill/references/manifest.md`、`skill/references/sidecar-protocol.md`、`skill/scripts/check-project.mjs`、`test/smoke.mjs` |
| `plugins/marketplace.schema.json` 新增 `mcpTools`，用于安装前的 MCP 工具标记与筛选 | 新增支持 | `skill/references/contributions.md`、`skill/references/publishing.md`、`skill/references/sidecar-protocol.md`、`skill/SKILL.md` |
| `plugins/README.md` 明确外部 MCP 工具授权、访问上限、逐工具声明、连接子范围 `SCOPE_REQUIRED`、高风险确认与更新后的重新授权 | 新增支持 | `skill/references/contributions.md`、`skill/references/sidecar-protocol.md` |
| `docs/content/docs/plugin-development.mdx` 与 `.cn.mdx` 扩展 fileTransfer 的 `onDrop` / `onDragState` 坐标元数据 | 新增支持 | `skill/references/host-api.md`、`skill/SKILL.md` |
| `.github/workflows/plugin-release-reusable.yml` 将 `actions/checkout` 升为 v7、`actions/setup-go` 升为 v7；dev-host `oxfmt` 升为 0.75.0 | 文字/构建环境变化 | 当前 skill 不复制官方 Workflow；使用 CLI 时仍按版本与真实宿主能力探测 |

## 仍有效与未变化

- Store 的 `schemas/`、`scripts/`、`.github/workflows/`、`CONTRIBUTING.md`、README 与签名密钥/撤销规则本轮没有契约变化；候选格式、单 PR 流程、未签名候选、受保护签名和 R2 不可覆盖规则继续适用。
- dbx-store 本轮 `automation/plugin-sources.json` 及 `plugins/` / `publishers/` 仅增加或调整具体插件登记与目录数据，不构成插件开发规则变化。
- Redis codec、有状态 MCP 的发现/执行/不确定事务结果、Host API 权限和包校验规则在本轮未被废弃。
- DBX main 源码能力不自动代表已进入 npm CLI 或目标桌面版本；新增 MCP 授权与 fileTransfer 坐标应在运行时检查能力并做降级。

## 验证

- `npm run upstream:sync`：通过。
- `npm run upstream:report`：通过，记录上述两个 commit 与文件 SHA-256。
- `npm test`、`npm run verify:package`、`npm run upstream:check -- --snapshot`：修改完成后执行并记录最终结果。
- 不提交 `tmp/upstream/`、`dist/`、`.dbx-dev/`、凭据或签名私钥。

## 上游证据路径

- `tmp/upstream/dbx/plugins/manifest.schema.json`
- `tmp/upstream/dbx/plugins/marketplace.schema.json`
- `tmp/upstream/dbx/plugins/README.md`
- `tmp/upstream/dbx/docs/content/docs/plugin-development.mdx`
- `tmp/upstream/dbx/docs/content/docs/plugin-development.cn.mdx`
- `tmp/upstream/dbx/.github/workflows/plugin-release-reusable.yml`
- `tmp/upstream/dbx/plugins/sdk/dev-host/package.json`
- `tmp/upstream/dbx-store/automation/plugin-sources.json`
- `tmp/upstream/dbx-store/schemas/`、`scripts/`、`.github/workflows/`、`CONTRIBUTING.md`
