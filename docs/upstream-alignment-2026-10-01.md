# DBX 官方插件体系对齐记录（2026-10-01）

本次以 `npm run upstream:sync` 获取的快照为审查基线。同步报告时间为
`2026-09-30T16:01:17Z`：

- `t8y2/dbx`：`816b0a0996ea7f81cd23e4fd264531c1be8a59c9`
- `t8y2/dbx-store`：`679b82aadedaa69a39e548ae7150a6fd0d906904`

核对范围包括 `tmp/upstream/dbx/docs/content/docs/plugin-development*.mdx`、
`tmp/upstream/dbx/plugins/README.md`、Manifest/Marketplace Schema、
`RELEASING.md`、`SIGNING.md`、CLI、Packager、Dev Host、Rust/Go SDK，以及
`tmp/upstream/dbx-store` 的 `CONTRIBUTING.md`、`schemas/`、`scripts/`、Workflow 和 README。

## 本次发现和处理

| 官方变化 | 上游证据 | 本仓库处理 |
| --- | --- | --- |
| Workbench 可调用自己的命令；命令支持 `reuse`、`instance_key` | `tmp/upstream/dbx/plugins/README.md` 的 Host API 与 command 章节；`21102f481001f4e81546e0b8b401639a09f70d82` `feat(plugins): run declared commands from plugin workbench UI` | 更新 `skill/references/host-api.md`、`contributions.md`、`manifest.md`、`SKILL.md`；预检脚本校验字段和值；`test/smoke.mjs` 增加合法/非法用例 |
| dock command 支持 `options_action`，由 Sidecar 返回本地化启动选项 | `tmp/upstream/dbx/plugins/README.md` 的 `Declarative launch options`；`de70545c701f3b11277d5ba115eb6a360aecc946` | 更新 `contributions.md`、`manifest.md`、`SKILL.md`；要求 backend entrypoint 并校验非空字符串 |
| 动态 context-menu、一级子菜单和 dialog workbench | `tmp/upstream/dbx/plugins/README.md` 的 `context-menu`；`bba60bfa862cfeb63e2bd5ed9f287375413214a7` | 更新 `contributions.md`、`manifest.md`、`SKILL.md`；预检脚本支持 `dynamic` 布尔值并要求 backend |
| AI 模型发现和受控纯文本生成 | `tmp/upstream/dbx/plugins/README.md` 的 Host API 列表；`9a1c64b9f0c7c1ae8ef849360b4a87a3cf3f9c7f` | 更新 `host-api.md`、`SKILL.md`，记录 `aiModelDiscovery` / `aiCompletion`、确认、长度上限和凭据隔离 |
| 文件夹拖放展开、`relativePath`、`dropId`、`truncated` 与能力位 | `tmp/upstream/dbx/docs/content/docs/plugin-development.cn.mdx` 的桌面文件传输章节；`be82fdc989e431bb3f5e9ad8df6efa4082b18137` | 更新 `host-api.md`、`SKILL.md`，并在 `debugging.md` 标明 Dev Host 不模拟桌面拖放 |
| dock 工作台可切换到主工作区 Tab，宿主 context 的 surface 从 `panel` 更名为 `dock` | `0212231421516e3f69cf34fa4dc0fe8b9485ab0d`；实现涉及 `apps/desktop/src/lib/plugins/pluginCommandRegistry.ts`、`pluginHostBridge.ts`、`pluginBottomDock.ts` | 在 `host-api.md`、`contributions.md`、`SKILL.md` 记录 `openWorkbench(..., { target: "tab" })` 和 `dock` surface；`debugging.md` 标明需真实 DBX 复验 |

当前 Manifest Schema、Marketplace Schema、CLI 版本、打包约束、签名说明和
`dbx-store` 候选/签名/Workflow 规则没有发现新的契约变化。`dbx-store` 基线之后的
12 个提交均为已签名插件发布，例如当前头部
`feat(store): publish signed io.github.yuwengueen.dbx-code-editor@0.1.33`，未修改
`schemas/`、校验脚本或发布流程，因此没有改动 `skill/references/publishing.md`。

本轮同时复核了近期 MCP 安全提交（通配符 allowlist、只读策略与会话范围、未签名安装
显式 opt-in、Rust 侧文件 consent anchoring）；现有 `sidecar-protocol.md`、`manifest.md`
和 `SKILL.md` 已覆盖这些规则，本次没有重复改写。

## 修改文件

- `README.md`
- `skill/SKILL.md`
- `skill/references/contributions.md`
- `skill/references/debugging.md`
- `skill/references/host-api.md`
- `skill/references/manifest.md`
- `skill/references/sidecar-protocol.md`
- `skill/scripts/check-project.mjs`
- `test/smoke.mjs`
- `.github/upstream-baseline.json`（确认 Manifest Schema 漂移后更新指纹）

未复制上游源码；`tmp/upstream/` 继续由 `.gitignore` 忽略。

## 验证

- `npm run upstream:sync`：成功获取上述两个提交；在本日稍早的一次沙盒内同步因 DNS 失败，随后已在沙盒外重试成功。
- `npm run upstream:report`：通过，报告记录上述 commit 和文件 SHA-256。
- `npm run upstream:check`：联网环境下通过；Manifest Schema 指纹已更新到 `22802c74884e8ad3…`，候选 Schema 仍为 `ad79a8bea4c24ef5…`，CLI 仍为 `v0.1.9`。
- `npm test`：通过（73 项）。
- `npm_config_cache=/tmp/dbx-plugin-skill-npm-cache-20261001 npm run verify:package`：通过（`dbx-plugin-skill@0.1.15`，19 个文件）。
