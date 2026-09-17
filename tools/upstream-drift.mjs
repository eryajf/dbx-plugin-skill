#!/usr/bin/env node
/**
 * upstream-drift.mjs — 检测上游 DBX 契约是否变化（CI + 本地共用）
 *
 *   node tools/upstream-drift.mjs            # 人类可读报告；有漂移则 exit 1
 *   node tools/upstream-drift.mjs --json     # 机器可读
 *   node tools/upstream-drift.mjs --markdown # 适合作为 issue 正文
 *   node tools/upstream-drift.mjs --update   # 把当前上游状态写入基线
 *
 * 监控:
 *   - t8y2/dbx 的 plugins/manifest.schema.json（sha256 + 关键契约事实）
 *   - t8y2/dbx-store 的 schemas/plugin-candidate.schema.json（sha256 + 必填字段）
 *   - npm 上 @dbx-app/plugin-cli 的最新版本
 *
 * 用法约定：CI 检测到漂移时**只开 issue、不自动改基线**，
 * 由维护者更新 references/*.md 后运行 `npm run upstream:update` 重新基线化。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, ".github", "upstream-baseline.json");

const SOURCES = {
  manifestSchema: "https://raw.githubusercontent.com/t8y2/dbx/main/plugins/manifest.schema.json",
  candidateSchema: "https://raw.githubusercontent.com/t8y2/dbx-store/main/schemas/plugin-candidate.schema.json",
};
const CLI_PACKAGE = "@dbx-app/plugin-cli";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
  const text = await response.text();
  return { text, json: JSON.parse(text), sha256: createHash("sha256").update(text).digest("hex") };
}

async function fetchCliVersion() {
  const response = await fetch(`https://registry.npmjs.org/${CLI_PACKAGE.replace("/", "%2F")}/latest`, {
    signal: AbortSignal.timeout(20000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`npm registry 返回 HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload.version !== "string") throw new Error("npm registry 未返回 version");
  return payload.version;
}

/** 从 manifest schema 提取本 skill 依赖的关键契约事实 */
function manifestFacts(schema) {
  const properties = schema?.properties ?? {};
  const defs = schema?.$defs ?? {};
  const contributions = schema?.properties?.contributions?.items?.oneOf ?? [];

  const networkPermission = (properties.permissions?.items?.anyOf ?? [])
    .map((branch) => branch.pattern)
    .find(Boolean);
  const staticPermissions = (properties.permissions?.items?.anyOf ?? [])
    .map((branch) => branch.enum)
    .find(Boolean);

  return {
    topLevelFields: Object.keys(properties).sort(),
    requiredTopLevel: [...(schema.required ?? [])].sort(),
    staticPermissions: staticPermissions ? [...staticPermissions].sort() : null,
    networkPermissionPattern: networkPermission ?? null,
    fieldTypes: defs.formField?.properties?.type?.enum
      ? [...defs.formField.properties.type.enum].sort()
      : null,
    bindings: defs.formField?.properties?.binding?.enum ? [...defs.formField.properties.binding.enum].sort() : null,
    actionVariants: defs.connectionAction?.properties?.variant?.enum
      ? [...defs.connectionAction.properties.variant.enum].sort()
      : null,
    actionWhen: defs.connectionAction?.properties?.when?.enum
      ? [...defs.connectionAction.properties.when.enum].sort()
      : null,
    transports: defs.backendEntrypoint?.properties?.transport?.enum
      ? [...defs.backendEntrypoint.properties.transport.enum].sort()
      : null,
    contributionTypes: contributions
      .map((branch) => branch?.properties?.type?.const)
      .filter(Boolean)
      .sort(),
    filesystemCapabilities: defs.filesystemProviderContribution?.properties?.capabilities?.items?.enum
      ? [...defs.filesystemProviderContribution.properties.capabilities.items.enum].sort()
      : null,
  };
}

function candidateFacts(schema) {
  return {
    required: [...(schema.required ?? [])].sort(),
    topLevelFields: Object.keys(schema.properties ?? {}).sort(),
    additionalProperties: schema.additionalProperties ?? null,
    targetRequired: [...(schema.properties?.targets?.items?.required ?? [])].sort(),
    maxTargetsSize: schema.properties?.targets?.items?.properties?.size?.maximum ?? null,
  };
}

async function collect() {
  const [manifest, candidate, cliVersion] = await Promise.all([
    fetchJson(SOURCES.manifestSchema),
    fetchJson(SOURCES.candidateSchema),
    fetchCliVersion(),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    sources: {
      manifestSchema: {
        url: SOURCES.manifestSchema,
        sha256: manifest.sha256,
        facts: manifestFacts(manifest.json),
      },
      candidateSchema: {
        url: SOURCES.candidateSchema,
        sha256: candidate.sha256,
        facts: candidateFacts(candidate.json),
      },
      pluginCli: { package: CLI_PACKAGE, version: cliVersion },
    },
  };
}

/** 比较两个 facts 对象，返回可读的差异列表 */
function diffFacts(path, before, after, out) {
  if (before === after) return;
  const isArray = Array.isArray(before) && Array.isArray(after);
  if (isArray) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const added = after.filter((v) => !beforeSet.has(v));
    const removed = before.filter((v) => !afterSet.has(v));
    if (added.length) out.push(`${path}: 新增 ${added.join(", ")}`);
    if (removed.length) out.push(`${path}: 移除 ${removed.join(", ")}`);
    return;
  }
  if (before && after && typeof before === "object" && typeof after === "object") {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      diffFacts(`${path}.${key}`, before[key], after[key], out);
    }
    return;
  }
  out.push(`${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
}

function compare(baseline, current) {
  const drifts = [];
  for (const name of Object.keys(current.sources)) {
    const before = baseline?.sources?.[name];
    const after = current.sources[name];
    if (!before) {
      drifts.push({ source: name, kind: "new", detail: "基线中不存在，首次记录" });
      continue;
    }
    if (before.sha256 && after.sha256 && before.sha256 !== after.sha256) {
      drifts.push({ source: name, kind: "sha256", detail: `${before.sha256.slice(0, 12)}… → ${after.sha256.slice(0, 12)}…` });
    }
    if (before.version && after.version && before.version !== after.version) {
      drifts.push({ source: name, kind: "version", detail: `${before.version} → ${after.version}` });
    }
    const factDiffs = [];
    diffFacts(name, before.facts ?? {}, after.facts ?? {}, factDiffs);
    for (const detail of factDiffs) drifts.push({ source: name, kind: "facts", detail });
  }
  return drifts;
}

function renderHuman(current, drifts) {
  const lines = [];
  lines.push(`上游契约检查（${current.checkedAt}）`);
  lines.push(`  manifest schema : ${current.sources.manifestSchema.sha256.slice(0, 16)}…`);
  lines.push(`  candidate schema: ${current.sources.candidateSchema.sha256.slice(0, 16)}…`);
  lines.push(`  plugin CLI      : v${current.sources.pluginCli.version}`);
  lines.push("");
  if (drifts.length === 0) {
    lines.push("结论: 上游契约未变化。");
  } else {
    lines.push(`结论: 检测到 ${drifts.length} 处漂移，需要核对 references/*.md。`);
    for (const drift of drifts) lines.push(`  [${drift.source}] ${drift.detail}`);
    lines.push("");
    lines.push("处理后运行: npm run upstream:update");
  }
  return lines.join("\n");
}

function renderMarkdown(current, drifts) {
  const lines = [];
  lines.push("## 上游契约漂移");
  lines.push("");
  lines.push(`检查时间: \`${current.checkedAt}\``);
  lines.push("");
  lines.push("| 上游 | 当前指纹 |");
  lines.push("| --- | --- |");
  lines.push(`| \`t8y2/dbx\` manifest.schema.json | \`${current.sources.manifestSchema.sha256}\` |`);
  lines.push(`| \`t8y2/dbx-store\` plugin-candidate.schema.json | \`${current.sources.candidateSchema.sha256}\` |`);
  lines.push(`| npm \`${CLI_PACKAGE}\` | \`v${current.sources.pluginCli.version}\` |`);
  lines.push("");
  if (drifts.length === 0) {
    lines.push("未检测到变化。");
    return lines.join("\n");
  }
  lines.push("### 变化明细");
  lines.push("");
  for (const drift of drifts) lines.push(`- **${drift.source}** — ${drift.detail}`);
  lines.push("");
  lines.push("### 处理步骤");
  lines.push("");
  lines.push("1. 对照上游核对受影响的 `skill/references/*.md`（manifest / contributions / sidecar / publishing）。");
  lines.push("2. 必要时同步 `skill/scripts/check-project.mjs` 的校验规则与常量。");
  lines.push("3. 更新 `README.md` 与 `SKILL.md` 中引用的版本或事实。");
  lines.push("4. 递增 `package.json` 的 `version`，跑 `npm test`。");
  lines.push("5. 运行 `npm run upstream:update` 重新基线化，并提交 `.github/upstream-baseline.json`。");
  return lines.join("\n");
}

async function main() {
  let current;
  try {
    current = await collect();
  } catch (error) {
    process.stderr.write(`无法获取上游状态: ${error.message}\n`);
    process.exit(2);
  }

  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;

  if (flag("--update")) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    process.stdout.write(`已更新上游基线: ${baselinePath}\n`);
    process.stdout.write(renderHuman(current, []).split("\n").slice(0, 4).join("\n") + "\n");
    return;
  }

  const drifts = compare(baseline, current);

  if (flag("--json")) {
    process.stdout.write(`${JSON.stringify({ drifted: drifts.length > 0, driftCount: drifts.length, drifts, current }, null, 2)}\n`);
  } else if (flag("--markdown")) {
    process.stdout.write(`${renderMarkdown(current, drifts)}\n`);
  } else {
    process.stdout.write(`${renderHuman(current, drifts)}\n`);
  }

  process.exit(drifts.length > 0 ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`未预期的错误: ${error.stack ?? error.message}\n`);
  process.exit(2);
});
