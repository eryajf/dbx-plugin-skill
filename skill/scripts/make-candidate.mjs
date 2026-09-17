#!/usr/bin/env node
/**
 * make-candidate.mjs — 从 dist/*.artifact.json 生成上架所需的两份 JSON（零依赖，Node.js 18+）
 *
 * 用法:
 *   node make-candidate.mjs [项目目录] [--dist DIR] [--out DIR] [--repo owner/name] [--tag TAG]
 *                           [--release-notes TEXT] [--json] [--quiet] [--no-verify]
 *
 * 产出:
 *   <out>/candidates/<plugin-id>.json    提交到 t8y2/dbx-store 的候选（targets[].url 为 HTTPS）
 *   <out>/release-candidates.json        插件 Release 的资产（artifacts[].url 为纯文件名）
 *
 * 关键规则（来自 dbx-store 脚本，写错必然被拒）:
 *   - release-candidates.json 的 artifacts[].url 必须是**纯 .dbxp 文件名**，不是 URL
 *   - 候选的 targets[].url 必须是 **HTTPS**
 *   - 候选不能含 signingKeyId / verified
 *   - sha256 / size 必须与未签名包的**确切字节**一致
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve, basename } from "node:path";

const ALLOWED_STORE_FIELDS = [
  "name",
  "description",
  "icon",
  "tags",
  "permissions",
  "source",
  "homepage",
  "license",
  "releaseNotes",
  "localizations",
];

const CANDIDATE_FIELDS = [
  "schemaVersion",
  "id",
  "publisher",
  "version",
  "name",
  "description",
  "icon",
  "tags",
  "permissions",
  "source",
  "homepage",
  "license",
  "releaseNotes",
  "localizations",
  "targets",
];

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;
const TARGET = /^[a-z0-9-]{1,64}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_SIZE = 512 * 1024 * 1024;

const errors = [];
const warnings = [];
let jsonMode = false;
let quiet = false;

const error = (m, hint) => errors.push(hint ? `${m}\n        → ${hint}` : m);
const warn = (m, hint) => warnings.push(hint ? `${m}\n        → ${hint}` : m);
function note(message) {
  if (!jsonMode && !quiet) process.stdout.write(`${message}\n`);
}

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function parseArgs(args) {
  const options = {
    project: ".",
    dist: null,
    out: null,
    repo: null,
    tag: null,
    releaseNotes: null,
    verify: true,
  };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const take = () => {
      i += 1;
      const value = args[i];
      if (value === undefined) {
        process.stderr.write(`${arg} 需要一个值\n`);
        process.exit(2);
      }
      return value;
    };
    if (arg === "--dist") options.dist = take();
    else if (arg === "--out") options.out = take();
    else if (arg === "--repo") options.repo = take();
    else if (arg === "--tag") options.tag = take();
    else if (arg === "--release-notes") options.releaseNotes = take();
    else if (arg === "--json") jsonMode = true;
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--no-verify") options.verify = false;
    else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "用法: node make-candidate.mjs [项目目录] [--dist DIR] [--out DIR] [--repo owner/name] [--tag TAG]\n" +
          "                              [--release-notes TEXT] [--json] [--quiet] [--no-verify]\n\n" +
          "从 dist/*.artifact.json 生成 candidates/<id>.json 与 release-candidates.json，\n" +
          "并复核每个 .dbxp 的 sha256/size 与 artifact.json 是否一致。\n",
      );
      process.exit(0);
    } else if (arg.startsWith("-")) {
      process.stderr.write(`未知选项: ${arg}\n`);
      process.exit(2);
    } else positional.push(arg);
  }
  if (positional.length) options.project = positional[0];
  return options;
}

function detectFromGit(project) {
  const run = (args) => {
    try {
      return execFileSync("git", args, { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  let repo = null;
  const remote = run(["remote", "get-url", "origin"]);
  if (remote) {
    const https = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
    const ssh = /^[^@]+@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
    const match = https ?? ssh;
    if (match) repo = `${match[1]}/${match[2]}`;
  }
  const tag = run(["describe", "--tags", "--exact-match"]) ?? run(["tag", "--points-at", "HEAD"])?.split("\n")[0] ?? null;
  return { repo, tag: tag || null };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const project = resolve(options.project);
  if (!existsSync(project)) {
    process.stderr.write(`项目目录不存在: ${project}\n`);
    process.exit(2);
  }

  const manifestPath = join(project, "manifest.json");
  if (!existsSync(manifestPath)) {
    process.stderr.write(`缺少 manifest.json: ${manifestPath}\n`);
    process.exit(2);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    process.stderr.write(`manifest.json 解析失败: ${err.message}\n`);
    process.exit(2);
  }

  const id = manifest.id;
  const version = manifest.version;
  const publisher = manifest.publisher;
  if (typeof id !== "string" || !IDENTIFIER.test(id)) error(`manifest.id 非法: ${JSON.stringify(id)}`);
  if (typeof version !== "string" || !SEMVER.test(version)) error(`manifest.version 非法: ${JSON.stringify(version)}`);
  if (typeof publisher !== "string" || !IDENTIFIER.test(publisher)) {
    error(`manifest.publisher 非法（商店要求小写标识符）: ${JSON.stringify(publisher)}`);
  }

  const distDir = resolve(options.dist ? options.dist : join(project, "dist"));
  const outDir = resolve(options.out ? options.out : distDir);

  if (!existsSync(distDir)) {
    process.stderr.write(`未找到构建输出目录: ${distDir}\n请先运行: dbx-plugin package .\n`);
    process.exit(2);
  }

  // .dbx-store.json（可选，展示字段）
  const storePath = join(project, ".dbx-store.json");
  let storeFields = {};
  if (existsSync(storePath)) {
    try {
      const raw = JSON.parse(readFileSync(storePath, "utf8"));
      if (!isPlainObject(raw)) {
        error(".dbx-store.json 顶层必须是对象");
      } else {
        const unknown = Object.keys(raw).filter((k) => !ALLOWED_STORE_FIELDS.includes(k));
        if (unknown.length) error(`.dbx-store.json 含白名单外字段: ${unknown.join(", ")}（商店会报 Unsupported store metadata field）`);
        storeFields = Object.fromEntries(Object.entries(raw).filter(([k]) => ALLOWED_STORE_FIELDS.includes(k)));
        for (const [key, value] of Object.entries(storeFields)) {
          if (typeof value === "string" && value === "") {
            error(`.dbx-store.json 的 "${key}" 是空字符串（商店会报 must be a non-empty string when provided）`);
          }
        }
      }
    } catch (err) {
      error(`.dbx-store.json 解析失败: ${err.message}`);
    }
  } else {
    warn(`未找到 .dbx-store.json（首次上架需要 name 与 license）`);
  }

  // 收集 artifact.json
  const artifactFiles = readdirSync(distDir)
    .filter((name) => name.endsWith(".artifact.json"))
    .sort();
  if (artifactFiles.length === 0) {
    process.stderr.write(`未在 ${distDir} 找到 *.artifact.json\n请先运行: dbx-plugin package .\n`);
    process.exit(2);
  }

  const git = detectFromGit(project);
  const repo = options.repo ?? git.repo;
  const tag = options.tag ?? git.tag;
  if (!repo) warn("未指定 --repo 且无法从 git remote 推断；候选 targets[].url 可能无法生成 HTTPS 地址");
  if (!tag) warn("未指定 --tag 且无法从 git tag 推断；候选 targets[].url 可能无法生成 HTTPS 地址");

  const targets = [];
  const releaseArtifacts = [];
  const seenTargets = new Set();

  for (const artifactFile of artifactFiles) {
    const artifactPath = join(distDir, artifactFile);
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    } catch (err) {
      error(`${artifactFile} 解析失败: ${err.message}`);
      continue;
    }
    const at = artifactFile;
    if (!isPlainObject(artifact)) {
      error(`${at} 顶层必须是对象`);
      continue;
    }
    if (artifact.signingKeyId !== undefined) {
      error(`${at} 含 signingKeyId —— 候选包必须未签名，不能携带 signingKeyId`);
    }

    const target = artifact.target;
    if (typeof target !== "string" || !TARGET.test(target)) {
      error(`${at} 的 target 非法: ${JSON.stringify(target)}（只允许 [a-z0-9-]，长度 ≤64）`);
      continue;
    }
    if (seenTargets.has(target)) error(`${at} 的 target 重复: ${target}`);
    seenTargets.add(target);

    if (typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)) {
      error(`${at} 的 sha256 非法: ${JSON.stringify(artifact.sha256)}`);
      continue;
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > MAX_SIZE) {
      error(`${at} 的 size 非法: ${JSON.stringify(artifact.size)}（要求 1 … 512 MiB 的安全整数）`);
      continue;
    }

    const expectedName = `${id}-${version}-${target}.dbxp`;
    const packagePath = join(distDir, expectedName);
    if (!existsSync(packagePath)) {
      error(`缺少包文件 ${expectedName}（${at} 指向该 target）`);
      continue;
    }

    if (options.verify) {
      const actualHash = sha256File(packagePath);
      const actualSize = statSync(packagePath).size;
      if (actualHash !== artifact.sha256.toLowerCase()) {
        error(`${expectedName} 的 SHA-256 与 ${at} 不一致：artifact=${artifact.sha256} 实际=${actualHash}`);
      }
      if (actualSize !== artifact.size) {
        error(`${expectedName} 的 size 与 ${at} 不一致：artifact=${artifact.size} 实际=${actualSize}`);
      }
    }

    // 候选 URL 必须是 HTTPS
    let candidateUrl = null;
    const rawUrl = typeof artifact.url === "string" ? artifact.url : expectedName;
    if (/^https:\/\//i.test(rawUrl)) candidateUrl = rawUrl;
    else if (/^http:\/\//i.test(rawUrl)) error(`${at} 的 url 是 http，商店要求 HTTPS`);
    else if (repo && tag) candidateUrl = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${rawUrl}`;
    else candidateUrl = rawUrl;

    targets.push({
      target,
      url: candidateUrl,
      sha256: artifact.sha256.toLowerCase(),
      size: artifact.size,
    });
    releaseArtifacts.push({
      target,
      url: rawUrl.startsWith("http") ? basename(new URL(rawUrl).pathname) : rawUrl,
      sha256: artifact.sha256.toLowerCase(),
      size: artifact.size,
    });
  }

  if (targets.length === 0) {
    error("没有收集到任何有效 target");
  }

  // 组装候选
  const candidate = {
    schemaVersion: 1,
    id,
    publisher,
    version,
    ...storeFields,
    targets,
  };
  if (options.releaseNotes !== null) candidate.releaseNotes = options.releaseNotes;
  else if (candidate.releaseNotes === undefined && storeFields.releaseNotes === undefined) {
    warn("候选没有 releaseNotes（商店目录的版本说明来自这里，不是 GitHub Release 正文）");
  }

  const unknownCandidate = Object.keys(candidate).filter((k) => !CANDIDATE_FIELDS.includes(k));
  if (unknownCandidate.length) error(`候选含未知字段: ${unknownCandidate.join(", ")}`);
  if (candidate.name === undefined) warn("候选缺少 name —— 首次上架时商店要求非空 name");
  if (candidate.license === undefined) warn("候选缺少 license —— 首次上架时商店要求非空 license");
  if (candidate.source === undefined) warn("候选缺少 source —— 首次上架时商店要求 https:// 的 source");
  if (candidate.source !== undefined && !/^https:\/\//.test(String(candidate.source))) {
    error(`候选 source 必须是 https://（当前 ${JSON.stringify(candidate.source)}）`);
  }
  for (const key of ["description", "icon", "homepage", "name", "license"]) {
    if (candidate[key] !== undefined && (typeof candidate[key] !== "string" || candidate[key] === "")) {
      error(`候选的 "${key}" 存在但为空（商店会拒绝）`);
    }
  }
  if (candidate.homepage !== undefined && !/^https?:\/\//.test(String(candidate.homepage))) {
    error(`候选 homepage 必须是 http(s)://（当前 ${JSON.stringify(candidate.homepage)}）`);
  }
  // .dbx-store.json 允许相对 icon；同步脚本会把它改写成该 tag 下的 raw.githubusercontent URL。
  // 手工提交的候选则必须是 http(s)，所以这里做同样的改写。
  if (candidate.icon !== undefined && !/^https?:\/\//.test(String(candidate.icon))) {
    const iconPath = String(candidate.icon).replace(/^\.\//, "");
    if (repo && tag) {
      candidate.icon = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(tag)}/${iconPath}`;
      note(`已将相对 icon 改写为: ${candidate.icon}`);
    } else {
      error(
        `候选 icon 必须是 http(s)://（当前 ${JSON.stringify(candidate.icon)}）`,
        "相对路径只对 .dbx-store.json 的自动同步路径有效；请提供 --repo/--tag 以便改写，或直接写绝对 HTTPS 地址。",
      );
    }
  }
  if (candidate.icon !== undefined && !/\.(svg|png)$/i.test(String(candidate.icon))) {
    error(`候选 icon 必须以 .svg 或 .png 结尾（商店只接受 SVG/PNG，当前 ${JSON.stringify(candidate.icon)}）`);
  }
  if (candidate.targets.some((t) => !/^https:\/\//.test(t.url))) {
    error("候选存在非 HTTPS 的 target url（商店要求 HTTPS，且不能指向 t8y2/dbx-store 的 Release）");
  }
  if (candidate.targets.some((t) => t.url.startsWith("https://github.com/t8y2/dbx-store/releases/"))) {
    error("候选 URL 指向了 DBX Store 的 Release —— 必须提交自己仓库的未签名包");
  }

  const releaseCandidates = {
    plugin: {
      id,
      publisher,
      version,
      ...(candidate.name !== undefined ? { name: candidate.name } : {}),
      ...(candidate.description !== undefined ? { description: candidate.description } : {}),
    },
    artifacts: releaseArtifacts,
  };
  for (const artifact of releaseCandidates.artifacts) {
    if (!/^[A-Za-z0-9._-]+\.dbxp$/.test(artifact.url)) {
      error(
        `release-candidates 的 artifacts[].url 必须是纯 .dbxp 文件名（当前 ${JSON.stringify(artifact.url)}）` +
          " —— 商店脚本用 basename + 正则校验后自行拼接 GitHub Release URL",
      );
    }
  }

  if (errors.length > 0) {
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify({ ok: false, errors, warnings }, null, 2)}\n`);
    } else {
      for (const message of errors) process.stderr.write(`[ERROR] ${message}\n`);
      for (const message of warnings) process.stderr.write(`[WARN ] ${message}\n`);
      process.stderr.write(`\n生成中止：${errors.length} 个错误。\n`);
    }
    process.exit(1);
  }

  const candidatesDir = join(outDir, "candidates");
  mkdirSync(candidatesDir, { recursive: true });
  const candidatePath = join(candidatesDir, `${id}.json`);
  const releasePath = join(outDir, "release-candidates.json");
  writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  writeFileSync(releasePath, `${JSON.stringify(releaseCandidates, null, 2)}\n`);

  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, candidatePath, releasePath, candidate, releaseCandidates, warnings }, null, 2)}\n`,
    );
  } else if (!quiet) {
    for (const message of warnings) process.stderr.write(`[WARN ] ${message}\n`);
    note(`\n已生成:`);
    note(`  候选（提交到 t8y2/dbx-store）: ${candidatePath}`);
    note(`  Release 资产（上传到 GitHub Release）: ${releasePath}`);
    note(`  targets: ${targets.map((t) => t.target).join(", ")}`);
    note(`\n下一步:`);
    note(`  1) 把 ${basename(releasePath)} 与各 .dbxp / .artifact.json 上传到同一个 GitHub Release`);
    note(`  2) 把 candidates/${id}.json 放到 dbx-store 的 PR 中（首次还需 publishers/${publisher}.json，且需先合并进 main）`);
  }

  process.exit(0);
}

main();
