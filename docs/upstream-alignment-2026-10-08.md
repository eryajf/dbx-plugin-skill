# DBX 官方插件体系对齐记录（2026-10-08）

本次版本：`dbx-plugin-skill@0.1.17`。对照上次 2026-10-03 的记录，区分本次上游新增与既有遗漏修正，避免把所有补充内容都当作最近五天的新功能。

## 基线与范围

`npm run upstream:sync` / `npm run upstream:report` 成功，最终报告时间 `2026-10-08T12:18:57.189Z`：

- DBX：`504ef7e1c6f5156b792a5a63348ce95d5db58df0`（下文 D）；上次 `87b030d626dc4869fe1435cb20e33daa08e98d78`。
- dbx-store：`0458930a41274b69c9d55162722a2ffe36df77f1`（下文 S）；上次 `3fa752e75265b3cf7be0726ac51e588b11e738ec`。
- npm `@dbx-app/plugin-cli`：`0.1.9`，与既有基线相同。

上游路径均相对对应仓库根目录；本地快照位于 `tmp/upstream/dbx` 和 `tmp/upstream/dbx-store`。D 的固定版本链接可由 `https://github.com/t8y2/dbx/blob/504ef7e1c6f5156b792a5a63348ce95d5db58df0/<路径>` 构造；S 同理。

覆盖中文/英文 `docs/content/docs/plugin-development*.mdx`、`plugins/README.md`、`GETTING_STARTED.zh-CN.md`、Manifest/Marketplace Schema、CLI、Packager、Dev Host、Rust/Go SDK、`RELEASING.md`、`SIGNING.md`。本次扩展 `tools/upstream-sources.json`，纳入 Host 桥、浮动窗口、图形引擎、AI completion、媒体资源协议与 reusable workflow；避免仅靠 Schema 判断 Host API。

dbx-store 全量浅快照含 105 个文件，核对 README/CONTRIBUTING、schemas、scripts、全部 Workflow、发布者/插件/目录/撤销/公钥记录。与上次 Git 树比较，变化仅在已发布插件数据、catalog、新 publisher 和自动同步登记；候选 Schema、脚本和 Workflow 未改。重新核对发现旧 skill 对其中部分既有行为的说明仍然过时。

## 实质变化与证据

| 分类 | 核对项与结论 | 上游证据（commit + 路径/符号） | 本仓库处理 |
| --- | --- | --- | --- |
| 新增支持 | ready 后稳定读取贡献点 identity；context 可为空，不能靠一次性 init 事件路由 | D `docs/content/docs/plugin-development*.mdx`；`plugins/sdk/dev-host/browser-bridge.mjs`、`ui/messages.js`；`apps/desktop/src/lib/plugins/pluginHostBridge.ts` 的 contributionId getter/postInit | `skill/SKILL.md`、`host-api.md`、`contributions.md`、`debugging.md`、`cli.md` |
| 新增支持 | 桌面 floating open/close/drag/resize，surface=window；复用 workbench 权限、单 contribution 单窗口、位置持久化 | D `apps/desktop/src/lib/plugins/pluginFloatingWindow.ts`、`pluginHostBridge.ts` 的 host.openFloating；`components/plugins/PluginFloatingWindow.vue` | `SKILL.md`、`host-api.md`、`manifest.md`、`contributions.md`、`debugging.md`、`troubleshooting.md` |
| 新增支持 | closeWorkbench 通过 closeTab 消息关闭当前承载界面，无完成 Promise；fullscreen 委派 | D `pluginHostBridge.ts` 的 closeWorkbench；`apps/desktop/src/components/plugins/PluginWorkbenchHost.vue` iframe allow | `host-api.md`、`debugging.md`、`troubleshooting.md` |
| 新增支持 | WebGL 引擎可由用户按插件授权 unsafe-eval，默认关闭，不是新增 Manifest 权限 | D `apps/desktop/src/lib/plugins/pluginGraphicsEngine.ts`；`pluginHostBridge.ts` 的 allowUnsafeEval；`PluginWorkbenchHost.vue` 的 graphicsEngineEnabled | `host-api.md`、`manifest.md`、`debugging.md`、`troubleshooting.md` |
| 新增支持 / 已过时 | result-view context 增加 schema；旧 skill 错称必须打开另一个 workbench | D `plugins/README.md` result-view；中英文开发文档贡献点身份说明 | `contributions.md` |
| 已过时 | 资源加载不能概括成只能内联/readAssetUrl；样式表内联后 disabled 需重设 | D 中英文开发文档“内联后的样式表”；`pluginHostBridge.ts` sandbox options；`src-tauri/src/plugin_ui_protocol.rs` | `host-api.md` |
| 已过时（补齐既有遗漏） | AI 流式生成、按 requestId 取消、task 预置、会话记住确认；clipboard 图片和会话门控；queryData 并发上限 4 | D `pluginHostBridge.ts` 的 host.ai.generateTextStream / host.clipboardReadImage / host.queryData；`apps/desktop/src/lib/plugins/pluginAiCompletion.ts` | `host-api.md`、`manifest.md`、`debugging.md` |
| 已过时（补齐既有遗漏） | stream 事件封装为 ReadableStream；media URL 支持 HEAD/GET/Range，后端固定 filesystem/media/read | D `pluginHostBridge.ts` stream/media；`src-tauri/src/commands/plugin_media.rs`；`src-tauri/src/plugin_ui_protocol.rs` 的 PluginMediaChunk/serve_plugin_media | `host-api.md`、`sidecar-protocol.md`、`debugging.md` |
| 新增约束 | storage key 禁止空值与控制字符，上限仍是 256 字符 | D `pluginHostBridge.ts` 的 requireStorageKey，与上次源码比较 | `host-api.md` |
| 已过时 | 同仓库同 Release 的完整 HTTPS GitHub artifact URL 可被自动同步接受；生成器仍统一输出文件名 | S `scripts/sync-release-candidate.mjs:134` releaseAssetUrl | `publishing.md`、`troubleshooting.md`、`skill/scripts/make-candidate.mjs` 注释与提示 |
| 已过时 | 非空 release.plugin.permissions 优先于 .dbx-store.json；空列表仍回退 | S `scripts/sync-release-candidate.mjs:63`；`scripts/sign-candidates.mjs` 权限一致性 | `make-candidate.mjs` 输出 Manifest 权限到 identity；`SKILL.md`、`publishing.md` 说明清空权限的双侧更新 |
| 已过时 | 首次候选 PR 可同时登记 publisher，签名 overlay 保留新增记录，base 已有记录优先 | S `.github/workflows/sign-plugin-pr.yml:87` | `publishing.md`、`troubleshooting.md`、`make-candidate.mjs` 后续步骤 |
| 已过时 | 正式签名版本不可覆盖，但显式允许的本地未签名开发包可同版本重装 | D 开发安装规则，与既有 `debugging.md` 对齐 | `SKILL.md`、`packaging.md` |
| 已过时（本仓库检测缺陷） | oneOf 使用 $ref，旧提取器得到空 contributionTypes | D `plugins/manifest.schema.json:49`；本仓库 `tools/upstream-drift.mjs` | 解析本地 $defs，基线恢复 8 类贡献点；新增 --snapshot 并校验 report SHA-256，npm 版本仍在线读取 |
| 仅文字变化 | dev-host 的等宽字体 fallback 增加中文字体；不改协议 | D `plugins/sdk/dev-host/ui/App.vue` themes | 沿用 theme token 接口，不固定字体名 |

## 每个 skill 文件的复核状态

下表路径以 `skill/` 为根。未列为修改的规则保持原状。

| 文件 | 状态与处理 |
| --- | --- |
| `SKILL.md` | 新增支持/已过时：入口路由、窗口、identity、权限发布及开发重装说明；现有身份/最小权限/签名边界仍有效 |
| `references/manifest.md` | 仍有效：顶层白名单、10 个固定权限、8 个网络 origin、8 类贡献点、入口与 localization；补充窗口无新权限、图片读取门控 |
| `references/contributions.md` | 仍有效：表单条件/picker、连接生命周期、proxy_route、命令/菜单/MCP、filesystem 规则；修正 result-view 并补充 window/identity |
| `references/host-api.md` | 新增支持/已过时：上述 Host API、资源和错误边界；JSON context、计划/表结构/只读查询权限仍有效 |
| `references/sidecar-protocol.md` | 仍有效：Protocol v1、JSONL/framed、初始化身份、尺寸限制、Rust/Go SDK；补充 stream/media 方法 |
| `references/cli.md` | 仍有效：create/dev/package/keygen、选项、环境变量、模板 pin；补充 main 与 npm 已发布运行时区别 |
| `references/debugging.md` | 新增支持：dev-host contributionId；仍有效：诊断游标、脱敏、DBX_UI_BUILD_SUCCESS、重载/连接语义；补充不模拟的桌面能力 |
| `references/packaging.md` | 仍有效：target、include、入口重写、checksums、限额、工作流；修正正式包与开发包重装边界 |
| `references/publishing.md` | 已过时：URL、权限优先级、publisher；仍有效：15 个候选键、身份/哈希/未签名校验、R2 不可覆盖、统一仓库签名 |
| `references/troubleshooting.md` | 已过时：publisher/URL 提示；新增窗口、全屏、图形引擎、identity 排错 |
| `scripts/check-project.mjs` | 仍有效：本次没有新增 Manifest 字段/权限/贡献点，不放宽校验 |
| `scripts/inspect-dbxp.mjs` | 仍有效：ZIP/条目/checksums/签名状态/target；本次无包格式变化 |
| `scripts/make-candidate.mjs` | 已过时：补齐 release.plugin.permissions，修正同 PR publisher 与 URL 提示；保留权限一致性拒绝 |
| `scripts/dev-logs.mjs` | 仍有效：diagnostics 的 nextAfter/instanceId/reset/truncated 协议不变 |

## 源码优先与需要人工确认的部分

- **已确认冲突**：D 中文/英文文档说浮动窗口内部无参 `floating.close()` 只关闭自己；桥实现会枚举本插件所有 workbench 并关闭全部对应窗口。skill 明确要求关闭当前界面用 `closeWorkbench()` 或显式 contributionId。
- **已确认冲突**：文档对浮动窗口 `executeCommand` 提及“成功但不可见”，实际 `PluginWorkbenchHost.vue` 不注入 handler，桥返回 `Host command execution is unavailable`；skill 以源码为准。
- **需要人工确认**：这些新 Host API 的最低正式 DBX 版本、main dev-host 变更是否进入 npm CLI 0.1.9，不能由未变的 CLI 版本或 Schema 推断。没有进行真实桌面端跨平台运行验收；要求 capability 检查和生产宿主复验，不猜版本下限。
- **需要人工确认**：clipboard 会话首次拒绝后，`requireClipboardRead` 没有再次拒绝缓存的 false，且授权等待的并发门控需上游进一步确认；本次不修改上游，不把声明权限/首次确认描述成完整隔离保证。skill 要求拒绝后停止自动重试。
- **仍有效的既有冲突取舍**：Go SDK 源码支持 framed，不能照抄开发文档“仅 JSONL”；商店单 PR 流程优先于 RELEASING.md 的旧 Issue 流程；最终发布位置以 Store R2 Workflow 为准。

## 验证与发布

- `npm run upstream:sync`、`npm run upstream:report`：成功，记录上述 D/S commit。
- `npm test`：79 项通过、0 失败；新增非空/空权限 identity、过时权限拒绝、Schema $ref、快照哈希/篡改回归覆盖。
- `npm run upstream:update -- --snapshot`：成功；两个 Schema 哈希与 CLI 0.1.9 均未变化，仅修复贡献点提取结果。
- `npm run upstream:check -- --snapshot`：通过，更新基线后无漂移。
- `npm run verify:package -- --tag v0.1.17`：通过，使用可写 npm cache；19 个发布文件、9 个 reference、4 个随附脚本，tag/版本一致。
- `git diff --check`：通过。

本次仅提交维护文档、skill、脚本、测试、同步清单、漂移基线与版本号；`tmp/upstream`、临时比较文件、构建产物和凭据不进入 Git/npm 包。推送 `v0.1.17` 标签触发现有 Release Action，由其发布 npm、创建 GitHub Release 并附带 tgz/zip/SHA256SUMS。
