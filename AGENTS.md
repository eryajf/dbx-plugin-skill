# dbx-plugin-skill 维护指南

本仓库维护一个面向 AI agent 的 DBX 插件开发 skill。skill 的事实来源主要是两个上游仓库：

- `https://github.com/t8y2/dbx`：DBX Host、插件开发文档、Manifest/Marketplace Schema、CLI、SDK、打包器和开发宿主。
- `https://github.com/t8y2/dbx-store`：插件商店候选格式、校验脚本、发布流程和 Workflow。

## 上游同步

不要把上游源码复制进本仓库，也不要把 `tmp/upstream` 下的内容提交。运行：

```bash
npm run upstream:sync
npm run upstream:report
```

同步工具是 `tools/upstream-sync.mjs`，范围由 `tools/upstream-sources.json` 控制：

- `t8y2/dbx` 使用 depth=1、blobless sparse checkout，只拉取插件开发文档、Schema、插件 SDK 相关目录和发布说明。
- `t8y2/dbx-store` 使用 depth=1 全量浅克隆。该仓库体积小，便于 AI 对照完整上下文。
- 两个快照均位于 `tmp/upstream/`，该目录已被 `.gitignore` 忽略。
- `tmp/upstream/report.json` 记录上游 commit、选取范围和文件 SHA-256。

如果上游目录移动或需要增加参考资料，只修改 `tools/upstream-sources.json`。DBX 的插件开发说明目前是：

```text
tmp/upstream/dbx/docs/content/docs/plugin-development.mdx
tmp/upstream/dbx/docs/content/docs/plugin-development.cn.mdx
```

## AI 对照流程

当用户要求“对齐最新上游”“检查 skill 是否过期”或修复 DBX 插件规则时：

1. 先运行 `npm run upstream:sync`，不要依据旧的 `tmp/upstream` 快照判断当前事实。
2. 用 `npm run upstream:report` 记录本次 commit；需要细查时阅读 `tmp/upstream/dbx` 和 `tmp/upstream/dbx-store`。
3. 将上游事实映射到 `skill/SKILL.md` 或对应的 `skill/references/*.md`；脚本校验逻辑位于 `skill/scripts/`。
4. 对身份字段、权限、入口、Sidecar 协议、打包约束、候选格式和签名流程分别核对，不要只看 Schema。
5. 上游内容与现有 skill 冲突时，以当前上游源码、Schema、校验脚本和官方文档为证据，并在文档中说明取舍。
6. 运行 `npm test`；若修改了上游漂移基线，再运行 `npm run upstream:update`。

## 官方对齐任务

当用户提出以下任一类请求时，将其视为一次完整的官方对齐任务，而不是只做 Schema 指纹检查：

```text
检查最近官方针对插件体系有哪些新的支持或者变化，并对齐当前 skill。
检查 DBX 插件官方更新，找出 skill 中过时和仍然有效的内容。
把当前 skill 和最新 dbx / dbx-store 全面对照一遍。
```

执行要求：

1. 运行 `npm run upstream:sync`，以本次同步得到的两个 commit 作为审查基线。
2. 阅读 `tmp/upstream/dbx/docs/content/docs/plugin-development*.mdx`，并检查 DBX 清单中的 Schema、CLI、SDK、dev-host、packager、发布说明和签名说明。
3. 阅读完整的 `tmp/upstream/dbx-store`，重点检查 `CONTRIBUTING.md`、`schemas/`、`scripts/`、Workflow 和 README。
4. 对照本仓库的 `skill/SKILL.md`、全部 `skill/references/*.md` 和 `skill/scripts/*.mjs`，逐条标记为“仍有效”“已过时”“新增支持”“需要人工确认”或“仅文字变化”。
5. 对“已过时”和“新增支持”直接修改 skill；涉及脚本行为的变化同时修改校验或生成脚本。不要只生成报告而留下已确认的过时内容。
6. 对每个实质变化保留上游文件路径、commit 和本仓库修改文件作为证据；不确定的行为标注为需要人工确认，不要猜测。
7. 运行 `npm test`、`npm run verify:package`，必要时运行 `npm run upstream:check`；最后汇报覆盖范围、变化清单、未变化部分和验证结果。

用户只需在仓库中说“检查最近官方插件体系变化并对齐 skill”，就应按以上流程执行。除非用户明确要求只检查，默认应完成文档和脚本更新。

## 本仓库验证

常用命令：

```bash
npm test
npm run verify:package
npm run upstream:check
```

不要把 `dist/`、`.dbx-dev/`、上游快照、凭据或签名私钥加入提交。修改 skill 文档时，保持 `skill/SKILL.md` 对所有 reference 和随附脚本的引用完整；新增 reference 必须同时加入入口路由。

## 输出要求

处理上游对齐任务时，在结果中说明：同步到的两个 commit、实际修改的 skill 文件、验证命令及结果。引用上游事实时给出具体文件路径，必要时附行号或关键字段，避免只给笼统结论。
