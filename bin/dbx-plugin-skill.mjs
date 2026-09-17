#!/usr/bin/env node
/**
 * dbx-plugin-skill — 安装/卸载 DBX 插件开发 skill
 *
 * 用法:
 *   npx dbx-plugin-skill install [--target all|dsh,claude,agents] [--scope user|project] [--link] [--force]
 *   npx dbx-plugin-skill uninstall [--target ...] [--scope user|project] [--force]
 *   npx dbx-plugin-skill status [--target ...] [--scope user|project] [--json]
 *   npx dbx-plugin-skill doctor [--json]
 *   npx dbx-plugin-skill path [--target dsh|claude|agents] [--scope user|project]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  install,
  uninstall,
  status,
  resolveTargets,
  targetRoot,
  installPath,
  sourceDir,
  packageVersion,
  SKILL_NAME,
  TARGET_NAMES,
} from "../lib/installer.mjs";

const PACKAGE_NAME = "dbx-plugin-skill";

const USAGE = `dbx-plugin-skill — DBX 插件开发 skill 安装器

用法:
  dbx-plugin-skill <command> [options]

命令:
  install      安装 skill 到技能目录（默认 dsh + claude + agents）
  uninstall    移除本安装器写入的 skill
  status       查看各目标的安装状态
  doctor       环境自检（Node、dbx-plugin CLI、skill 安装、当前项目）
  path         打印某个目标的安装路径

选项:
  --target LIST    all（默认）或逗号分隔: ${TARGET_NAMES.join(", ")}
  --scope SCOPE    user（默认，家目录）或 project（当前目录）
  --link           安装为符号链接（便于从源码仓库开发）
  --force          覆盖非本安装器写入的同名目录 / 强制卸载
  --json           以 JSON 输出（status / doctor）
  --offline        doctor 跳过 npm 版本检查
  -h, --help       显示帮助
  -v, --version    显示版本
`;

function parseArgs(argv) {
  const options = {
    target: "all",
    scope: "user",
    link: false,
    force: false,
    json: false,
    offline: false,
    positional: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      i += 1;
      const value = argv[i];
      if (value === undefined) fail(`${arg} 需要一个值`);
      return value;
    };
    if (arg === "--target" || arg === "-t") options.target = take();
    else if (arg === "--scope") options.scope = take();
    else if (arg === "--link") options.link = true;
    else if (arg === "--force" || arg === "-f") options.force = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "-v" || arg === "--version") options.version = true;
    else if (arg.startsWith("-")) fail(`未知选项: ${arg}`);
    else options.positional.push(arg);
  }
  if (!["user", "project"].includes(options.scope)) fail(`--scope 只能是 user 或 project`);
  return options;
}

function fail(message) {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function commandExists(command) {
  try {
    execFileSync(command, ["--version"], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function pluginCliVersion() {
  for (const [command, args] of [
    ["dbx-plugin", ["version"]],
    ["npx", ["--no-install", "@dbx-app/plugin-cli", "version"]],
  ]) {
    try {
      const output = execFileSync(command, args, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
      if (output) return { command: `${command} ${args.join(" ")}`, output };
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

function commandInstall(options) {
  const targets = resolveTargets(options.target);
  const results = install({
    targets,
    scope: options.scope,
    link: options.link,
    force: options.force,
    log: (line) => process.stdout.write(`${line}\n`),
  });
  process.stdout.write(`\n已安装 skill "${SKILL_NAME}" v${packageVersion()} 到 ${results.length} 个目标。\n`);
  process.stdout.write(`重启 agent 会话后生效（技能目录在会话启动时扫描）。\n`);
}

function commandUninstall(options) {
  const targets = resolveTargets(options.target);
  const results = uninstall({
    targets,
    scope: options.scope,
    force: options.force,
    log: (line) => process.stdout.write(`${line}\n`),
  });
  const removed = results.filter((r) => r.removed).length;
  process.stdout.write(`\n已移除 ${removed} 个目标。\n`);
}

function commandStatus(options) {
  const targets = resolveTargets(options.target);
  const rows = status({ targets, scope: options.scope });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ skill: SKILL_NAME, version: packageVersion(), scope: options.scope, targets: rows }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`skill: ${SKILL_NAME}  包版本: ${packageVersion()}  scope: ${options.scope}\n\n`);
  for (const row of rows) {
    const state =
      row.state === "installed"
        ? `已安装${row.version ? ` v${row.version}` : ""}${row.mode === "link" ? "（符号链接）" : ""}${row.files ? ` · ${row.files} 个文件` : ""}`
        : row.state === "unmanaged"
          ? "已存在（非本安装器写入）"
          : row.state === "broken-link"
            ? "符号链接已失效"
            : row.state === "occupied"
              ? "目录被占用"
              : "未安装";
    process.stdout.write(`${row.label} (${row.target})\n  ${row.path}\n  ${state}\n`);
  }
}

/** 查询 npm 上的最新版本；区分「已发布」「尚未发布」「无法连接」三种情况 */
async function latestPublishedVersion() {
  let response;
  try {
    response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: "application/json" },
    });
  } catch {
    return { status: "unreachable" };
  }
  if (response.status === 404) return { status: "not-published" };
  if (!response.ok) return { status: "unreachable" };
  try {
    const payload = await response.json();
    return typeof payload.version === "string" ? { status: "ok", version: payload.version } : { status: "unreachable" };
  } catch {
    return { status: "unreachable" };
  }
}

async function commandDoctor(options) {
  const targets = resolveTargets(options.target);
  const checks = [];
  const current = packageVersion();

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js",
    ok: nodeMajor >= 18,
    detail: `v${process.versions.node}${nodeMajor >= 22 ? "（满足 dev 要求）" : "（<22，dbx-plugin dev 需要 22+）"}`,
    level: nodeMajor >= 18 ? "ok" : "error",
  });
  checks.push({
    name: "Node.js 22+（dev 子命令）",
    ok: nodeMajor >= 22,
    detail: nodeMajor >= 22 ? "满足" : "dbx-plugin dev 需要 Node.js 22+",
    level: nodeMajor >= 22 ? "ok" : "warn",
  });

  const cli = pluginCliVersion();
  checks.push({
    name: "dbx-plugin CLI",
    ok: Boolean(cli),
    detail: cli ? `${cli.output.split("\n")[0]}（${cli.command}）` : "未找到。安装: npm install --global @dbx-app/plugin-cli",
    level: cli ? "ok" : "warn",
  });

  const skillSource = sourceDir();
  checks.push({
    name: "skill 源目录",
    ok: existsSync(join(skillSource, "SKILL.md")),
    detail: skillSource,
    level: existsSync(join(skillSource, "SKILL.md")) ? "ok" : "error",
  });

  if (options.offline) {
    checks.push({ name: "skill 版本", ok: true, detail: `本机 v${current}（已跳过在线检查）`, level: "info" });
  } else {
    const latest = await latestPublishedVersion();
    if (latest.status === "not-published") {
      checks.push({
        name: "skill 版本",
        ok: true,
        detail: `本机 v${current}（${PACKAGE_NAME} 尚未发布到 npm）`,
        level: "info",
      });
    } else if (latest.status === "unreachable") {
      checks.push({ name: "skill 版本", ok: true, detail: `本机 v${current}（无法连接 npm，已跳过）`, level: "info" });
    } else if (latest.version === current) {
      checks.push({ name: "skill 版本", ok: true, detail: `v${current}（已是 npm 最新）`, level: "ok" });
    } else {
      checks.push({
        name: "skill 版本",
        ok: true,
        detail: `本机 v${current}，npm 最新 v${latest.version}。升级: npm i -g ${PACKAGE_NAME}@latest && ${PACKAGE_NAME} install`,
        level: "warn",
      });
    }
  }

  for (const row of status({ targets, scope: options.scope })) {
    checks.push({
      name: `skill 安装 · ${row.label}`,
      ok: row.state === "installed",
      detail: row.state === "installed" ? `${row.path}${row.mode === "link" ? "（link）" : ""}` : `${row.path} — ${row.state}`,
      level: row.state === "installed" ? "ok" : "warn",
    });
  }

  const cwd = process.cwd();
  const projectManifest = join(cwd, "manifest.json");
  const projectToml = join(cwd, "dbx-plugin.toml");
  const isProject = existsSync(projectManifest) && existsSync(projectToml);
  checks.push({
    name: "当前目录是 DBX 插件项目",
    ok: isProject,
    detail: isProject ? cwd : `${cwd}（缺少 manifest.json 或 dbx-plugin.toml）`,
    level: isProject ? "ok" : "info",
  });

  const failed = checks.filter((c) => c.level === "error");
  const warned = checks.filter((c) => c.level === "warn");

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, checks }, null, 2)}\n`);
  } else {
    for (const check of checks) {
      const tag = check.level === "error" ? "ERROR" : check.level === "warn" ? "WARN " : check.level === "info" ? "info " : "OK   ";
      process.stdout.write(`[${tag}] ${check.name}: ${check.detail}\n`);
    }
    process.stdout.write(`\n${failed.length} 个错误, ${warned.length} 个警告\n`);
    if (isProject) {
      process.stdout.write(`\n建议下一步: node ${join(skillSource, "scripts", "check-project.mjs")} .\n`);
    }
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

function commandPath(options) {
  const targets = resolveTargets(options.target);
  for (const name of targets) {
    const root = targetRoot(name, options.scope);
    process.stdout.write(options.json ? `${JSON.stringify({ target: name, root, path: installPath(name, options.scope) })}\n` : `${installPath(name, options.scope)}\n`);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);

  if (options.help || !command || command === "help") {
    process.stdout.write(USAGE);
    return;
  }
  if (options.version || command === "version") {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }

  switch (command) {
    case "install":
      commandInstall(options);
      break;
    case "uninstall":
    case "remove":
      commandUninstall(options);
      break;
    case "status":
    case "list":
      commandStatus(options);
      break;
    case "doctor":
      await commandDoctor(options);
      break;
    case "path":
      commandPath(options);
      break;
    default:
      fail(`未知命令: ${command}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
