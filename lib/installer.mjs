/**
 * installer.mjs — 把 skill 安装到各 agent 的技能目录
 *
 * 支持的 target:
 *   dsh     → <root>/.dsh/skills/dbx-plugin
 *   claude  → <root>/.claude/skills/dbx-plugin
 *   agents  → <root>/.agents/skills/dbx-plugin
 *
 * <root> 在 user scope 下是 home 目录，在 project scope 下是当前工作目录。
 */

import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const SKILL_NAME = "dbx-plugin";
export const MARKER_FILE = ".dbx-plugin-skill.json";

/**
 * 每个 target 的技能目录。
 * 注意：DSH_HOME 指向 harness 的 home 目录本身（如 ~/.dsh），技能在 $DSH_HOME/skills；
 * DSH_AGENTS_HOME 同理指向 agents home（默认 ~/.agents），技能在 $DSH_AGENTS_HOME/skills。
 */
export const TARGETS = {
  dsh: { label: "DeepSeek Harness", homeDir: ".dsh", homeEnv: "DSH_HOME" },
  claude: { label: "Claude Code", homeDir: ".claude", homeEnv: null },
  agents: { label: "共享 agents 目录", homeDir: ".agents", homeEnv: "DSH_AGENTS_HOME" },
};

export const TARGET_NAMES = Object.keys(TARGETS);

/** 解析包内 skill 源目录 */
export function sourceDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "skill");
}

export function packageVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));
  return pkg.version;
}

export function resolveTargets(selection) {
  if (!selection || selection === "all") return [...TARGET_NAMES];
  const names = String(selection)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const unknown = names.filter((name) => !TARGET_NAMES.includes(name));
  if (unknown.length) {
    throw new Error(`未知 target: ${unknown.join(", ")}（可用: ${TARGET_NAMES.join(", ")}, all）`);
  }
  return names;
}

/** 计算某个 target 的安装根目录（skills 目录本身） */
export function targetRoot(name, scope, cwd = process.cwd()) {
  const target = TARGETS[name];
  if (!target) throw new Error(`未知 target: ${name}`);
  if (scope === "project") return join(cwd, target.homeDir, "skills");
  const base =
    (target.homeEnv && process.env[target.homeEnv]) || join(homedir(), target.homeDir);
  return join(base, "skills");
}

export function installPath(name, scope, cwd) {
  return join(targetRoot(name, scope, cwd), SKILL_NAME);
}

/** 判断目录里是否已有一份本 skill（读 marker，或退回检查 SKILL.md 的 name 字段） */
export function inspectInstall(dir) {
  if (!existsSync(dir)) return { state: "absent" };
  let stats;
  try {
    stats = lstatSync(dir);
  } catch {
    return { state: "absent" };
  }
  const linked = stats.isSymbolicLink();
  let resolved = dir;
  if (linked) {
    try {
      resolved = realpathSync(dir);
    } catch {
      return { state: "broken-link", linked: true };
    }
  }
  const markerPath = join(resolved, MARKER_FILE);
  if (existsSync(markerPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8"));
      if (marker.skill === SKILL_NAME) {
        return { state: "installed", linked, marker, resolved };
      }
    } catch {
      /* marker 损坏，继续按 SKILL.md 判断 */
    }
  }
  const skillFile = join(resolved, "SKILL.md");
  if (existsSync(skillFile)) {
    const head = readFileSync(skillFile, "utf8").slice(0, 500);
    if (/^name:\s*dbx-plugin\s*$/m.test(head)) {
      // link 模式刻意不写 marker（写入会穿过符号链接污染源目录），
      // 因此指向本 skill 的符号链接直接视为本安装器写入。
      // 非链接的同名目录可能是用户手工复制的，保持 unmanaged 需要 --force。
      return linked
        ? { state: "installed", linked, mode: "link", resolved }
        : { state: "unmanaged", linked, resolved };
    }
  }
  return { state: "occupied", linked, resolved };
}

function writeMarker(dir, { mode, version }) {
  const marker = {
    skill: SKILL_NAME,
    package: "dbx-plugin-skill",
    version,
    mode,
    installedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

export function install({ targets, scope = "user", link = false, force = false, cwd = process.cwd(), log = () => {} }) {
  const source = sourceDir();
  if (!existsSync(join(source, "SKILL.md"))) {
    throw new Error(`包内找不到 skill 源目录: ${source}`);
  }
  const version = packageVersion();
  const results = [];

  for (const name of targets) {
    const root = targetRoot(name, scope, cwd);
    const destination = join(root, SKILL_NAME);
    const existing = inspectInstall(destination);

    if (existing.state === "broken-link") {
      log(`清理失效的符号链接: ${destination}`);
      rmSync(destination, { force: true });
    } else if (existing.state === "installed") {
      // 幂等重装：先移除再写
      rmSync(destination, { recursive: true, force: true });
    } else if (existing.state === "unmanaged" || existing.state === "occupied") {
      if (!force) {
        throw new Error(
          `${destination} 已存在且不是本安装器写入的（${existing.state === "unmanaged" ? "疑似手工安装" : "目录被占用"}）。` +
            `加 --force 覆盖，或先手工删除。`,
        );
      }
      rmSync(destination, { recursive: true, force: true });
    }

    mkdirSync(root, { recursive: true });

    let installedVersion = version;
    if (link) {
      try {
        symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
      } catch (err) {
        throw new Error(`创建符号链接失败（${destination}）: ${err.message}。去掉 --link 可改用复制安装。`);
      }
      // link 模式不写 marker：目标通常是本包的源码目录，写入会顺着链接污染源码。
      // inspectInstall 通过「符号链接 + SKILL.md 的 name 字段」识别这种安装。
    } else {
      mkdirSync(destination, { recursive: true });
      cpSync(source, destination, { recursive: true });
      installedVersion = writeMarker(destination, { mode: "copy", version }).version;
    }

    results.push({
      target: name,
      label: TARGETS[name].label,
      path: destination,
      mode: link ? "link" : "copy",
      version: installedVersion,
    });
    log(`✔ ${TARGETS[name].label} → ${destination}${link ? "（符号链接）" : ""}`);
  }

  return results;
}

export function uninstall({ targets, scope = "user", force = false, cwd = process.cwd(), log = () => {} }) {
  const results = [];
  for (const name of targets) {
    const destination = installPath(name, scope, cwd);
    const existing = inspectInstall(destination);
    if (existing.state === "absent") {
      results.push({ target: name, path: destination, removed: false, reason: "未安装" });
      log(`· ${TARGETS[name].label}: 未安装，跳过`);
      continue;
    }
    if (existing.state === "unmanaged" || existing.state === "occupied") {
      if (!force) {
        throw new Error(
          `${destination} 不是本安装器写入的（${existing.state}），拒绝删除。确实要删请加 --force。`,
        );
      }
    }
    rmSync(destination, { recursive: true, force: true });
    results.push({ target: name, path: destination, removed: true });
    log(`✔ 已移除 ${TARGETS[name].label}: ${destination}`);
  }
  return results;
}

export function status({ targets, scope = "user", cwd = process.cwd() }) {
  return targets.map((name) => {
    const root = targetRoot(name, scope, cwd);
    const destination = join(root, SKILL_NAME);
    const info = inspectInstall(destination);
    let files = 0;
    if (info.state === "installed" || info.state === "unmanaged") {
      try {
        files = countFiles(info.resolved);
      } catch {
        files = 0;
      }
    }
    return {
      target: name,
      label: TARGETS[name].label,
      scope,
      root,
      path: destination,
      state: info.state,
      mode: info.linked ? "link" : info.marker?.mode ?? null,
      version: info.marker?.version ?? null,
      files,
    };
  });
}

function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name));
    else if (entry.isFile()) total += 1;
  }
  return total;
}
