# DBX 官方插件体系对齐记录（2026-09-28）

本次基线来自 `npm run upstream:sync` 的官方快照：

- `t8y2/dbx`：`1aaa5ca717c8566933178391af5b13de009a97ac`
- `t8y2/dbx-store`：`7f3befc4d2b05dcd72871e9bdfa76401f7492e88`

核对范围包括 `plugin-development*.mdx`、`plugins/manifest.schema.json`、`plugins/marketplace.schema.json`、`plugins/README.md`、`RELEASING.md`、`SIGNING.md`、CLI/Packager/Dev Host/SDK，以及 `dbx-store` 的 `CONTRIBUTING.md`、候选 Schema、校验脚本和 Workflow。

## 变化与处理

| 分类 | 上游证据 | 处理 |
| --- | --- | --- |
| 新增 `mcp` contribution | `tmp/upstream/dbx/plugins/manifest.schema.json` 的 `mcpContribution`；`tmp/upstream/dbx/plugins/README.md` 的 `mcp` 章节；`tmp/upstream/dbx/docs/content/docs/plugin-development.cn.mdx` 的 MCP 工具说明 | 更新 `skill/references/manifest.md`、`skill/references/contributions.md`、`skill/references/sidecar-protocol.md`、`skill/SKILL.md`；`skill/scripts/check-project.mjs` 支持 `mcp` 类型、`ai_tools` / `external_tools` 布尔字段、backend 要求和每 Manifest 单个限制；`test/smoke.mjs` 增加合法与非法用例 |
| MCP 工具外部暴露与撤销 | `plugins/README.md` 与 `plugin-development.cn.mdx`：`external_tools` 默认关闭，外部 `dbx` MCP 仍受全局工具/连接白名单；插件中心开关可撤销，`ai_tools: false` 可关闭内置 AI 面 | 在贡献点和 Sidecar 参考中记录所有运行时门控，不把 Manifest 声明误写成权限绕过 |
| 插件快捷入口设置行为 | `plugin-development*.mdx` 的 Plugin Shortcuts：插件设置入口固定在末尾、可在全局配置隐藏、无入口时整个区域隐藏 | 复核现有快捷入口说明；该行为属于 Host UI 设置，不新增 Manifest 字段或脚本规则 |
| dbx-store 候选、签名和自动同步 | `t8y2/dbx-store@7f3befc` 的 `schemas/`、`scripts/`、`.github/workflows/`、`CONTRIBUTING.md` | 未发现候选 Schema、权限一致性、签名流程或 Workflow 规则变化，保持现有 publishing 参考 |

## 验证

- `npm run upstream:sync`：成功，获取上述两个 commit。
- `npm run upstream:check`：通过（Manifest Schema 指纹更新后已核对并刷新基线）。
- `npm test`：通过（69 项）。
- `npm_config_cache=/tmp/dbx-plugin-skill-npm-cache npm run verify:package`：通过（`dbx-plugin-skill@0.1.14`，19 个文件）。默认 npm 缓存因本机权限问题不可写，使用临时缓存完成同一校验。

本次未复制上游源码；`tmp/upstream/` 继续由 `.gitignore` 忽略。上游 Manifest Schema SHA-256 为 `5b261957595e4bb92bd8027064f8b87aa6f4e1a1c6d7a91f7bfe177d6c1738b4`，候选 Schema SHA-256 仍为 `ad79a8bea4c24ef54fb9e7aa61e40090fc9d8810994d65155f548c39b55715ee`。
