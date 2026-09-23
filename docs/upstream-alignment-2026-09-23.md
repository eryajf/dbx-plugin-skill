# DBX 插件体系上游对齐记录（2026-09-23）

本次核对基线：

- `t8y2/dbx`：`01c3d6f51741c3a7aa0cdac225231947396c25ce`
- `t8y2/dbx-store`：`3a760b4753891e614fb08ee02e494133a7f21737`

快照由 `npm run upstream:sync` 获取，完整文件清单与 SHA-256 保存在未跟踪的 `tmp/upstream/report.json`。

## 对齐结果

| 范围 | 结论 | 证据与处理 |
| --- | --- | --- |
| Host API 主题负载 | 新增支持 | `t8y2/dbx/docs/content/docs/plugin-development.cn.mdx` 在 `主题负载携带什么` 中定义 `theme.editor.fontFamily`、`fontSize`、`theme` 和环境更新行为；已补到 `skill/references/host-api.md` 的“主题负载中的编辑器设置”。 |
| UI 动态导入与代码分割 | 新增支持 | 同一上游文档的“懒加载与代码分割”说明入口内联、相对资源地址、`dbx-plugin://` / WebView2 映射及 `ui.root` 限制；已补到 `skill/references/host-api.md` 的“动态导入与代码分割”。 |
| Manifest 与 Marketplace Schema | 仍有效 | 当前 Schema SHA-256 与 `.github/upstream-baseline.json` 一致；Host API 1.2、storage、AI 权限均已在 `skill/SKILL.md`、`skill/references/manifest.md` 和 `skill/references/host-api.md` 覆盖。 |
| CLI、Packager、Dev Host、Rust/Go SDK 与发布模板 | 仍有效 | 核对 `plugins/sdk/{cli,packager,dev-host,rust,go}`、模板和 `plugins/RELEASING.md`；Node.js 22+、四种模板、未签名候选、artifact metadata、平台构建、诊断 API 与 reusable workflow pin 规则均已覆盖。 |
| Store 候选格式与校验 | 仍有效 | 核对 `dbx-store/CONTRIBUTING.md`、`schemas/`、`scripts/`、`.github/workflows/`、README、PR 模板和签名配置；单 PR 候选流程、签名工作流回写/移除候选、R2 不可覆盖、字段白名单、publisher 所有权、localizations 与校验错误均已在 `skill/references/publishing.md` 描述。 |
| 其它 Manifest 字段、贡献点、Sidecar、包约束 | 仍有效 | 核对中英文插件开发文档、Manifest / Marketplace Schema、SDK 源码和完整 Store 快照；未发现需要调整的字段、权限、入口、Sidecar 协议、打包限制或候选身份校验规则。 |

本次没有改变 `tools/upstream-sources.json` 或漂移基线：两个 Schema 指纹与现有基线一致，CLI 版本也仍为 `0.1.9`。上游快照留在 `.gitignore` 管理的 `tmp/upstream/`，不提交源码副本。
