# DBX 插件体系上游对齐记录（2026-09-24）

本次核对基线：

- `t8y2/dbx`：`5d5a12ec30f2a0ac769cc67c9448d23cec6bc206`
- `t8y2/dbx-store`：`f8ebbeebf8aadc78c4be480d4f53249d26d6df59`

快照由 `npm run upstream:sync` 获取，文件清单与 SHA-256 保存在被 `.gitignore` 忽略的 `tmp/upstream/report.json`。

## 对齐结果

| 范围 | 结论 | 证据与处理 |
| --- | --- | --- |
| Host API 1.3 表结构元数据 | 新增支持 | `tmp/upstream/dbx/docs/content/docs/plugin-development.cn.mdx` 的“表结构元数据”与 `tmp/upstream/dbx/plugins/README.md` 的 `getTableMetadata` 章节定义 `host.schema:read`、`schemaMetadataApi`、已打开连接限制和字段能力语义；已补到 `skill/references/host-api.md`。 |
| Manifest 权限枚举 | 新增支持 | `tmp/upstream/dbx/plugins/manifest.schema.json` 增加 `host.schema:read`，Schema SHA-256 从 `1d2bd91af16847f760a608f14a25fa8f26b17b1f9cf47d68c45eb7dc370e629b` 变为 `2c6b6f1551340c410d466e20487ab9b2ea4feecfc0f72b98223db9d50d0a6985`；已同步 `manifest.md`、`SKILL.md`、`check-project.mjs` 和 `.github/upstream-baseline.json`。 |
| DBX Store 候选、签名和自动同步 | 仍有效 | `tmp/upstream/dbx-store` 当前提交的 `CONTRIBUTING.md`、`schemas/`、`scripts/` 与 Workflow 仍与 `skill/references/publishing.md` 描述一致：单 PR 候选、受保护签名、R2 不可覆盖和 `autoUpdate` 发布同步。 |
| CLI、Packager、Dev Host、Sidecar、贡献点和现有 Host API | 仍有效 | 对照 `tmp/upstream/dbx` 的插件开发文档、README、Schema、SDK 和发布说明；现有规则未发现需要修改的冲突。 |

## 验证

本次上游基线使用本地同步快照更新；网络不可用时 `npm run upstream:check` 无法访问远程状态，因此保留快照 commit 与本地 Schema 指纹作为审查证据。
