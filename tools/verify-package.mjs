#!/usr/bin/env node
/**
 * verify-package.mjs — 校验 npm 打包内容（CI 与本地共用）
 *
 *   node tools/verify-package.mjs
 *
 * 检查:
 *   - 必需文件全部进入 tarball（skill 内容、bin、lib、README、LICENSE）
 *   - 不该发布的文件没有进入（test/、tools/、tmp/、node_modules、安装 marker）
 *   - package.json 的 bin / engines / license / repository / files 配置正确
 *   - 版本号与 tag（若提供 GITHUB_REF_NAME / --tag）一致
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "bin/dbx-plugin-skill.mjs",
  "lib/installer.mjs",
  "skill/SKILL.md",
  "skill/references/manifest.md",
  "skill/references/contributions.md",
  "skill/references/host-api.md",
  "skill/references/sidecar-protocol.md",
  "skill/references/cli.md",
  "skill/references/debugging.md",
  "skill/references/packaging.md",
  "skill/references/publishing.md",
  "skill/references/troubleshooting.md",
  "skill/scripts/check-project.mjs",
  "skill/scripts/inspect-dbxp.mjs",
  "skill/scripts/make-candidate.mjs",
  "skill/scripts/dev-logs.mjs",
];

const FORBIDDEN_PREFIXES = ["test/", "tools/", "tmp/", "node_modules/", ".github/", ".git/"];
const FORBIDDEN_NAMES = [".dbx-plugin-skill.json", ".DS_Store"];

const problems = [];
const problem = (message, hint) => problems.push(hint ? `${message}\n        → ${hint}` : message);

function packJson() {
  try {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(output);
  } catch (error) {
    if (error.code === "ENOENT") {
      process.stderr.write("未找到 npm，无法校验打包内容。请在装有 npm 的环境中运行。\n");
      process.exit(2);
    }
    const stderr = String(error.stderr ?? error.message);
    process.stderr.write(`npm pack 失败: ${stderr}\n`);
    if (/EPERM|EACCES/.test(stderr)) {
      process.stderr.write(
        "\n提示: npm 缓存目录不可写。在受限沙箱中可把缓存指向可写目录，例如\n" +
          "  npm_config_cache=/tmp/npm-cache node tools/verify-package.mjs\n",
      );
    }
    process.exit(2);
  }
}

const [entry] = packJson();
if (!entry) {
  process.stderr.write("npm pack --json 未返回任何条目\n");
  process.exit(2);
}

const files = new Set(entry.files.map((f) => f.path));
const totalSize = entry.files.reduce((sum, f) => sum + f.size, 0);
const referenceCount = entry.files.filter((f) => f.path.startsWith("skill/references/")).length;
const scriptCount = entry.files.filter((f) => f.path.startsWith("skill/scripts/")).length;

// 1. 必需文件
for (const required of REQUIRED) {
  if (!files.has(required)) problem(`缺少必需文件: ${required}`, "检查 package.json 的 files 字段。");
}

// 2. 不该发布的文件
for (const path of files) {
  const name = path.split("/").pop();
  if (FORBIDDEN_NAMES.includes(name)) {
    problem(`不应发布的文件进入了包: ${path}`, "安装 marker / 系统文件不应被打包。");
  }
  if (FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    problem(`不应发布的目录进入了包: ${path}`, "检查 package.json 的 files 字段。");
  }
}

// 3. 文件数量与完整性（防止 reference/script 漏发布）
const expectedReferences = REQUIRED.filter((p) => p.startsWith("skill/references/")).length;
const expectedScripts = REQUIRED.filter((p) => p.startsWith("skill/scripts/")).length;
if (referenceCount !== expectedReferences) {
  problem(`reference 数量不符: 打包 ${referenceCount}，期望 ${expectedReferences}`);
}
if (scriptCount !== expectedScripts) {
  problem(`脚本数量不符: 打包 ${scriptCount}，期望 ${expectedScripts}`);
}

// 4. package.json 元数据
if (entry.name !== pkg.name) problem(`包名不一致: pack=${entry.name} package.json=${pkg.name}`);
if (entry.version !== pkg.version) problem(`版本不一致: pack=${entry.version} package.json=${pkg.version}`);
if (!pkg.bin || pkg.bin["dbx-plugin-skill"] !== "bin/dbx-plugin-skill.mjs") {
  problem("package.json 的 bin 未正确指向 bin/dbx-plugin-skill.mjs");
}
if (!pkg.engines?.node) problem("package.json 缺少 engines.node");
if (!pkg.license) problem("package.json 缺少 license");
if (!pkg.repository?.url) problem("package.json 缺少 repository.url");
if (pkg.private === true) problem("package.json 设置了 private: true，无法发布到 npm");
if (pkg.publishConfig?.access && !["public", "restricted"].includes(pkg.publishConfig.access)) {
  problem(`publishConfig.access 非法: ${pkg.publishConfig.access}`);
}
if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
  problem("package.json 缺少 files 白名单（会发布意外文件）");
}

// 5. 版本与 tag 一致性
let tag = process.argv.includes("--tag")
  ? process.argv[process.argv.indexOf("--tag") + 1]
  : process.env.GITHUB_REF_NAME;
if (tag && tag.startsWith("v")) {
  const tagVersion = tag.slice(1);
  if (tagVersion !== pkg.version) {
    problem(`tag 版本与 package.json 不一致: tag=${tagVersion} package.json=${pkg.version}`, "请先同步版本号再打 tag。");
  }
}

// 报告
if (problems.length > 0) {
  process.stderr.write(`打包校验失败（${problems.length} 项）:\n`);
  for (const message of problems) process.stderr.write(`  ✘ ${message}\n`);
  process.exit(1);
}

process.stdout.write(
  `打包校验通过: ${entry.name}@${entry.version}\n` +
    `  文件 ${entry.files.length} 个（reference ${referenceCount} 篇 / 脚本 ${scriptCount} 个）\n` +
    `  压缩 ${(entry.size / 1024).toFixed(1)} KiB，解压 ${(totalSize / 1024).toFixed(1)} KiB\n`,
);
