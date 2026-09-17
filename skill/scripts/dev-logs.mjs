#!/usr/bin/env node
/**
 * dev-logs.mjs — 读取 dbx-plugin dev 的脱敏诊断日志（零依赖，Node.js 18+）
 *
 * 用法:
 *   node dev-logs.mjs [--port 5190] [--url URL] [--level debug|info|error]
 *                     [--limit 100] [--follow] [--interval 1000]
 *                     [--json] [--details] [--no-details] [--quiet]
 *
 * 对应接口: GET http://127.0.0.1:<port>/api/diagnostics
 * 参数: after（排他游标）、limit（1-500）、level（精确匹配）、instanceId
 *
 * 条目形状: { id, time, level, category, message, details }
 * 响应形状: { instanceId, entries, nextAfter, hasMore, reset, truncated, oldestId, latestId, plugin, backendState, port }
 *
 * 轮询语义：带上一页的 nextAfter 作为 after、并带上 instanceId；reset 表示实例/游标重置；
 *          truncated 表示旧日志已被 500 条环形缓冲覆盖。改变筛选条件需从 after=0 重新开始。
 */

const LEVELS = ["debug", "info", "error"];

function parseArgs(args) {
  const options = {
    port: 5190,
    url: null,
    level: null,
    limit: 100,
    follow: false,
    interval: 1000,
    json: false,
    details: true,
    quiet: false,
  };
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
    if (arg === "--port") options.port = Number(take());
    else if (arg === "--url") options.url = take();
    else if (arg === "--level") options.level = take();
    else if (arg === "--limit") options.limit = Number(take());
    else if (arg === "--interval") options.interval = Number(take());
    else if (arg === "--follow" || arg === "-f") options.follow = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--details") options.details = true;
    else if (arg === "--no-details") options.details = false;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "用法: node dev-logs.mjs [--port 5190] [--url URL] [--level debug|info|error]\n" +
          "                       [--limit 100] [--follow] [--interval 1000]\n" +
          "                       [--json] [--no-details] [--quiet]\n\n" +
          "读取 dbx-plugin dev 的脱敏诊断日志。--follow 会持续轮询并按游标增量输出。\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`未知参数: ${arg}\n`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    process.stderr.write("--port 必须是 0-65535 的整数\n");
    process.exit(2);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
    process.stderr.write("--limit 必须在 1-500 之间\n");
    process.exit(2);
  }
  if (options.level !== null && !LEVELS.includes(options.level)) {
    process.stderr.write(`--level 必须是 ${LEVELS.join(" / ")} 之一\n`);
    process.exit(2);
  }
  if (!Number.isInteger(options.interval) || options.interval < 100) {
    process.stderr.write("--interval 必须是不小于 100 的整数（毫秒）\n");
    process.exit(2);
  }
  return options;
}

const baseUrl = (options) => options.url ?? `http://127.0.0.1:${options.port}`;

async function fetchPage(options, state) {
  const query = new URLSearchParams();
  query.set("after", String(state.after));
  query.set("limit", String(options.limit));
  if (options.level) query.set("level", options.level);
  if (state.instanceId) query.set("instanceId", state.instanceId);

  const endpoint = `${baseUrl(options)}/api/diagnostics?${query.toString()}`;
  let response;
  try {
    response = await fetch(endpoint);
  } catch (err) {
    process.stderr.write(`无法连接 ${endpoint}: ${err.message}\n`);
    process.stderr.write("请确认 dbx-plugin dev 正在运行，并用它实际打印的端口。\n");
    process.exit(1);
  }
  if (!response.ok) {
    process.stderr.write(`请求失败: HTTP ${response.status} ${response.statusText}（${endpoint}）\n`);
    process.exit(1);
  }
  return response.json();
}

const LEVEL_TAG = { debug: "DEBUG", info: "INFO ", error: "ERROR" };

function formatEntry(entry, showDetails) {
  const time = typeof entry.time === "string" ? entry.time.slice(11, 23) : "           ";
  const tag = LEVEL_TAG[entry.level] ?? String(entry.level ?? "?").toUpperCase();
  const category = entry.category ? `[${entry.category}] ` : "";
  let line = `${time} ${tag} ${category}${entry.message ?? ""}`;
  if (showDetails && entry.details && Object.keys(entry.details).length > 0) {
    line += `\n             ${JSON.stringify(entry.details)}`;
  }
  return line;
}

function emit(entries, options) {
  for (const entry of entries) {
    if (options.json) process.stdout.write(`${JSON.stringify(entry)}\n`);
    else process.stdout.write(`${formatEntry(entry, options.details)}\n`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const state = { after: 0, instanceId: undefined, first: true };

  if (!options.follow) {
    const page = await fetchPage(options, state);
    if (!options.json && !options.quiet) {
      const describe = (value) => (typeof value === "string" ? value : JSON.stringify(value));
      const bits = [
        page.plugin ? `plugin=${describe(page.plugin)}` : null,
        page.backendState ? `backend=${describe(page.backendState)}` : null,
        page.port ? `port=${describe(page.port)}` : null,
      ].filter(Boolean);
      process.stderr.write(`${bits.join("  ")}${bits.length ? "\n" : ""}`);
      if (page.truncated) process.stderr.write("（旧日志已被 500 条环形缓冲覆盖）\n");
    }
    emit(page.entries ?? [], options);
    if (!options.json && !options.quiet) {
      const count = (page.entries ?? []).length;
      process.stderr.write(
        `${count} 条${page.hasMore ? "（还有更多，请用更大的 --limit 或 --follow）" : ""}\n`,
      );
    }
    return;
  }

  let running = true;
  process.on("SIGINT", () => {
    running = false;
    process.stderr.write("\n已停止。\n");
    process.exit(0);
  });

  while (running) {
    const page = await fetchPage(options, state);
    if (page.reset && !state.first) {
      process.stderr.write("（服务实例或游标重置，从可用历史重新开始）\n");
      state.after = 0;
    }
    if (page.truncated) process.stderr.write("（部分旧日志已被覆盖）\n");
    state.instanceId = page.instanceId;
    state.first = false;

    const entries = page.entries ?? [];
    emit(entries, options);

    if (page.hasMore) {
      // 立即取下一页
      state.after = page.nextAfter ?? (entries.at(-1)?.id ?? state.after);
      continue;
    }
    state.after = page.nextAfter ?? state.after;
    await new Promise((resolve) => setTimeout(resolve, options.interval));
  }
}

main().catch((err) => {
  process.stderr.write(`未预期的错误: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
