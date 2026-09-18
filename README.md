# dbx-plugin-skill

一个用于 **DBX 插件开发** 的 agent skill（技能包），覆盖从创建到上架官方商店的全链路：

**创建 → 开发 → 调试 → 打包 → 发布 Release → 提交 dbx-store 候选 PR → 审核签名**

技能名：`dbx-plugin`（安装到 `~/.dsh/skills`、`~/.claude/skills`、`~/.agents/skills`）。

---

## 快速安装

```bash
# 方式一：直接安装（推荐）
npx dbx-plugin-skill install

# 方式二：全局安装后使用
npm install --global dbx-plugin-skill
dbx-plugin-skill install
```

安装后**重启 agent 会话**（技能目录在会话启动时扫描），然后即可通过自然语言触发，例如：

> 帮我创建一个 DBX 插件，用 Svelte 模板，id 是 com.example.demo
> 我的 DBX 插件打包报错 `manifest UI entry ... is not covered by [package].include`，帮我看下
> 帮我把这个插件发布到 dbx-store，生成候选 JSON
> 检查一下这个 .dbxp 包里有没有不该发布的东西

### 安装选项

```bash
dbx-plugin-skill install [--target all|dsh,claude,agents] [--scope user|project] [--link] [--force]

dbx-plugin-skill status     # 查看各目标安装状态
dbx-plugin-skill doctor     # 环境自检（Node / dbx-plugin CLI / skill 安装 / 当前项目）
dbx-plugin-skill path       # 打印安装路径
dbx-plugin-skill uninstall  # 卸载（仅移除本安装器写入的内容）
```

| 选项 | 说明 |
| --- | --- |
| `--target` | 安装目标，默认 `all`：`dsh` = DeepSeek Harness，`claude` = Claude Code，`agents` = 共享 agents 目录 |
| `--scope` | `user`（默认，家目录）或 `project`（当前目录下的 `.dsh/skills`、`.claude/skills`、`.agents/skills`） |
| `--link` | 安装为符号链接，便于从源码仓库直接迭代（仅 user scope 下最有用） |
| `--force` | 覆盖非本安装器写入的同名目录 |

安装器会在目标目录写入 `.dbx-plugin-skill.json` 标记文件；卸载时据此判断归属，**不会误删手工安装的同名技能**。

---

## 前置依赖

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | ≥ 18（`dbx-plugin dev` 需 **≥ 22**） | 运行随附脚本与安装器 |
| `@dbx-app/plugin-cli` | 建议最新 | 创建/调试/打包插件 |

```bash
npm install --global @dbx-app/plugin-cli
dbx-plugin --help
```

> 检查版本：`dbx-plugin version`。若明显落后于 npm 上的最新版，建议 `npm install --global @dbx-app/plugin-cli@latest`。

---

## Skill 内容

```
skill/
├── SKILL.md                          # 入口：心智模型、路由表、标准工作流、硬性约束
├── references/
│   ├── manifest.md                   # Manifest v1 字段、权限、入口、国际化、打包期重写
│   ├── contributions.md              # 5 类贡献点、连接表单/binding、文件系统 RPC
│   ├── host-api.md                   # window.dbxPlugin、context 规则、主题、CSP、资源
│   ├── sidecar-protocol.md           # 协议 v1、JSONL/framed、Rust/Go SDK、错误码
│   ├── cli.md                        # create / dev / package / keygen 全参数与环境变量
│   ├── debugging.md                  # dev host、DBX_UI_BUILD_SUCCESS、诊断 API、能力边界
│   ├── packaging.md                  # dbx-plugin.toml、打包流程、.dbxp 结构、体积限制
│   ├── publishing.md                 # .dbx-store.json、候选 JSON、审核签名、校验规则
│   └── troubleshooting.md            # 报错原文 → 原因 → 修法 对照表
└── scripts/
    ├── check-project.mjs             # 打包前预检
    ├── inspect-dbxp.mjs              # 解包检查（含 ZIP 读取与 checksums 校验）
    ├── make-candidate.mjs            # 生成候选与 release-candidates.json
    └── dev-logs.mjs                  # 读取 dev host 脱敏日志
```

### 随附脚本

四个脚本都是**零依赖**的 Node 程序（只用内置模块），可直接运行：

```bash
# 1) 打包前预检：manifest / dbx-plugin.toml / include 覆盖 / 资源存在 / 前后端一致 / 权限语法
node skill/scripts/check-project.mjs [项目目录] [--json] [--quiet]

# 2) 解包检查 .dbxp：条目、manifest、checksums 逐条校验、签名状态、bin target 一致性
node skill/scripts/inspect-dbxp.mjs dist/my-plugin-0.1.0-universal.dbxp [--json] [--extract DIR] [--no-verify]

# 3) 生成上架 JSON，并复核每个包的 sha256/size
node skill/scripts/make-candidate.mjs [项目目录] [--repo owner/name] [--tag v1.0.0] [--release-notes "..."]

# 4) 读取 dev host 日志（自动沿用 nextAfter + instanceId 游标）
node skill/scripts/dev-logs.mjs --port 5190 [--level error] [--follow] [--json]
```

`check-project.mjs` 与 `make-candidate.mjs` 以退出码表达结果：`0` 通过，`1` 发现问题（错误详情在 stderr 或 `--json` 的 `findings` 里）。

安装 skill 后，agent 会自动在合适的时机调用这些脚本；你也可以手动跑。

---

## 开发本仓库

```bash
git clone https://github.com/eryajf/dbx-plugin-skill.git
cd dbx-plugin-skill
npm test                      # 运行 65 项端到端自检

# 以符号链接方式边改边用
node bin/dbx-plugin-skill.mjs install --link --target dsh
```

`npm test` 覆盖：skill 结构完整性（frontmatter / 引用完整性）、预检脚本的正反例、`.dbxp` 校验与篡改检测、候选生成与哈希复核、安装器完整生命周期（在临时 HOME 中进行，不触碰真实环境）。

常用脚本：

```bash
npm test                      # 端到端自检（CI 在 Node 18/20/22 上跑）
npm run verify:package        # 校验 npm 打包内容与元数据
npm run upstream:check        # 对比上游 DBX 契约是否变化
npm run upstream:update       # 更新后重新基线化
npm run upstream:sync         # 只同步清单中的上游文件/目录到 tmp/upstream
npm run upstream:report       # 查看最近一次稀疏快照的提交与文件哈希
```

---

## 仓库与仓库设置

仓库地址：<https://github.com/eryajf/dbx-plugin-skill>（公开仓库，`--provenance` 需要公开仓库才能生成可验证的来源证明）。

如果你要 fork 成自己的包发布，记得同步改 `package.json` 里的 `name`、`repository`、`homepage`、`bugs`，以及 `.github/workflows/release.yml` 里 Trusted Publisher 相关的注释。

仓库维护者需要在 GitHub **Settings** 里确认：

| 位置 | 建议 |
| --- | --- |
| Secrets and variables → Actions | 加 `NPM_TOKEN` —— 仅首次发布 npm 需要，之后切 Trusted Publishing 就可以删掉（见下） |
| Features → Issues | 保持开启（`upstream-drift.yml` 会开 issue 提醒） |
| Actions → General → Workflow permissions | **无需修改**。三个 workflow 都显式声明了自己的 `permissions:`（`contents: write` / `id-token: write` / `issues: write`），会覆盖仓库默认值。只有当组织策略禁止 workflow 申请写权限时才需要处理 |

> 排查提示：判断 `GITHUB_TOKEN` 的能力**不要**看 `GET /repos/{owner}/{repo}` 里的 `.permissions.push` —— 那个字段描述的是**用户角色**，对 app token 恒为 `false`，会造成误判。

---

## 自动化（GitHub Actions）

仓库内置三个 workflow：

| Workflow | 触发 | 作用 |
| --- | --- | --- |
| `ci.yml` | push `main` / PR / 手动 | 在 Node 18/20/22 上跑 `npm test`；单独 job 校验 npm 打包内容并产出 `dbx-plugin-<version>.zip` 构建产物 |
| `release.yml` | 打 `v*` tag / 手动（可 dry-run） | 校验 tag 与版本一致 → 跑测试 → 校验打包 → **发布 npm** → 创建 GitHub Release 并附带 `.tgz`、`.zip`、`SHA256SUMS.txt` |
| `upstream-drift.yml` | 每周一 02:00 UTC / 手动 | 抓取上游 `manifest.schema.json`、`plugin-candidate.schema.json` 指纹与 npm 上 `@dbx-app/plugin-cli` 版本，与基线对比；有变化就创建或更新一个 `upstream-drift` issue |

### 发一个新版本

```bash
npm version patch            # 或 minor / major：更新 package.json 并打 tag
git push --follow-tags       # 推送提交与 tag → 自动触发 release.yml
```

`release.yml` 会做四件事：**校验 tag 与 `package.json` 版本一致**（不一致直接失败）、跑测试、发布 npm、创建 Release。想先空跑一次可以手动触发并勾选 `dry-run`。

### npm 发布认证

> ⚠️ **2025 年 11 月起 npm 只支持 Granular Access Token，经典 / Automation token 已被移除。**
> 另外，**带 Bypass 2FA 的「直接发布」token 正在被废弃，2027 年 1 月起将无法再用它直接发布新版本**。
> 因此长期方案是 **Trusted Publishing（OIDC）**，token 只用于完成首次发布。

**第 1 步：首次发布（二选一）**

- **本地手动发布（最省事）**：`npm login && npm publish --access public`。交互式 2FA 能正常完成，不必建 token。
- **用 Granular Access Token**：npmjs.com → Access Tokens → Generate New Token → **Granular Access Token**，然后：
  - **勾选 `Bypass two-factor authentication (2FA)`** —— CI 里没有交互式 2FA，不勾选会在发布时卡在 2FA 校验上失败；
  - `Packages and scopes` → **`Read and write (publish and stage)`**；
  - `Select packages` → 首次发布只能选 **`All packages`**（包还不存在，下拉里选不到它）；发布成功后建议收窄到 `dbx-plugin-skill`；
  - `Organizations` → **`No access`**（组织权限只用于管理组织设置与成员，**与发布包无关**，给读写属于越权）；
  - `Expiration` → 记下到期日，到期后 CI 会直接认证失败。
  - 把 token 加到仓库 Secret `NPM_TOKEN`。

**第 2 步：切到 Trusted Publishing（推荐，长期方案）**

包首次发布后，在 npmjs.com 该包的 **Settings → Trusted Publisher** 添加：

| 字段 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `eryajf` |
| Repository | `dbx-plugin-skill` |
| Workflow filename | `release.yml`（只填文件名，必须与 `.github/workflows/` 下的文件同名） |
| Allowed actions | 勾选允许 **`npm publish`**（否则只能 `npm stage publish`） |

然后**从仓库删掉 `NPM_TOKEN`**，`release.yml` 会自动走 OIDC，不再有 token 过期问题。

要求：npm CLI ≥ 11.5.1 且 Node ≥ 22.14.0（`release.yml` 已 `npm install -g npm@latest`）。仅支持 GitHub 托管 runner，自建 runner 不支持。

`release.yml` 会先判断 `NPM_TOKEN` 是否存在：有就用 token，没有就走 OIDC —— 两种配置都能跑，可平滑迁移；发布失败时会额外打印常见原因提示。

### 上游漂移检查

skill 大量记录 DBX 的**契约细节**（字段枚举、权限语法、协议常量、商店校验规则）。上游一改，文档就可能过期。`upstream-drift.yml` 每周把这个契约的指纹与 `.github/upstream-baseline.json` 里的基线比对：

- **只开 issue，不自动改基线** —— 保证提醒不会被静默吞掉。
- 维护者按 issue 里的步骤核对并更新 `skill/references/*.md`，然后 `npm run upstream:update` 重新基线化并提交。
- 只有 sha256 变化、事实无差异时，通常只是上游排版变动，确认后直接重新基线化即可。

### 按需引用上游源码

需要逐项核对实现、文档或 Workflow 时运行 `npm run upstream:sync`。它对 `t8y2/dbx` 使用
Git partial clone + sparse checkout，只下载 `tools/upstream-sources.json` 中列出的 schema、
插件开发文档和 SDK 子目录；`t8y2/dbx-store` 则使用 depth=1 全量浅克隆。内容保存到本地
`tmp/upstream/`，不会进入提交或 npm 包。重复执行只 fetch 两个仓库的最新 `main`，并生成带
commit 与 SHA-256 的快照报告。

```bash
npm run upstream:sync
npm run upstream:report
# 在 tmp/upstream/dbx 与 tmp/upstream/dbx-store 中核对后更新 skill/references/*.md
npm test
npm run upstream:update
```

需要扩大或缩小同步范围时，只修改 `tools/upstream-sources.json`，无需复制上游源码。

---

## 更新已安装的 skill

```bash
dbx-plugin-skill doctor      # 会对比 npm 上的最新版本并给出升级提示
npm install --global dbx-plugin-skill@latest && dbx-plugin-skill install
```

`install` 是幂等的：重新执行即覆盖为当前版本。想从源码跟随（不装 npm 包）就用 `--link`。

---

## 事实来源

本 skill 的内容对齐以下权威来源，并在文档中标注了「文档 vs 脚本」的已知冲突：

- 官方文档：<https://dbxio.com/cn/docs/plugin-development>
- 上游平台仓库 `t8y2/dbx`：`plugins/manifest.schema.json`、`plugins/README.md`（完整贡献点与协议）、`plugins/RELEASING.md`、`plugins/sdk/{cli,packager,dev-host,rust,go}`
- 官方商店仓库 `t8y2/dbx-store`：`CONTRIBUTING.md`、`schemas/plugin-candidate.schema.json`、`scripts/validate.mjs`、同步与签名 Workflow

> 插件上架 PR 提到 **`t8y2/dbx-store`**，不是 `t8y2/dbx`。普通插件源码留在你自己的仓库。

## 其他

- [dbx](https://github.com/t8y2/dbx)：官方仓库
- [dbx-store](https://github.com/t8y2/dbx-store)：应用商店仓库
- [awesome-dbx-plugins](https://github.com/eryajf/awesome-dbx-plugins)：🦄 汇集优秀的 DBX 开源插件
- [dbx-plugin-skill](https://github.com/eryajf/dbx-plugin-skill)：一个用于 DBX 插件开发 的 agent skill（技能包），覆盖从创建到上架官方商店的全链路