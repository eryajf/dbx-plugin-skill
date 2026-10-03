# DBX 官方插件体系对齐记录（2026-10-03）

本次以 `npm run upstream:sync` 获取的快照作为审查基线，报告生成时间为
`2026-10-03T02:19:09Z`：

- `t8y2/dbx`：`87b030d626dc4869fe1435cb20e33daa08e98d78`
- `t8y2/dbx-store`：`3fa752e75265b3cf7be0726ac51e588b11e738ec`

核对范围包括 `tmp/upstream/dbx/docs/content/docs/plugin-development*.mdx`、
`plugins/README.md`、Manifest/Marketplace Schema、`RELEASING.md`、`SIGNING.md`、
CLI、Packager、Dev Host、Rust/Go SDK，以及完整 `tmp/upstream/dbx-store` 的
`CONTRIBUTING.md`、README、`schemas/`、`scripts/` 和 Workflow。

## 变化与处理

| 官方事实 | 上游证据 | 本仓库处理 |
| --- | --- | --- |
| 插件中心把 Marketplace、Installed、Settings 分开；官方目录固定、按当前 target 回退 `universal`，并在激活前校验目录哈希、Manifest 身份、权限和仓库签名 | `tmp/upstream/dbx/plugins/README.md` 的 Marketplace and repository model；`marketplace.schema.json` | 更新 `skill/SKILL.md`，补充官方仓库信任边界和目录选择规则 |
| 插件快捷入口支持跨位置排序、按插件隐藏；设置入口固定在末尾，无可见入口时整个区域隐藏 | `tmp/upstream/dbx/docs/content/docs/plugin-development.cn.mdx` 的“插件快捷入口”章节 | 更新 `skill/SKILL.md`、`skill/references/contributions.md` |
| 连接 provider 的显示元数据按 provider → plugin → ID → 通用图标回退；可选字段缺失保持未设置 | `tmp/upstream/dbx/plugins/README.md` 的 `connection-provider` 章节 | 更新 `skill/references/contributions.md` |
| `.dbxp` 以 `checksums.json` 覆盖包内条目；正式安装需要受信任仓库签名，已安装版本不可覆盖并支持回滚 | `tmp/upstream/dbx/plugins/README.md` 的 Package layout；`sdk/packager` | 更新 `skill/SKILL.md`、`skill/references/packaging.md` |
| Manifest Schema、候选 Schema、CLI 版本、候选校验、签名输入和自动同步流程未出现结构性漂移 | `tmp/upstream/dbx/plugins/manifest.schema.json`、`tmp/upstream/dbx-store/schemas/`、`scripts/validate.mjs`、`.github/workflows/` | 保持现有 `manifest.md`、`cli.md`、`publishing.md` 和校验脚本；未复制上游源码 |

`dbx-store` 当前头部提交是已签名插件发布（`io.dbx.files@0.1.87`），没有修改候选 Schema、校验器或发布 Workflow。上游 `dbx` 当前头部是 transfer 测试提交，未改变插件公开契约。

## 修改文件

- `skill/SKILL.md`
- `skill/references/contributions.md`
- `skill/references/packaging.md`
- 本记录文件

## 验证

- `npm run upstream:sync`：成功，获取上述两个 commit。
- `npm run upstream:report`：成功，报告记录 commit 与文件 SHA-256。
- `npm run upstream:check`：沙盒内无法访问 GitHub DNS，未据此改写基线；本次没有修改 `.github/upstream-baseline.json`。
- `npm test`
- `npm run verify:package`

