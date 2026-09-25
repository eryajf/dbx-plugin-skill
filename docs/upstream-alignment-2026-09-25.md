# DBX 插件体系上游对齐记录（2026-09-25）

本次核对基线：

- `t8y2/dbx`：`8444fdbf09a09a0f3b82c4ef28d745d0d63c133c`
- `t8y2/dbx-store`：`61be5d582ce1254980a92ca36ffb5444fb2db7eb`

快照由 `npm run upstream:sync` 获取，文件清单与 SHA-256 保存在被 `.gitignore` 忽略的 `tmp/upstream/report.json`。本次漂移基线已由 `npm run upstream:update` 更新；Manifest Schema SHA-256 为 `0b2300f0c89a1d54184a2f69bdf5f2708f6fc203c3f0c4706b7c485b95a104d8`，候选 Schema SHA-256 为 `ad79a8bea4c24ef54fb9e7aa61e40090fc9d8810994d65155f548c39b55715ee`，CLI 版本为 `0.1.9`。

## 对齐结果

| 范围 | 结论 | 上游证据 | 本仓库处理 |
| --- | --- | --- | --- |
| 只读数据查询 | 新增支持（上游 `26a015c`，2026-09-24） | `tmp/upstream/dbx/docs/content/docs/plugin-development.cn.mdx` 的“只读数据查询”；`plugins/manifest.schema.json` 的 `host.data:read`；`crates/dbx-core/src/query/plugin_data.rs` 定义 Host API 1.4、逐连接同意、单条只读 SQL、5000 行/8 MiB/60 秒上限和 4 路并发 | 更新 `skill/references/host-api.md`、`skill/references/manifest.md`、`skill/SKILL.md`、`skill/references/contributions.md`；Manifest 白名单和 `check-project.mjs` 加入 `host.data:read`；`make-candidate.mjs` 强制候选权限与 Manifest 一致 |
| 系统剪贴板读取 | 新增支持（上游 `92f92f6`，2026-09-24） | `pluginHostBridge.ts` 的 `host.clipboardRead`、会话同意、速率限制和 `capabilities.clipboardRead`；中英文插件开发文档的“系统剪贴板”；Manifest Schema 的 `host.clipboard:read` | 更新 `skill/references/host-api.md`、`skill/references/manifest.md`、`skill/SKILL.md`、`check-project.mjs`，记录读取权限、能力位和降级方式 |
| Sidecar → DBX 内置 AI Agent 工具 | 新增支持（上游 `26a015c`） | `crates/dbx-core/src/ai/plugin_tools.rs`、`plugins/README.md` 和开发文档：`mcp/tools`/`mcp/call`、用户显式开启、`readOnlyHint` 免确认、其它调用逐次确认、可移植 JSON Schema 与结果上限 | 更新 `skill/references/sidecar-protocol.md`，补充方法载荷、连接绑定、确认边界、schema 子集、超时和不可信输出规则 |
| `context-menu` | 新增 table 菜单和 Host `open-workbench` action（上游 `4c1eaa6`，2026-09-24） | `plugins/manifest.schema.json` 的 `menu: connection|table` 与 `contextMenuAction`；`plugins/README.md` 说明 table context、同插件 workbench 引用以及旧式 backend 兼容 | 更新 `skill/references/contributions.md`；`check-project.mjs` 接受 table/action、校验 action 形状并检查 workbench 引用 |
| 插件快捷入口停靠位置 | 新增 Host UI 支持（上游 `dc22e8c`，2026-09-24） | `plugin-development.cn.mdx` 的“插件快捷入口”：顶部/底部、连接树、浮动栏和插件中心下拉位置；无需 Manifest 或 backend 变更 | 在 `skill/references/contributions.md` 的总说明中记录这是 Host 设置，不新增插件契约 |
| dbx-store 候选权限一致性 | 新增校验 | `tmp/upstream/dbx-store/.github/workflows/sign-plugin-pr.yml` 的 `Verify candidate permissions match the package manifests`；`scripts/sync-release-candidate.mjs` 从包 Manifest 生成权限并允许版本更新时省略字段回退已发布值 | 更新 `skill/references/publishing.md` 的签名前检查和错误对照；`skill/scripts/make-candidate.mjs` 以 `manifest.json.permissions` 为权威，发现 `.dbx-store.json` 过期时直接报错 |
| 其它 Schema、CLI、Packager、Dev Host、Sidecar、签名和商店流程 | 仍有效或仅文字变化 | 对照 `tmp/upstream/dbx/plugins/manifest.schema.json`、`plugins/sdk/{cli,packager,dev-host,rust,go}`、`plugins/{RELEASING,SIGNING}.md` 与完整 `tmp/upstream/dbx-store` | 未发现需要额外修改的事实；保留现有规则 |

## 验证

- `npm run upstream:sync`：成功，获取上述两个 commit。
- `npm run upstream:update`：成功，更新 `.github/upstream-baseline.json`。
- `npm test`：通过（66 项）。
- `npm run verify:package`：通过（`dbx-plugin-skill@0.1.12`，19 个文件）。
- `npm run upstream:check`：本地执行时远程 fetch 受当前网络环境限制；同步快照和本地基线已用于本次审查。
