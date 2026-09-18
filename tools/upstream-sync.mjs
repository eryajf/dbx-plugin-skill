#!/usr/bin/env node
/**
 * Keep small, local, non-packaged sparse checkouts of the DBX upstreams.
 * The checkouts are intentionally under tmp/ (gitignored) and are useful for
 * reviewing the source documents and SDK code behind this skill.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(join(fileURLToPath(import.meta.url), "..", ".."));
const config = JSON.parse(readFileSync(join(root, "tools/upstream-sources.json"), "utf8"));
const dir = join(root, "tmp", "upstream");
const reportPath = join(dir, "report.json");
const args = new Set(process.argv.slice(2));

function run(repo, command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function syncOne(name, source) {
  const checkout = join(dir, name);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(checkout, ".git"))) {
    const cloneArgs = ["clone", "--depth=1", "--branch", source.ref];
    if (source.mode !== "full") cloneArgs.push("--filter=blob:none", "--no-checkout", "--sparse");
    cloneArgs.push(source.repo, checkout);
    run(root, "git", cloneArgs);
  } else {
    run(checkout, "git", ["fetch", "--depth=1", "origin", source.ref]);
  }
  if (source.mode === "full") {
    if (existsSync(join(checkout, ".git", "info", "sparse-checkout"))) run(checkout, "git", ["sparse-checkout", "disable"]);
  } else {
    run(checkout, "git", ["sparse-checkout", "set", "--no-cone", ...source.paths]);
  }
  run(checkout, "git", ["reset", "--hard", `origin/${source.ref}`]);
  return {
    repo: source.repo,
    ref: source.ref,
    commit: run(checkout, "git", ["rev-parse", "HEAD"]),
    paths: source.paths,
  };
}

function hashFiles(base, relative, out = []) {
  const absolute = join(base, relative);
  if (!existsSync(absolute)) return out;
  if (statSync(absolute).isDirectory()) {
    for (const child of readdirSync(absolute).sort()) hashFiles(base, join(relative, child), out);
    return out;
  }
  out.push({ path: relative, sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex") });
  return out;
}

function main() {
  if (args.has("--help")) {
    console.log("Usage: node tools/upstream-sync.mjs [--report-only]");
    console.log("Updates tmp/upstream with sparse checkouts; --report-only prints report.json.");
    return;
  }
  if (args.has("--report-only")) {
    if (!existsSync(reportPath)) throw new Error("没有快照，请先运行 npm run upstream:sync");
    console.log(readFileSync(reportPath, "utf8"));
    return;
  }
  const sources = {};
  for (const [name, source] of Object.entries(config)) sources[name] = syncOne(name, source);
  for (const [name, source] of Object.entries(config)) {
    sources[name].files = source.mode === "full"
      ? hashFiles(join(dir, name), ".").filter(({ path }) => !path.startsWith(".git/"))
      : source.paths.flatMap((path) => hashFiles(join(dir, name), path));
  }
  const report = { generatedAt: new Date().toISOString(), sources };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`已更新上游稀疏快照: ${dir}`);
  console.log(`报告: ${reportPath}`);
}

try { main(); } catch (error) { console.error(`上游同步失败: ${error.message}`); process.exit(1); }
