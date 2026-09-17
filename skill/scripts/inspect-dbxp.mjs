#!/usr/bin/env node
/**
 * inspect-dbxp.mjs — 检查 .dbxp 包内容（零依赖，Node.js 18+）
 *
 * 用法:
 *   node inspect-dbxp.mjs <file.dbxp> [--json] [--extract DIR] [--no-verify] [--quiet]
 *
 * .dbxp 是 ZIP 容器，通常包含：
 *   manifest.json, checksums.json, [signature.json], bin/<target>/<binary>, <include 目录...>
 *
 * 会做：列出条目、解析 manifest、逐条重算 checksums.json 里的 SHA-256、
 *      判断签名状态、检查 bin/ 下的 target 与文件名是否一致、发现不该出现的文件。
 *
 * 退出码: 0 = 检查通过，1 = 发现问题，2 = 用法/IO 错误
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { join, resolve, dirname, posix } from "node:path";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_ENTRY_SENTINEL = 0xffffffff;
const ZIP64_COUNT_SENTINEL = 0xffff;

/** 商店目录实际使用的 target 词表；长 target 需先匹配（darwin-arm64 先于 arm64）。 */
const KNOWN_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-arm64",
  "windows-x64",
  "universal",
];

/**
 * 解析 `<id>-<version>-<target>.dbxp`。
 * target 在末尾且可能含 `-`，因此先按已知词表从右匹配，再回退到最后一个 `-`。
 */
function parseDbxpName(fileName) {
  if (!fileName.endsWith(".dbxp")) return null;
  const stem = fileName.slice(0, -".dbxp".length);
  let target = null;
  let canonical = false;
  for (const candidate of KNOWN_TARGETS) {
    if (stem.endsWith(`-${candidate}`)) {
      target = candidate;
      canonical = true;
      break;
    }
  }
  if (target === null) {
    const index = stem.lastIndexOf("-");
    if (index < 0) return null;
    target = stem.slice(index + 1);
  }
  const rest = stem.slice(0, stem.length - target.length - 1);
  const match = /^(.*)-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(rest);
  if (!match) return { id: rest, version: null, target, canonical };
  return { id: match[1], version: match[2], target, canonical };
}

const problems = [];
let jsonMode = false;
let quiet = false;

function problem(message, hint) {
  problems.push({ level: "error", message, hint });
  if (!jsonMode && !quiet) process.stderr.write(`[ERROR] ${message}${hint ? `\n        → ${hint}` : ""}\n`);
}
function note(message) {
  if (!jsonMode && !quiet) process.stdout.write(`${message}\n`);
}

// ---------------------------------------------------------------- ZIP 读取

function findEocd(buffer) {
  const minOffset = Math.max(0, buffer.length - 66000);
  for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

function readEntries(buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error("未找到 ZIP 中央目录（文件可能不是合法的 .dbxp）");
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries === ZIP64_COUNT_SENTINEL || cdOffset === ZIP64_ENTRY_SENTINEL || cdSize === ZIP64_ENTRY_SENTINEL) {
    throw new Error("暂不支持 ZIP64（条目数或偏移超出常规 ZIP 上限）");
  }
  if (cdOffset + cdSize > buffer.length) throw new Error("中央目录偏移越界，文件可能被截断");

  const entries = [];
  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > buffer.length) throw new Error("中央目录条目越界");
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error(`第 ${i} 个中央目录条目签名非法`);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc32 = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    entries.push({
      name,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      unixMode: (externalAttributes >>> 16) & 0xffff,
      localOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer, entry) {
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length) throw new Error(`条目 ${entry.name}: 本地头越界`);
  if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new Error(`条目 ${entry.name}: 本地文件头签名非法`);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw new Error(`条目 ${entry.name}: 数据越界`);
  const raw = buffer.subarray(start, end);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`条目 ${entry.name}: 不支持的压缩方法 ${entry.method}`);
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
};

// ---------------------------------------------------------------- 检查

function main() {
  const args = process.argv.slice(2);
  const positional = [];
  let extractDir = null;
  let verify = true;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      jsonMode = true;
    } else if (arg === "--quiet") quiet = true;
    else if (arg === "--no-verify") verify = false;
    else if (arg === "--extract") {
      extractDir = args[i + 1];
      i += 1;
      if (!extractDir) {
        process.stderr.write("--extract 需要一个目录参数\n");
        process.exit(2);
      }
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "用法: node inspect-dbxp.mjs <file.dbxp> [--json] [--extract DIR] [--no-verify] [--quiet]\n\n" +
          "列出 .dbxp 条目、解析 manifest、校验 checksums.json、判断签名与 bin target。\n",
      );
      return;
    } else if (arg.startsWith("-")) {
      process.stderr.write(`未知选项: ${arg}\n`);
      process.exit(2);
    } else positional.push(arg);
  }

  if (positional.length === 0) {
    process.stderr.write("用法: node inspect-dbxp.mjs <file.dbxp> [--json] [--extract DIR] [--no-verify]\n");
    process.exit(2);
  }

  const filePath = resolve(positional[0]);
  if (!existsSync(filePath)) {
    process.stderr.write(`文件不存在: ${filePath}\n`);
    process.exit(2);
  }

  const buffer = readFileSync(filePath);
  const fileName = posix.basename(filePath.split("\\").join("/"));

  let entries;
  try {
    entries = readEntries(buffer);
  } catch (err) {
    process.stderr.write(`读取失败: ${err.message}\n`);
    process.exit(2);
  }

  // 文件名 → <id>-<version>-<target>.dbxp
  const parsedName = parseDbxpName(fileName);

  // manifest
  let manifest = null;
  const manifestEntry = entries.find((e) => e.name === "manifest.json");
  if (!manifestEntry) {
    problem("包内缺少 manifest.json", "DBX 安装会失败；请用 dbx-plugin package 重新打包。");
  } else {
    try {
      manifest = JSON.parse(readEntry(buffer, manifestEntry).toString("utf8"));
    } catch (err) {
      problem(`包内 manifest.json 无法解析: ${err.message}`);
    }
  }

  // signature
  const signatureEntry = entries.find((e) => e.name === "signature.json");
  let signature = null;
  if (signatureEntry) {
    try {
      signature = JSON.parse(readEntry(buffer, signatureEntry).toString("utf8"));
    } catch (err) {
      problem(`signature.json 无法解析: ${err.message}`);
    }
  }

  // checksums
  const checksumsEntry = entries.find((e) => e.name === "checksums.json");
  let checksums = null;
  if (!checksumsEntry) {
    problem("包内缺少 checksums.json", "DBX 会拒绝安装：除 checksums/signature 外每个文件都必须有一条 SHA-256。");
  } else {
    try {
      checksums = JSON.parse(readEntry(buffer, checksumsEntry).toString("utf8"));
    } catch (err) {
      problem(`checksums.json 无法解析: ${err.message}`);
    }
  }

  const verification = { checked: 0, mismatched: [], missing: [], extra: [], algorithm: null };
  if (checksums && verify) {
    if (checksums.algorithm !== "sha256") {
      problem(`checksums.json algorithm 期望 "sha256"，实际 ${JSON.stringify(checksums.algorithm)}`);
    }
    verification.algorithm = checksums.algorithm ?? null;
    const files = checksums.files && typeof checksums.files === "object" ? checksums.files : {};
    const payloadEntries = entries.filter((e) => !e.name.endsWith("/") && e.name !== "checksums.json" && e.name !== "signature.json");
    for (const entry of payloadEntries) {
      const expected = files[entry.name];
      if (expected === undefined) {
        verification.missing.push(entry.name);
        problem(`checksums.json 缺少条目: ${entry.name}`, "每个非 checksums/signature 文件都必须被登记。");
        continue;
      }
      let actual;
      try {
        actual = sha256(readEntry(buffer, entry));
      } catch (err) {
        problem(`无法读取条目 ${entry.name}: ${err.message}`);
        continue;
      }
      verification.checked += 1;
      if (actual !== String(expected).toLowerCase()) {
        verification.mismatched.push({ name: entry.name, expected, actual });
        problem(`SHA-256 不匹配: ${entry.name}`, `期望 ${expected}，实际 ${actual}`);
      }
    }
    for (const name of Object.keys(files)) {
      if (!entries.some((e) => e.name === name)) {
        verification.extra.push(name);
        problem(`checksums.json 登记了不存在的文件: ${name}`);
      }
    }
  }

  // 内容层面的问题
  const dbxDev = entries.filter((e) => e.name === ".dbx-dev" || e.name.startsWith(".dbx-dev/"));
  if (dbxDev.length) {
    problem(`包内含开发数据: ${dbxDev.slice(0, 5).map((e) => e.name).join(", ")}`, "可能泄露明文凭据；检查 [package].include 与 .gitignore。");
  }
  const binTargets = new Set();
  for (const entry of entries) {
    const match = /^bin\/([^/]+)\/(.+)$/.exec(entry.name);
    if (match) binTargets.add(match[1]);
  }

  // 包内 manifest 的 backend.executable 形如 bin/<target>/<binary>
  const executable = manifest?.entrypoints?.backend?.executable;
  let executableTarget = null;
  if (typeof executable === "string") {
    const match = /^bin\/([^/]+)\/(.+)$/.exec(executable);
    if (match) executableTarget = match[1];
  }

  if (parsedName && parsedName.canonical && binTargets.size > 0 && !binTargets.has(parsedName.target)) {
    problem(
      `bin/ 下的 target (${[...binTargets].join(", ")}) 与文件名 target (${parsedName.target}) 不一致`,
      "包内 manifest 的 backend.executable 应指向 bin/<target>/<binary>。",
    );
  }
  if (parsedName && parsedName.canonical && executableTarget && executableTarget !== parsedName.target) {
    problem(
      `包内 manifest 的 backend.executable target "${executableTarget}" 与文件名 target "${parsedName.target}" 不一致`,
      "dbx-plugin package 会把 executable 改写为 bin/<target>/<binary>；不一致说明包被手工改过。",
    );
  }
  if (manifest && parsedName?.canonical && parsedName.version && manifest.version !== parsedName.version) {
    problem(`包内 manifest version "${manifest.version}" 与文件名 version "${parsedName.version}" 不一致`);
  }
  if (manifest && parsedName?.canonical && parsedName.id && manifest.id !== parsedName.id) {
    problem(`包内 manifest id "${manifest.id}" 与文件名 id "${parsedName.id}" 不一致`);
  }
  if (parsedName && !binTargets.size && manifest?.entrypoints?.backend) {
    problem("manifest 声明了 backend，但包内没有 bin/<target>/ 可执行文件");
  }
  if (manifest && manifest.entrypoints?.ui?.entry) {
    const uiEntry = manifest.entrypoints.ui.entry;
    if (!entries.some((e) => e.name === uiEntry)) {
      problem(`manifest.entrypoints.ui.entry "${uiEntry}" 不在包内`);
    }
  }
  if (manifest && typeof manifest.icon === "string" && manifest.icon !== "") {
    if (!entries.some((e) => e.name === manifest.icon)) problem(`manifest.icon "${manifest.icon}" 不在包内`);
  }
  if (!signatureEntry) {
    note("签名状态: 未签名（候选包，仅可用于本地开发安装）");
  } else {
    note(`签名状态: 已签名 (key_id=${signature?.key_id ?? "?"}, algorithm=${signature?.algorithm ?? "?"})`);
  }

  // 可选解包
  if (extractDir) {
    const target = resolve(extractDir);
    for (const entry of entries) {
      const destination = join(target, ...entry.name.split("/"));
      if (entry.name.endsWith("/")) {
        mkdirSync(destination, { recursive: true });
        continue;
      }
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readEntry(buffer, entry));
    }
    note(`已解包到: ${target}`);
  }

  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify(
        {
          file: filePath,
          size: statSync(filePath).size,
          parsedName,
          entryCount: entries.length,
          signed: Boolean(signatureEntry),
          signature,
          manifest,
          manifestId: manifest?.id ?? null,
          manifestVersion: manifest?.version ?? null,
          manifestPublisher: manifest?.publisher ?? null,
          backendExecutable: manifest?.entrypoints?.backend?.executable ?? null,
          binTargets: [...binTargets].sort(),
          verification,
          entries: entries
            .map((e) => ({
              name: e.name,
              method: e.method === 0 ? "store" : e.method === 8 ? "deflate" : `method-${e.method}`,
              size: e.uncompressedSize,
              compressedSize: e.compressedSize,
              unixMode: `0${(e.unixMode & 0o7777).toString(8)}`,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          problems,
        },
        null,
        2,
      )}\n`,
    );
  } else if (!quiet) {
    process.stdout.write(
      `\n文件: ${fileName}  (${formatSize(buffer.length)})\n` +
        `条目: ${entries.length} 个\n` +
        (manifest
          ? `身份: id=${manifest.id}  version=${manifest.version}  publisher=${manifest.publisher}\n`
          : "身份: 无法读取\n") +
        (parsedName ? `文件名解析: id=${parsedName.id}  version=${parsedName.version}  target=${parsedName.target}\n` : "") +
        (binTargets.size ? `bin targets: ${[...binTargets].sort().join(", ")}\n` : "") +
        (verification.checked ? `checksums: 已校验 ${verification.checked} 个文件\n` : "") +
        `\n结论: ${problems.length === 0 ? "OK" : `${problems.length} 个问题`}\n`,
    );
  }

  process.exit(problems.length === 0 ? 0 : 1);
}

main();
