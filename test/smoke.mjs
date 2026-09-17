#!/usr/bin/env node
/**
 * smoke.mjs — 自检：脚本与安装器的端到端测试（零依赖）
 *
 *   npm test
 *   node test/smoke.mjs
 *
 * 覆盖:
 *   1. check-project 接受合法项目、拒绝各类非法写法
 *   2. inspect-dbxp 校验 checksums、识别未签名包、发现被篡改的包
 *   3. make-candidate 生成候选与 release-candidates，并复核 sha256/size
 *   4. 安装器 install / status / uninstall / 覆盖保护（在临时 HOME 中）
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = join(root, "skill", "scripts");
const bin = join(root, "bin", "dbx-plugin-skill.mjs");
const work = mkdtempSync(join(tmpdir(), "dbx-plugin-skill-smoke-"));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ✔ ${name}\n`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    process.stdout.write(`  ✘ ${name}${detail ? `\n      ${detail}` : ""}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    cwd: options.cwd ?? root,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// ------------------------------------------------------- 最小 ZIP 写入（stored 条目）

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** entries: [{ name, data: Buffer }] — 使用 stored（method 0），便于零依赖构造 .dbxp */
function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const crc = crc32(data);
    const mode = entry.executable ? 0o755 : 0o644;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(mode << 16, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

// ------------------------------------------------------- 夹具

function makeProject({ dir, id = "com.example.demo", version = "0.1.0", publisher = "example", backend = false }) {
  mkdirSync(join(dir, "ui"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "ui", "index.html"), "<!doctype html><title>demo</title>\n");
  writeFileSync(join(dir, "assets", "plugin.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');

  const manifest = {
    manifest_version: 1,
    id,
    name: "Demo",
    version,
    publisher,
    description: "A demo plugin.",
    icon: "assets/plugin.svg",
    engines: { host_api: "1" },
    entrypoints: { ui: { root: "ui", entry: "ui/index.html" } },
    contributions: [{ type: "workbench", id: `${id}.main`, label: "Demo" }],
  };
  if (backend) {
    manifest.permissions = ["host.binary"];
    manifest.entrypoints.backend = { transport: "stdio-framed", executable: "bin/darwin-arm64/dbx-plugin-demo" };
  }
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(dir, "dbx-plugin.toml"),
    `schema_version = 1\n\n[package]\ninclude = ["assets", "ui"]\n`,
  );
  return manifest;
}

function makePackage({ distDir, id, version, target, manifest, tamper = false }) {
  mkdirSync(distDir, { recursive: true });
  const manifestData = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const uiData = Buffer.from("<!doctype html><title>demo</title>\n", "utf8");
  const assetData = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n', "utf8");

  const payload = [
    { name: "manifest.json", data: manifestData },
    { name: "ui/index.html", data: uiData },
    { name: "assets/plugin.svg", data: assetData },
  ];
  const files = Object.fromEntries(payload.map((e) => [e.name, createHash("sha256").update(e.data).digest("hex")]));
  const checksums = Buffer.from(`${JSON.stringify({ algorithm: "sha256", files }, null, 2)}\n`, "utf8");

  const entries = [...payload];
  if (tamper) {
    // 先写入 checksums，再篡改 ui/index.html 让校验失败
    entries.push({ name: "checksums.json", data: checksums });
    entries[1] = { name: "ui/index.html", data: Buffer.from("TAMPERED CONTENT\n", "utf8") };
  } else {
    entries.push({ name: "checksums.json", data: checksums });
  }

  const fileName = `${id}-${version}-${target}.dbxp`;
  const packagePath = join(distDir, fileName);
  const buffer = makeZip(entries);
  writeFileSync(packagePath, buffer);
  writeFileSync(
    join(distDir, fileName.replace(/\.dbxp$/, ".artifact.json")),
    `${JSON.stringify(
      {
        target,
        url: fileName,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        size: buffer.length,
      },
      null,
      2,
    )}\n`,
  );
  return { packagePath, fileName, size: buffer.length };
}

// ------------------------------------------------------- 测试

section("0. skill 结构完整性");

{
  const skillDir = join(root, "skill");
  const skillFile = join(skillDir, "SKILL.md");
  check("SKILL.md 存在", existsSync(skillFile));
  const raw = readFileSync(skillFile, "utf8");

  // frontmatter（本 skill 只使用 name / description 两个纯量键）
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  check("SKILL.md 含 YAML frontmatter", match !== null);
  const frontmatter = match ? match[1] : "";
  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null;
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null;

  check("frontmatter name 为 dbx-plugin", name === "dbx-plugin", String(name));
  check("frontmatter name 是 kebab-case", name !== null && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name), String(name));
  check("frontmatter description 足够描述触发场景", description !== null && description.length >= 40, String(description?.length));
  check(
    "description 未包含会破坏 YAML 的 \": \"，也未跨行",
    description !== null && !description.includes(": ") && !description.includes("\n"),
  );

  // SKILL.md 引用的 reference 必须全部存在
  const referenced = new Set(
    [...raw.matchAll(/`references\/([a-z-]+\.md)`/g)].map((m) => m[1]),
  );
  const available = readdirSync(join(skillDir, "references")).filter((f) => f.endsWith(".md"));
  const missingRefs = [...referenced].filter((r) => !available.includes(r));
  check("SKILL.md 引用的 reference 全部存在", missingRefs.length === 0, missingRefs.join(", "));
  const orphanRefs = available.filter((r) => !referenced.has(r));
  check("没有未被 SKILL.md 引用的 reference", orphanRefs.length === 0, orphanRefs.join(", "));

  // SKILL.md 引用的脚本必须全部存在
  const referencedScripts = new Set(
    [...raw.matchAll(/<skill-root>\/scripts\/([a-z-]+\.mjs)/g)].map((m) => m[1]),
  );
  const availableScripts = readdirSync(join(skillDir, "scripts")).filter((f) => f.endsWith(".mjs"));
  const missingScripts = [...referencedScripts].filter((s) => !availableScripts.includes(s));
  check("SKILL.md 引用的脚本全部存在", missingScripts.length === 0, missingScripts.join(", "));
  check(
    "四个随附脚本都被 SKILL.md 提及",
    availableScripts.every((s) => referencedScripts.has(s)),
    availableScripts.filter((s) => !referencedScripts.has(s)).join(", "),
  );

  // reference 之间的交叉引用必须有效，且每篇都要有标题
  let brokenCross = [];
  for (const file of available) {
    const text = readFileSync(join(skillDir, "references", file), "utf8");
    if (!/^#\s+\S/m.test(text)) brokenCross.push(`${file} 缺少一级标题`);
    for (const m of text.matchAll(/`([a-z-]+\.md)`/g)) {
      if (!available.includes(m[1])) brokenCross.push(`${file} → ${m[1]}`);
    }
  }
  check("reference 交叉引用有效且均有标题", brokenCross.length === 0, brokenCross.join("; "));

  // 安装目标目录里不应残留 marker（--link 曾污染源码目录的回归防护）
  check("skill 源目录没有安装 marker 残留", !existsSync(join(skillDir, ".dbx-plugin-skill.json")));
}

section("1. check-project.mjs");

const goodDir = join(work, "good");
mkdirSync(goodDir, { recursive: true });
const goodManifest = makeProject({ dir: goodDir });
{
  const result = run([join(scripts, "check-project.mjs"), goodDir, "--quiet"]);
  check("合法项目通过预检", result.status === 0, `exit=${result.status}\n${result.stderr}`);
}
{
  const result = run([join(scripts, "check-project.mjs"), goodDir, "--json"]);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    /* 交给断言失败 */
  }
  check("--json 输出可解析的 JSON", parsed !== null && parsed.ok === true, result.stdout.slice(0, 200));
}

const badDir = join(work, "bad");
mkdirSync(join(badDir, "ui"), { recursive: true });
writeFileSync(join(badDir, "manifest.json"), `${JSON.stringify({
  manifest_version: 2,
  id: "Bad_ID",
  name: "",
  version: "1.0",
  publisher: "example",
  signingKeyId: "nope",
  engines: { host_api: "1" },
  permissions: ["host.network:http://evil.com"],
  entrypoints: { ui: { root: "ui", entry: "index.html" } },
}, null, 2)}\n`);
writeFileSync(join(badDir, "dbx-plugin.toml"), `schema_version = 1\n\n[package]\ninclude = ["ui", ".dbx-dev"]\n`);
{
  const result = run([join(scripts, "check-project.mjs"), badDir, "--json"]);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    /* 交给断言失败 */
  }
  const messages = (parsed?.findings ?? []).map((f) => f.message).join("\n");
  check("非法项目被判失败", result.status === 1, `exit=${result.status}`);
  check("检出未知顶层字段 signingKeyId", messages.includes("signingKeyId"));
  check("检出 manifest_version 错误", messages.includes("manifest_version"));
  check("检出非法 id", messages.includes("id 非法"));
  check("检出 ui.entry 不在 root 内", messages.includes("不在 root"));
  check("检出非 HTTPS 网络权限", messages.includes("host.network:http://evil.com"));
  check("检出 include 中的 .dbx-dev", messages.includes(".dbx-dev"));
}

const missingEntryDir = join(work, "missing-entry");
mkdirSync(join(missingEntryDir, "ui"), { recursive: true });
makeProject({ dir: missingEntryDir });
rmSync(join(missingEntryDir, "ui", "index.html"));
{
  const result = run([join(scripts, "check-project.mjs"), missingEntryDir, "--json"]);
  const parsed = JSON.parse(result.stdout);
  const messages = parsed.findings.map((f) => f.message).join("\n");
  check("检出 UI 入口文件缺失", result.status === 1 && messages.includes("在项目中不存在"), messages);
}

section("2. inspect-dbxp.mjs");

const distDir = join(work, "dist");
const pkg = makePackage({
  distDir,
  id: goodManifest.id,
  version: goodManifest.version,
  target: "universal",
  manifest: goodManifest,
});
{
  const result = run([join(scripts, "inspect-dbxp.mjs"), pkg.packagePath, "--json"]);
  const parsed = JSON.parse(result.stdout);
  check("合法 .dbxp 检查通过", result.status === 0, `exit=${result.status} ${result.stdout.slice(0, 300)}`);
  check("解析出 id/version/target", parsed.parsedName?.id === "com.example.demo" && parsed.parsedName?.target === "universal", JSON.stringify(parsed.parsedName));
  check("checksums 全部校验通过", parsed.verification.checked === 3 && parsed.verification.mismatched.length === 0, JSON.stringify(parsed.verification));
  check("识别为未签名包", parsed.signed === false);
  check("manifest 身份被读出", parsed.manifestId === "com.example.demo" && parsed.manifestVersion === "0.1.0");
}

const tampered = makePackage({
  distDir: join(work, "dist-tampered"),
  id: goodManifest.id,
  version: goodManifest.version,
  target: "universal",
  manifest: goodManifest,
  tamper: true,
});
{
  const result = run([join(scripts, "inspect-dbxp.mjs"), tampered.packagePath, "--json"]);
  const parsed = JSON.parse(result.stdout);
  const messages = parsed.problems.map((p) => p.message).join("\n");
  check("识别被篡改的包", result.status === 1, `exit=${result.status}`);
  check("报告 SHA-256 不匹配", messages.includes("SHA-256 不匹配"), messages);
}

{
  const notZip = join(work, "not-a-zip.dbxp");
  writeFileSync(notZip, "definitely not a zip");
  const result = run([join(scripts, "inspect-dbxp.mjs"), notZip]);
  check("非 ZIP 文件报错退出", result.status === 2, `exit=${result.status}`);
}

section("3. make-candidate.mjs");

const candidateProject = join(work, "candidate-project");
mkdirSync(candidateProject, { recursive: true });
const candidateManifest = makeProject({ dir: candidateProject });
makePackage({
  distDir: join(candidateProject, "dist"),
  id: candidateManifest.id,
  version: candidateManifest.version,
  target: "universal",
  manifest: candidateManifest,
});
writeFileSync(
  join(candidateProject, ".dbx-store.json"),
  `${JSON.stringify(
    {
      name: "Demo",
      description: "A demo plugin.",
      icon: "assets/plugin.svg",
      tags: ["demo"],
      permissions: [],
      source: "https://github.com/example/dbx-plugin-demo",
      homepage: "https://github.com/example/dbx-plugin-demo",
      license: "MIT",
      releaseNotes: "Initial release.",
    },
    null,
    2,
  )}\n`,
);
{
  const result = run([
    join(scripts, "make-candidate.mjs"),
    candidateProject,
    "--repo",
    "example/dbx-plugin-demo",
    "--tag",
    "v0.1.0",
    "--json",
  ]);
  check("生成候选成功", result.status === 0, `exit=${result.status}\n${result.stderr}`);
  const candidatePath = join(candidateProject, "dist", "candidates", "com.example.demo.json");
  const releasePath = join(candidateProject, "dist", "release-candidates.json");
  check("写出 candidates/<id>.json", existsSync(candidatePath));
  check("写出 release-candidates.json", existsSync(releasePath));

  if (existsSync(candidatePath) && existsSync(releasePath)) {
    const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
    const release = JSON.parse(readFileSync(releasePath, "utf8"));
    check("候选 target url 是 HTTPS", /^https:\/\//.test(candidate.targets[0].url), candidate.targets[0].url);
    check("候选不含 signingKeyId", candidate.signingKeyId === undefined);
    check("候选不含 verified", candidate.verified === undefined);
    check("相对 icon 被改写为 HTTPS", /^https:\/\/raw\.githubusercontent\.com\//.test(candidate.icon), candidate.icon);
    check(
      "release-candidates 的 url 是纯文件名",
      /^[A-Za-z0-9._-]+\.dbxp$/.test(release.artifacts[0].url),
      release.artifacts[0].url,
    );
    check(
      "sha256/size 与包一致",
      release.artifacts[0].size === pkg.size && /^[a-f0-9]{64}$/.test(release.artifacts[0].sha256),
      JSON.stringify(release.artifacts[0]),
    );
  }
}

{
  // 篡改 artifact.json 的 sha256，应该被拒绝
  const artifactPath = join(candidateProject, "dist", "com.example.demo-0.1.0-universal.artifact.json");
  const original = readFileSync(artifactPath, "utf8");
  const tamperedArtifact = JSON.parse(original);
  tamperedArtifact.sha256 = "0".repeat(64);
  writeFileSync(artifactPath, `${JSON.stringify(tamperedArtifact, null, 2)}\n`);
  const result = run([
    join(scripts, "make-candidate.mjs"),
    candidateProject,
    "--repo",
    "example/dbx-plugin-demo",
    "--tag",
    "v0.1.0",
  ]);
  check("哈希不一致时拒绝生成", result.status === 1 && /SHA-256 与/.test(result.stderr), `exit=${result.status}\n${result.stderr.slice(0, 200)}`);
  writeFileSync(artifactPath, original);
}

section("4. 安装器");

const fakeHome = join(work, "home");
mkdirSync(fakeHome, { recursive: true });
const installerEnv = { HOME: fakeHome, DSH_HOME: undefined, DSH_AGENTS_HOME: undefined };
// 显式删除变量，避免宿主环境干扰
const cleanEnv = { ...process.env, HOME: fakeHome };
delete cleanEnv.DSH_HOME;
delete cleanEnv.DSH_AGENTS_HOME;

const runInstaller = (args) =>
  spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: cleanEnv, cwd: root });

{
  const result = runInstaller(["install"]);
  check("install 三个目标成功", result.status === 0, `exit=${result.status}\n${result.stderr}`);
  for (const name of ["dsh", "claude", "agents"]) {
    const dir = join(fakeHome, `.${name}`, "skills", "dbx-plugin");
    check(`安装到 ~/.${name}/skills/dbx-plugin`, existsSync(join(dir, "SKILL.md")));
    check(`写入 marker (${name})`, existsSync(join(dir, ".dbx-plugin-skill.json")));
  }
}
{
  const result = runInstaller(["status", "--json"]);
  const parsed = JSON.parse(result.stdout);
  check("status 报告全部已安装", parsed.targets.every((t) => t.state === "installed"), result.stdout.slice(0, 200));
  check("status 统计文件数", parsed.targets.every((t) => t.files > 0));
}
{
  const again = runInstaller(["install"]);
  check("重复安装是幂等的", again.status === 0, `exit=${again.status}\n${again.stderr}`);
}
{
  const linked = runInstaller(["install", "--target", "dsh", "--link"]);
  check("--link 安装成功", linked.status === 0, `exit=${linked.status}\n${linked.stderr}`);
  const linkPath = join(fakeHome, ".dsh", "skills", "dbx-plugin");
  check("--link 创建符号链接", lstatSync(linkPath).isSymbolicLink());
  check(
    "--link 不污染 skill 源码目录（不写 marker）",
    !existsSync(join(root, "skill", ".dbx-plugin-skill.json")),
    "marker 被写进了符号链接目标",
  );
  const linkedStatus = runInstaller(["status", "--json"]);
  const parsed = JSON.parse(linkedStatus.stdout);
  const dsh = parsed.targets.find((t) => t.target === "dsh");
  check("--link 安装被识别为已安装", dsh.state === "installed" && dsh.mode === "link", JSON.stringify(dsh));
}
{
  // link 安装应能正常卸载，且不删除源码目录
  const result = runInstaller(["uninstall", "--target", "dsh"]);
  check("link 安装可正常卸载", result.status === 0, `exit=${result.status}\n${result.stderr}`);
  check("卸载后 skill 源码仍在", existsSync(join(root, "skill", "SKILL.md")));
  runInstaller(["install", "--target", "dsh"]);
}
{
  const occupied = join(fakeHome, ".claude", "skills", "dbx-plugin");
  rmSync(occupied, { recursive: true, force: true });
  mkdirSync(occupied, { recursive: true });
  writeFileSync(join(occupied, "foreign.txt"), "not ours");
  const result = runInstaller(["install", "--target", "claude"]);
  check("拒绝覆盖非本安装器写入的目录", result.status === 1 && /已存在且不是本安装器写入/.test(result.stderr), `exit=${result.status}`);
  const forced = runInstaller(["install", "--target", "claude", "--force"]);
  check("--force 可覆盖", forced.status === 0, forced.stderr);
}
{
  const result = runInstaller(["uninstall"]);
  check("uninstall 成功", result.status === 0, `exit=${result.status}\n${result.stderr}`);
  for (const name of ["dsh", "claude", "agents"]) {
    check(`移除 ~/.${name}/skills/dbx-plugin`, !existsSync(join(fakeHome, `.${name}`, "skills", "dbx-plugin")));
  }
}
{
  const result = runInstaller(["path", "--target", "dsh"]);
  check("path 打印预期路径", result.stdout.trim() === join(fakeHome, ".dsh", "skills", "dbx-plugin"), result.stdout.trim());
}
{
  const result = runInstaller(["doctor", "--json"]);
  const parsed = JSON.parse(result.stdout);
  check("doctor 输出结构化结果", Array.isArray(parsed.checks) && parsed.checks.length >= 4, result.stdout.slice(0, 200));
  check("doctor 检出 skill 未安装", parsed.checks.some((c) => c.name.includes("DeepSeek") && c.level === "warn"));
}

// ------------------------------------------------------- 汇总

rmSync(work, { recursive: true, force: true });

process.stdout.write(`\n${"-".repeat(48)}\n通过 ${passed} 项，失败 ${failed} 项\n`);
if (failed > 0) {
  process.stdout.write(`\n失败项:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("全部通过。\n");
