# 发布与上架（dbx-store）参考

> 本文件的结论来自 `t8y2/dbx-store` 当前源码（`scripts/validate.mjs`、`scripts/sync-release-candidate.mjs`、`scripts/discover-plugin-releases.mjs`、`scripts/finalize-candidates.mjs`、`.github/workflows/*`）与 `t8y2/dbx/plugins/RELEASING.md`。**当文档与脚本冲突时，以脚本为准** —— 文末列出已确认的冲突点。
>
> 上游 `plugins/RELEASING.md` 仍描述「先开 Issue、再开 catalog PR」的两段式流程；**当前实际流程是「一个 PR」**，以 `dbx-store/CONTRIBUTING.md` 为准。

## 1. 四类产物，四个归属

| 产物 | 存放在哪 | 谁维护 |
| --- | --- | --- |
| 插件源码 | 你自己的仓库 | 你 |
| 未签名候选 `.dbxp` + `.artifact.json` + `release-candidates.json` | 你自己仓库的 GitHub Release / CDN / 对象存储 | 你的 CI（`dbx-plugin package`） |
| 最终签名 `.dbxp` + `.artifact.json` + `.signing-receipt.json` | DBX Store 控制的 R2（`https://dl.dbxio.com/plugins/...`） | DBX Store 受保护 Workflow |
| 目录元数据 `plugins/<id>.json`、`catalog/index.json` | `t8y2/dbx-store` Git 仓库 | 签名 Workflow 生成，维护者合并 |

**开发者永远不接触官方私钥。**

## 2. 提交位置速查

| 你要改的 | 提到哪 |
| --- | --- |
| 插件功能代码 | 你自己的仓库 |
| 上架 / 版本更新 / 商店文案 | `t8y2/dbx-store` → `main` |
| Host / SDK / CLI / Schema / 官方示例 / 插件文档 | `t8y2/dbx` → `main` |
| 第三方插件自身的 Bug | 那个插件的仓库 |

## 3. 插件仓库里的 `.dbx-store.json`（可选）

放在**插件源码仓库根目录**（路径由 `dbx-store/automation/plugin-sources.json` 的 `metadataPath` 配置，默认 `.dbx-store.json`）。它在**每个 Release tag** 上被读取，用于商店展示字段。

```json
{
  "name": "Example Files",
  "description": "Browse files from an example service.",
  "icon": "assets/plugin.svg",
  "tags": ["files", "storage"],
  "permissions": ["host.workbench"],
  "source": "https://github.com/example/dbx-plugin-files",
  "homepage": "https://github.com/example/dbx-plugin-files",
  "license": "Apache-2.0",
  "releaseNotes": "Initial release.",
  "localizations": {
    "zh-CN": { "name": "示例文件", "description": "浏览示例服务的文件。" }
  }
}
```

- **允许字段恰好是这 10 个**：`name`、`description`、`icon`、`tags`、`permissions`、`source`、`homepage`、`license`、`releaseNotes`、`localizations`。多任何键 → `Unsupported store metadata field '<k>'`。
- **首次上架必需**：`name` 和 `license`（否则 `New plugins require store metadata 'name'` / `'license'`）。
- `icon` 写相对路径时会被自动转成该 tag 下的 `raw.githubusercontent.com` HTTPS 地址；写绝对 URL 则原样使用。**必须是 `.svg` 或 `.png`**。
- `releaseNotes` 是**唯一**进入目录 `versions[].releaseNotes` 的来源 —— GitHub Release 的正文不会被读取。
- **身份与 target 不能从这里设置**：`id`、`publisher`、`version`、`targets`、`schemaVersion`、`verified`、`latestVersion`、`releasedAt` 及所有 artifact 字段都由别处决定。
- 版本更新时**不需要**改它；只在首次登记或确实要改展示信息时更新。但它每次同步都会被重新读取，所以改了就会带进下一次候选。

## 4. `release-candidates.json`（Release 资产）

由你的 Release 工作流产出，作为 **Release 资产**上传，文件名必须**恰好**是 `release-candidates.json`。

```json
{
  "plugin": {
    "id": "com.example.plugin",
    "publisher": "example",
    "version": "1.0.0",
    "name": "Example Plugin",
    "description": "Browse files from an example service."
  },
  "artifacts": [
    {
      "target": "darwin-arm64",
      "url": "com.example.plugin-1.0.0-darwin-arm64.dbxp",
      "sha256": "0f0e...（64 位十六进制，未签名候选包）",
      "size": 12345678
    }
  ]
}
```

**最关键的一条：`artifacts[].url` 必须是纯文件名，不是 URL。**

同步脚本用 `path.posix.basename` + 正则 `^[A-Za-z0-9._-]+\.dbxp$` 校验，然后**自己拼出**
`https://github.com/<你的仓库>/releases/download/<tag>/<文件名>`。

| `url` 写法 | 结果 |
| --- | --- |
| `a.dbxp` | ✅ |
| `a.dbxp?x=1` | ✅（query 被忽略） |
| `sub/a.dbxp` | ❌ `Invalid candidate artifact` |
| `https://github.com/.../a.dbxp` | ❌ 完整 URL 被拒 |
| `a.zip` | ❌ 必须以 `.dbxp` 结尾 |
| `a-1.2.3+build.dbxp` | ❌ `+` 不在允许字符集内 |

其他硬约束：

- `plugin.id` / `plugin.publisher` / `plugin.version` 必需；`artifacts` 非空。
- `target` 必须匹配 `^[a-z0-9-]{1,64}$` 且唯一。
- `sha256` 64 位十六进制；`size` 1 … 512 MiB。
- **`+build` 版本号会破坏自动化链路**（拼出的文件名含 `+`）—— 上架版本不要用 build metadata。

用随附脚本从 `dist/*.artifact.json` 生成，避免手写出错：

```bash
node <skill-root>/scripts/make-candidate.mjs . --release-notes "Initial release."
# 产出 dist/candidates/<id>.json 与 dist/release-candidates.json，并复核每个包的 sha256/size
```

## 5. 候选文件 `candidates/<plugin-id>.json`

这是提到 `dbx-store` 的 PR 内容。**允许的顶层键恰好 15 个**：

`schemaVersion`、`id`、`publisher`、`version`、`releaseNotes`、`name`、`description`、`icon`、`tags`、`permissions`、`source`、`homepage`、`license`、`localizations`、`targets`。

```json
{
  "schemaVersion": 1,
  "id": "com.example.plugin",
  "publisher": "example",
  "version": "1.0.0",
  "name": "Example Plugin",
  "description": "One-line description shown in the marketplace.",
  "icon": "https://example.com/icon.svg",
  "tags": ["files"],
  "permissions": ["host.events"],
  "source": "https://github.com/example/dbx-plugin/tree/v1.0.0",
  "homepage": "https://github.com/example/dbx-plugin",
  "license": "Apache-2.0",
  "releaseNotes": "Initial release.",
  "targets": [
    {
      "target": "darwin-arm64",
      "url": "https://github.com/example/dbx-plugin/releases/download/v1.0.0/com.example.plugin-1.0.0-darwin-arm64.dbxp",
      "sha256": "0f0e...64 位十六进制...",
      "size": 12345678
    }
  ]
}
```

| 字段 | 必需 | 约束 |
| --- | --- | --- |
| `schemaVersion` | 是 | 必须 `1` |
| `id` | 是 | `^[a-z0-9][a-z0-9._-]{0,127}$`；**文件名必须是 `<id>.json`** |
| `publisher` | 是 | 同 id 规则，且**必须在 `publishers/` 已登记**并拥有该插件 |
| `version` | 是 | SemVer；不能已列出，不能已撤销 |
| `name` | **新插件必需** | 非空 |
| `source` | **新插件必需** | 必须 `https://` |
| `license` | **新插件必需** | 非空 |
| `description` / `icon` / `homepage` / `tags` / `permissions` / `releaseNotes` / `localizations` | 否 | 出现时必须**非空**；`icon`/`homepage` 允许 http(s)；`tags`/`permissions` 为唯一非空字符串数组；`localizations` 每项只允许 `name`、`description` |
| `targets` | 是 | 非空数组 |

`targets[]` 每项**恰好 4 个键**：`target`（`^[a-z0-9-]{1,64}$`，唯一）、`url`（**HTTPS**）、`sha256`（64 位十六进制）、`size`（1 … 512 MiB）。

### 绝对不要放进候选

- `signingKeyId` —— 属于商店 artifact metadata，候选里出现会报 `contains unknown field(s): signingKeyId`。
- `verified` —— 候选里出现同样报未知字段。`verified` 由维护者决定，签名时硬编码为 `false`。
- **指向 `t8y2/dbx-store` Release 的 URL** → `candidate URLs must not reference DBX Store releases; submit the unsigned candidate artifact`。
- 任何非 HTTPS URL。

## 6. 发布者记录 `publishers/<publisher-id>.json`

**只在首次上架时需要**，且只允许 3 个字段：

```json
{ "id": "example", "name": "Example", "status": "unverified" }
```

- `id` 匹配 `^[a-z0-9][a-z0-9._-]{0,127}$`，文件名必须是 `<id>.json`，不可重复。
- `name` 非空；`status` 非空（实践中只用 `verified` / `unverified`）。
- **不含联系人/邮箱/URL 要求**，也不含任何密钥。
- `publisher` 字段引用的是记录的 **`id`**，不是 `name`。

> ⚠️ **实测坑（文档未提）**：签名 Workflow 会先把 base 分支的 `publishers/` 覆盖回 PR 分支，**PR 里新增的 `publishers/<新id>.json` 会被删除**，随后校验失败 `publisher '<id>' is not registered`。
> **实践做法**：新发布者记录必须先落到 `main`（单独提一个只加 publisher 的 PR 并合并，或请维护者登记），**再**在候选 PR 上运行 `/sign`。

## 7. 首次上架流程

1. 插件源码放在**公开可审阅**的仓库。
2. 每个支持的 target 构建未签名 `.dbxp`，发布到不可变 HTTPS 地址（Release / 对象存储 / CDN）。
3. Fork `t8y2/dbx-store`，向 `main` 提**一个** PR：
   - `publishers/<publisher-id>.json`（仅首次，**但要先合并到 main**，见 §6 的坑）；
   - `candidates/<plugin-id>.json`。
4. 按 PR 模板填写：插件 ID/版本/发布者、源码仓库 + 精确 tag、capabilities、**每一项 Manifest 权限**以及数据/网络访问、原生 Sidecar 行为（纯前端写 None）、license、主页/支持地址。
5. CI 会**故意保持红色**：`open candidate(s) awaiting DBX Store signing` —— 这是为了阻止未签名内容被合并。
6. 维护者审核后运行受保护签名 Workflow（PR 下评论 `/sign`，或手动 `workflow_dispatch` 指定 PR 号）。
7. Workflow 回写 `plugins/<id>.json`、重建的 `catalog/index.json` 并删除 `candidates/<id>.json`，同时把签名包发到 R2。
8. CI 转绿后由维护者合并。

## 8. 版本更新流程

1. 改代码 → **递增 `manifest.json` 的 `version`**（不要复用旧版本号）。
2. 打新源码 Tag、发新 Release；**旧 Release 资产不可覆盖**。
3. 若仓库已登记 `autoUpdate: true`，Store 的**每小时**同步 Workflow 会在最新 Release 中找到 `release-candidates.json`，自动创建/更新候选 PR：
   - 分支 `automation/plugin-release/<plugin-id>/<version>`
   - PR 标题 `feat(store): submit <plugin-id>@<version>`
   - 候选内容未变化时**不提交不推送**（幂等）
4. 未登记则手工提 `candidates/<plugin-id>.json`，**只写新版本**。
5. 审核 → `/sign` → 合并。

**省略的展示字段保持当前值，写了的字段会替换。** 新版本不需要动 `.dbx-store.json`。

## 9. 只改商店展示信息

更新 `.dbx-store.json` 并在**新 Release tag** 上发布 → 同步器读取该 tag 下的文件 → 带进下一次候选。

注意：同步是**由 Release 驱动**的，而且候选只有在签名后才最终生效。所以「只改文案」也要走一次 Release + 审核 + 签名。

## 10. 自动同步的登记与触发

`dbx-store/automation/plugin-sources.json`：

```json
{
  "version": 1,
  "plugins": [
    { "repository": "owner/repo", "metadataPath": ".dbx-store.json", "autoUpdate": true }
  ]
}
```

- 只有 `autoUpdate: true` 的条目会被处理（缺省即跳过）。
- `repository` 必须匹配 `^[^/]+/[A-Za-z0-9._-]+$`；`metadataPath` 不能含 `..`。
- 同步只在**最新**的（非 draft、非 prerelease）Release 中查找名为 `release-candidates.json` 的资产；找不到就静默跳过（`No published candidate release found for <repo>`）。只拉取最近 30 个 Release。
- 想让你的仓库加入自动同步，向 `dbx-store` 提一个登记 PR，或请维护者登记。**插件仓库不需要配置任何自动化 Secret。**

## 11. 审核与签名

### `/sign` 触发

- 在候选 PR 下评论 `/sign`（目前只有维护者账号 `t8y2` 可以触发；命令以 `issue_comment` 事件运行，用的是默认分支的 Workflow 定义，PR 无法篡改这道闸门）。

### 手动签名 Workflow 输入

`candidate-url`、`candidate-sha256`、`candidate-size`、`output-name`、`plugin-id`、`publisher`、`version`、`target`、`sdk-ref`。

- `output-name` 必须**恰好等于** `<plugin-id>-<version>-<target>.dbxp`。
- `sdk-ref` 决定用哪个 DBX 版本里的 packager 契约。

### 签名前会验证什么

1. 输入格式（HTTPS、64 位十六进制 sha256、size 范围、id/publisher/version/target/output-name 规则）。
2. 仓库密钥已登记、`status: "active"`、未撤销。
3. 下载候选包，重算 SHA-256 与 size，必须与审核值一致。
4. 包内**没有 `signature.json`**（`Official signing accepts only unsigned candidates`）。
5. 包内 `manifest.json` 的 `id`/`publisher`/`version` 与候选完全一致。

### 签名后产出

- `<id>-<version>-<target>.dbxp`（含 Ed25519 签名）
- `<id>-<version>-<target>.artifact.json`（含 `signingKeyId`）
- `<id>-<version>-<target>.signing-receipt.json`

发布路径（R2，全部**不可覆盖**）：

```
plugins/<plugin-id>/<version>/<id>-<version>-<target>.dbxp
plugins/<plugin-id>/<version>/<id>-<version>-<target>.artifact.json
plugins/<plugin-id>/<version>/<id>-<version>-<target>.signing-receipt.json
```

已存在同名对象 → `R2 object already exists and cannot be overwritten`。**改字节就必须升版本。**

## 12. 目录与密钥

生成后的 `plugins/<id>.json`（不要手工编辑）形如：

```json
{
  "id": "com.example.plugin",
  "name": "Example Plugin",
  "description": "...",
  "publisher": "example",
  "verified": false,
  "icon": "https://dl.dbxio.com/plugins/com.example.plugin/1.0.0/icon.svg",
  "tags": ["files"],
  "permissions": ["host.events"],
  "source": "https://github.com/example/dbx-plugin/tree/<commit>",
  "homepage": "https://github.com/example/dbx-plugin",
  "license": "Apache-2.0",
  "latestVersion": "1.0.0",
  "versions": [
    {
      "version": "1.0.0",
      "releasedAt": "2026-09-16T05:28:49.440Z",
      "releaseNotes": "Initial release.",
      "artifacts": [
        {
          "target": "darwin-arm64",
          "url": "https://dl.dbxio.com/plugins/com.example.plugin/1.0.0/com.example.plugin-1.0.0-darwin-arm64.dbxp",
          "sha256": "5e5c...",
          "signingKeyId": "dbx-store-release-2026",
          "size": 30810286
        }
      ]
    }
  ],
  "localizations": { "zh-CN": { "name": "示例插件", "description": "..." } }
}
```

- **没有 `$schema` 字段**，也没有 `releases[]` —— 结构是 `versions[]`（每版一项）→ `artifacts[]`（每 target 一项，恰好 5 个键）。
- `releasedAt` 由签名者设置；`latestVersion` 由签名流程按 semver 重算。
- **图标在目录里被硬编码重写为 `https://dl.dbxio.com/plugins/<id>/<latestVersion>/icon.<svg|png>`**，扩展名取自原图标，只接受 SVG/PNG。
- 目录消费地址：

```text
https://raw.githubusercontent.com/t8y2/dbx-store/main/catalog/index.json
```

### 签名密钥与撤销

- `signing-keys.json` 的 key 状态：`preview`（**目录里禁止使用**）、`active`、`retired`。`algorithm` 必须是 `ed25519`，`purpose` 必须是 `repository-package-signing`，`publicKey` 必须是 base64 的 32 字节。
- 自定义/私有仓库才用 `dbx-plugin keygen`；官方商店作者不需要。
- 轮换：**换新 Key ID**，先让支持的 DBX 版本信任新公钥，再停用旧 key。泄露的 key 记入 `revoked.json`，旧 ID 永不复用。
- `revoked.json` 可撤销插件版本（`{ "pluginId": "...", "version": "..." }`）或签名 key ID。

## 13. 提交 PR 中不能包含

- 插件源码目录、完整源码副本
- `.dbxp` 二进制（仓库校验器会拒绝**任何**位置的 `.dbxp`）
- Ed25519 私钥、Token、下载凭据
- `plugins/*.json` 或 `catalog/index.json` 的手工改动
- 把未签名候选 URL 当作最终下载地址
- 自行伪造 `verified: true`
- 工作区中任何 **> 1 MiB** 的文件（`validate.mjs` 会扫描整个工作树，包括未跟踪/被 gitignore 的文件）

## 14. 已确认的「文档 vs 脚本」冲突

| # | 文档说 | 脚本实际 |
| --- | --- | --- |
| 1 | `CONTRIBUTING.md` 说首次 PR 携带 `publishers/<id>.json` 即可 | 签名 overlay 会删除 PR 新增的 publisher 记录 → **必须先在 main 上登记** |
| 2 | `CONTRIBUTING.md` 说候选要「把 `verified` 保持 `false`」 | 候选**根本不能含** `verified` 字段 |
| 3 | 上游 `RELEASING.md` 描述「先开 Issue，再开 catalog PR」 | 当前流程是**一个 PR**，无 Issue |
| 4 | `README.md` 列的手动签名输入 | 实际还必需 `output-name`（且必须等于 `<id>-<version>-<target>.dbxp`）与 `sdk-ref` |
| 5 | 校验器描述 | 实际还检查 1 MiB 文件上限、preview key 禁用、publisher 归属、禁止 dbx-store Release URL、图标必须 SVG/PNG |
| 6 | 目录读取地址只写了 raw.githubusercontent | R2 上也发布了同一份 catalog，仓库未说明客户端实际读哪个 |

## 15. 校验错误对照

| 报错 | 原因 |
| --- | --- |
| `contains unknown field(s): X` | 多写了字段（候选/目标/插件/版本/artifact/本地化/publisher/密钥/撤销记录全部是严格键集） |
| `filename must match plugin id '<id>.json'` | 文件名与 `id` 不一致 |
| `publisher '<p>' is not registered` | publisher 记录不在 base 分支 |
| `publisher '<p>' does not own plugin '<id>'` | 该 publisher 不是现有插件的所有者 |
| `version '<v>' is already listed for plugin '<id>'` | 复用了已上架版本 |
| `plugin version '<id>@<v>' is revoked` | 该版本已被撤销 |
| `candidate URLs must use HTTPS` | 用了 http 或相对地址 |
| `candidate URLs must not reference DBX Store releases; submit the unsigned candidate artifact` | 指向了已签名的官方产物 |
| `name is required for a new plugin listing` / `license is required ...` | 新插件缺 `name`/`license` |
| `'<f>' must be a non-empty string when provided` | 字段存在但为空字符串 |
| `invalid target '<t>'` | target 含大写/下划线等非法字符 |
| `duplicate target '<t>'` | 同一版本重复 target |
| `invalid SHA-256 for target '<t>'` | 不是 64 位十六进制 |
| `invalid size for target '<t>'` | 不是 1 … 512 MiB 的安全整数 |
| `Candidate SHA-256 mismatch: expected <e>, got <a>` | 写了哈希之后重新打包了 |
| `Candidate size mismatch: expected <e>, got <a>` | 同上 |
| `Official signing accepts only unsigned candidates` | 提交了已签名的包 |
| `Expected plugin <id>, got <x>` / publisher / version | 候选与包内 manifest 身份不一致 |
| `preview signing key '<k>' cannot publish catalog artifacts` | 目录引用了 preview key |
| `Binary plugin package must not be committed: <path>` | 仓库里有 `.dbxp` |
| `Repository file exceeds 1 MiB: <path>` | 工作树里有大文件（含未跟踪文件） |
| `Invalid candidate artifact '<v>'` | `release-candidates.json` 里的 `url` 不是纯 `.dbxp` 文件名 |
| `No published candidate release found for <repo>` | 最新 Release 里没有名为 `release-candidates.json` 的资产，或 Release 是 draft/prerelease |
| `Unsupported store metadata field '<k>'` | `.dbx-store.json` 写了不在白名单的键 |

## 16. 自检脚本

```bash
node <skill-root>/scripts/make-candidate.mjs . --release-notes "..."
node <skill-root>/scripts/inspect-dbxp.mjs dist/*.dbxp
```

`make-candidate.mjs` 会检测：`id`/`publisher`/`version` 一致性、target 合法性、`sha256`/`size` 与实际字节一致、文件名是否符合 `<id>-<version>-<target>.dbxp`、是否误含 `signingKeyId`，并生成候选与聚合 JSON。
