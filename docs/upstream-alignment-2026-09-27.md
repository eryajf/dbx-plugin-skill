# DBX 官方插件体系对齐记录（2026-09-27）

本次基线来自 `npm run upstream:sync` 的官方快照：

- `t8y2/dbx`：`20c50550cf87c15b8db706749b804fe36ae5a1e5`
- `t8y2/dbx-store`：`3f47250de335d03607e9a65e272ae5950710af91`

核对范围包括 `plugin-development*.mdx`、`plugins/manifest.schema.json`、`plugins/marketplace.schema.json`、`plugins/README.md`、`RELEASING.md`、`SIGNING.md`、CLI/Packager/Dev Host/SDK，以及 `dbx-store` 的 `CONTRIBUTING.md`、候选 Schema、校验脚本和 Workflow。

## 变化与处理

| 分类 | 上游证据 | 处理 |
| --- | --- | --- |
| 新增 `command` / `menus` contributions | `tmp/upstream/dbx/plugins/manifest.schema.json` 的 `commandContribution`、`menusContribution`；`plugin-development*.mdx` 的快捷入口说明 | 更新 `skill/references/contributions.md`、`manifest.md`、`SKILL.md`；`check-project.mjs` 增加类型、Workbench 引用、菜单位置和字段校验 |
| Workbench AI 推荐 | `manifest.schema.json` 的 `workbenchAi` / `aiRecommendation`；`plugin-development*.mdx` 的 AI 推荐章节；`sdk/dev-host/server.mjs` 的推荐更新校验 | 更新 `contributions.md`、`manifest.md`、`host-api.md`、`SKILL.md`；记录最多 5 项、占位符、运行时覆盖与 capability 检查 |
| AI 对话模式与能力位 | `plugin-development*.mdx` Host API 表格与 `host.ai.openConversation` 说明 | 更新 `host-api.md`，补充 `mode: ask|agent`、`capabilities.aiRecommendations` 及真实宿主验收边界 |
| 快捷入口行为 | `plugin-development*.mdx` 的 Plugin Shortcuts 章节 | 更新 `contributions.md` 与 `SKILL.md`，说明 `appToolbar` 条件、排序和插件中心设置行为 |
| CLI / Dev Host / dbx-store | 当前快照中的 CLI、Packager、Dev Host、发布说明、候选 Schema 和校验 Workflow | 逐项核对后保持现有文档和脚本规则；未发现需要修改的冲突 |

Manifest 指纹由旧基线 `0b2300f0c89a…` 更新为当前 `9704e42427f7c8c678eb766472eb9363f3669c48d143f368a6859c19db395ea4`；候选 Schema 指纹和 `@dbx-app/plugin-cli` `0.1.9` 未变化。
