# DBX 官方插件体系对齐记录（2026-10-19）

本次以 `npm run upstream:sync` 获取的快照作为审查基线：

- `t8y2/dbx`：`cb4406c715bc778d101f7ca3c9f8737b53392071`
- `t8y2/dbx-store`：`4f64d038405a2c31e631c7e340408a860ab34bf9`
- npm `@dbx-app/plugin-cli`：`0.1.9`

核对范围包括中文/英文插件开发文档、`plugins/README.md`、Manifest/Marketplace Schema、`RELEASING.md`、`SIGNING.md`、CLI/Packager/Dev Host/Rust/Go SDK、Host bridge/Workbench 实现，以及 dbx-store 的 `CONTRIBUTING.md`、README、schemas、scripts 和全部 Workflow。

## 实质变化与处理

| 分类 | 上游证据 | 本仓库处理 |
| --- | --- | --- |
| 新增权限 | `tmp/upstream/dbx/plugins/manifest.schema.json` 的 `permissions` 枚举新增 `host.connections:read`，同时保留历史拼写 `host.connections::read`；`apps/desktop/src/lib/plugins/pluginHostBridge.ts` 的 `host.getConnections` / `host.listConnections` 对权限做兼容判断 | 更新 `skill/references/manifest.md`、`skill/references/host-api.md`、`skill/SKILL.md`；`skill/scripts/check-project.mjs` 接受规范权限与历史别名，并提醒新插件使用单冒号形式 |
| 新增 Host API | `tmp/upstream/dbx/plugins/README.md` 的 Workbench API；`docs/content/docs/plugin-development.cn.mdx` 的“连接信息读取”；`pluginHostBridge.ts` 暴露 `setTitle`、`getTitle`、`getConnections` 与 `connections.list`，能力位为 `workbenchTitle` / `connectionsApi` | 更新 `skill/references/host-api.md`、`skill/references/manifest.md`、`skill/references/debugging.md`、`skill/SKILL.md`，记录标题作用域、脱敏字段、已打开连接边界和运行时能力探测 |
| Manifest Schema 新字段 | `tmp/upstream/dbx/plugins/manifest.schema.json` 新增顶层 `capabilities` 数组，每项为 `{ id, label, kind? }`；`plugins/sdk/cli/src/lib.rs` 将其加入未知字段白名单 | 更新 `skill/references/manifest.md`；`check-project.mjs` 增加结构校验和 `test/smoke.mjs` 回归用例。公开插件文档没有定义该列表的运行时语义，因此 skill 不把它当作权限或能力位 |
| 开发宿主约束 | `tmp/upstream/dbx/plugins/sdk/dev-host/README.md`、`assets.mjs` 将 UI 入口和单个资源上限统一为 32 MiB | 更新 `skill/references/debugging.md`，明确超过上限会拒绝 |
| 仅文字/依赖变化 | DBX 文档表格格式、Dev Host 依赖版本和 README 排版变化 | 不复制上游源码，不把排版变化写入 skill 契约 |
| dbx-store | 与上次基线相比，`schemas/plugin-candidate.schema.json`、`schemas/marketplace.schema.json`、`scripts/validate.mjs`、`scripts/finalize-candidates.mjs`、`scripts/sync-release-candidate.mjs`、签名与同步 Workflow 均无变化；变更仅为 catalog、插件发布者和自动登记数据 | `skill/references/publishing.md` 与候选生成脚本保持不变 |

## 复核状态

- `skill/SKILL.md`：补充工作台标题、连接列表和新能力位。
- `skill/references/manifest.md`：补充顶层 `capabilities` 形状、新权限和脱敏连接枚举边界。
- `skill/references/host-api.md`：补充 `setTitle`/`getTitle`、`getConnections`/`connections.list` 及 capability 检查。
- `skill/references/debugging.md`：补充 Dev Host API 子集和 32 MiB 资源限制。
- `skill/references/cli.md`：更新本次 DBX commit 与已发布 CLI 的边界说明。
- `skill/scripts/check-project.mjs`：同步 Manifest 顶层字段、权限和 `capabilities` 结构校验。
- `test/smoke.mjs`：增加顶层 capabilities、规范连接权限和历史别名的回归检查。
- `README.md`：更新最近一次官方对齐入口。
- `.github/upstream-baseline.json`：由本次同步快照重新基线化。

## 未变化和需要人工确认

Manifest 的贡献点、入口、Sidecar Protocol v1、打包 checksums、签名候选格式和 dbx-store 受保护 Workflow 未发现结构变化。`capabilities` 顶层列表的运行时用途在当前公开文档中没有说明，已按“Schema 支持、语义待官方确认”处理；不要用它替代 Host 权限或初始化 capability 检查。npm CLI 仍为 `0.1.9`，main 分支新增的 Host/dev-host 实现是否已进入该 npm 版本仍需真实发布版本核对。
