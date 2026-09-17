#!/usr/bin/env node
/**
 * check-project.mjs — DBX 插件项目打包前预检（零依赖，Node.js 18+）
 *
 * 用法:
 *   node check-project.mjs [项目目录] [--json] [--quiet]
 *
 * 覆盖：manifest v1 字段/格式/权限/入口/贡献点、dbx-plugin.toml、
 *      [package].include 覆盖范围、资源存在性、前后端声明一致性。
 *
 * 退出码: 0 = 无 error（可能有 warning），1 = 存在 error
 */

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, isAbsolute, posix, relative } from "node:path";

// ---------------------------------------------------------------- 常量

const MANIFEST_TOP_FIELDS = [
  "$schema",
  "manifest_version",
  "id",
  "name",
  "icon",
  "version",
  "publisher",
  "description",
  "source",
  "homepage",
  "engines",
  "permissions",
  "entrypoints",
  "contributions",
  "localizations",
];

const STATIC_PERMISSIONS = ["host.events", "host.binary", "host.workbench", "host.filesystem"];
const NETWORK_PERMISSION = /^host\.network:https:\/\/[A-Za-z0-9._-]+(?::[0-9]+)?$/;
const MAX_NETWORK_PERMISSIONS = 8;

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const FIELD_TYPES = ["text", "password", "number", "boolean", "select", "radio", "textarea"];
const BINDINGS = ["config", "secret", "name", "host", "port", "username", "password", "database"];
const TEXTUAL_BINDINGS = ["secret", "name", "host", "username", "password", "database"];
const TEXTUAL_TYPES = ["text", "password", "select", "radio", "textarea"];
const CAPABILITIES = ["test", "connect", "disconnect"];
const ACTION_VARIANTS = ["default", "outline", "secondary", "destructive", "ghost"];
const ACTION_WHEN = ["always", "create", "edit"];
const FS_CAPABILITIES = ["read", "write", "delete", "rename", "mkdir"];
const CONTRIBUTION_TYPES = [
  "connection-provider",
  "workbench",
  "filesystem-provider",
  "context-menu",
  "result-view",
];

// ---------------------------------------------------------------- 输出

const findings = [];
let quiet = false;
let jsonMode = false;

function report(level, message, hint) {
  findings.push({ level, message, hint });
  if (jsonMode || (quiet && level !== "error")) return;
  const tag = level === "error" ? "ERROR" : level === "warn" ? "WARN " : "info ";
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`[${tag}] ${message}${hint ? `\n        → ${hint}` : ""}\n`);
}

const error = (m, h) => report("error", m, h);
const warn = (m, h) => report("warn", m, h);
const info = (m, h) => report("info", m, h);

// ---------------------------------------------------------------- 小工具

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** 包内路径安全规则：相对、无 \、无 . / .. 段、无 // */
function unsafePathReason(value) {
  if (typeof value !== "string" || value.length === 0) return "不是非空字符串";
  if (value.startsWith("/")) return "不能以 / 开头";
  if (value.includes("\\")) return "不能包含反斜杠";
  if (value.includes("//")) return "不能包含重复斜杠";
  const segments = value.split("/");
  if (segments.some((s) => s === "." || s === "..")) return "不能包含 . 或 .. 路径段";
  return null;
}

function safeRelativeReason(value) {
  if (typeof value !== "string" || value.length === 0) return "不是非空字符串";
  if (isAbsolute(value)) return "不能是绝对路径";
  const segments = value.split(/[\\/]+/);
  if (segments.some((s) => s === "." || s === "..")) return "不能包含 . 或 .. 路径段";
  return null;
}

function walkFiles(root, base = root, out = []) {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const full = join(base, entry.name);
    if (entry.isDirectory()) walkFiles(root, full, out);
    else if (entry.isFile()) out.push(relative(root, full).split("\\").join("/"));
  }
  return out;
}

function walkDirs(root, base = root, out = []) {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(base, entry.name);
    out.push(relative(root, full).split("\\").join("/"));
    walkDirs(root, full, out);
  }
  return out;
}

// ---------------------------------------------------------------- 极简 TOML 解析（只支持本项目配置形状）

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function parseValue(raw, lineNo) {
  const text = raw.trim();
  if (text === "") throw new Error(`第 ${lineNo} 行: 缺少值`);
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0];
    if (!text.endsWith(quote) || text.length < 2) throw new Error(`第 ${lineNo} 行: 未闭合的字符串`);
    return text.slice(1, -1);
  }
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new Error(`第 ${lineNo} 行: 未闭合的数组`);
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    const items = [];
    let current = "";
    let quote = null;
    for (const ch of inner) {
      if (quote) {
        if (ch === quote) quote = null;
        else current += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ",") {
        items.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    items.push(current.trim());
    return items.filter((v) => v !== "").map((v) => v.replace(/^["']|["']$/g, ""));
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^[+-]?[0-9]+$/.test(text)) return Number(text);
  throw new Error(`第 ${lineNo} 行: 不支持的值 "${text}"（本脚本仅支持字符串/整数/布尔/字符串数组）`);
}

function parseToml(text) {
  const root = {};
  let current = root;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = stripComment(lines[i]).trim();
    if (line === "") continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      const path = section[1].trim().split(".");
      current = root;
      for (const part of path) {
        if (!isPlainObject(current[part])) current[part] = {};
        current = current[part];
      }
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) throw new Error(`第 ${lineNo} 行: 不是 key = value 形式`);
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    if (key === "") throw new Error(`第 ${lineNo} 行: 缺少键名`);
    current[key] = parseValue(line.slice(eq + 1), lineNo);
  }
  return root;
}

// ---------------------------------------------------------------- 校验主体

function checkManifest(dir, manifest) {
  const unknown = Object.keys(manifest).filter((k) => !MANIFEST_TOP_FIELDS.includes(k));
  if (unknown.length) {
    error(
      `manifest.json 含未知顶层字段: ${unknown.join(", ")}`,
      "Manifest v1 拒绝未声明字段。常见误加：signingKeyId、verified、license。",
    );
  }

  if (manifest.manifest_version !== 1) {
    error(`manifest_version 必须为数字 1（当前 ${JSON.stringify(manifest.manifest_version)}）`);
  }

  if (typeof manifest.id !== "string" || !IDENTIFIER.test(manifest.id)) {
    error(`id 非法: ${JSON.stringify(manifest.id)}`, "只允许小写字母、数字和 . _ -，首字符必须是字母或数字。");
  } else if (manifest.id.length > 128) {
    error(`id 长度 ${manifest.id.length} 超过商店上限 128`);
  }

  if (typeof manifest.name !== "string" || manifest.name.trim() === "") error("name 必须是非空字符串");
  else if (/[\u0000-\u001f\u007f]/.test(manifest.name)) error("name 含控制字符");

  if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) {
    error(`version 不是合法 SemVer: ${JSON.stringify(manifest.version)}`, "例如 1.0.0 或 1.0.0-beta.1");
  }

  if (typeof manifest.publisher !== "string" || manifest.publisher.trim() === "") {
    error("publisher 必须是非空字符串");
  } else if (!IDENTIFIER.test(manifest.publisher)) {
    warn(
      `publisher "${manifest.publisher}" 不符合商店标识符规则`,
      "manifest 本身不限制格式，但上架时候选 publisher 必须匹配 ^[a-z0-9][a-z0-9._-]{0,127}$ 且已登记。",
    );
  }

  for (const field of ["description"]) {
    if (manifest[field] !== undefined && typeof manifest[field] !== "string") {
      error(`${field} 必须是字符串`);
    }
  }
  for (const field of ["source", "homepage"]) {
    if (manifest[field] !== undefined && !/^https?:\/\/\S+$/.test(String(manifest[field]))) {
      warn(`${field} 建议使用 http(s) URL（当前 ${JSON.stringify(manifest[field])}）`);
    }
  }

  if (typeof manifest.$schema === "string" && manifest.$schema.includes("plugin-sdk-v1")) {
    warn(
      "$schema 指向的 ref plugin-sdk-v1 不存在（HTTP 404）",
      "改为 https://raw.githubusercontent.com/t8y2/dbx/main/plugins/manifest.schema.json 或具体版本 tag。",
    );
  }

  // engines
  if (!isPlainObject(manifest.engines)) {
    error("engines 是必需字段且必须是对象");
  } else {
    if (typeof manifest.engines.host_api !== "string" || manifest.engines.host_api === "") {
      error("engines.host_api 是必需字段且必须是非空字符串");
    }
    const extra = Object.keys(manifest.engines).filter((k) => k !== "dbx" && k !== "host_api");
    if (extra.length) error(`engines 含未知字段: ${extra.join(", ")}`);
    if (manifest.engines.dbx !== undefined && typeof manifest.engines.dbx !== "string") {
      error("engines.dbx 必须是字符串");
    }
  }

  // permissions
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      error("permissions 必须是数组");
    } else {
      const seen = new Set();
      let networkCount = 0;
      for (const permission of manifest.permissions) {
        if (typeof permission !== "string" || permission === "") {
          error(`permissions 含非法项: ${JSON.stringify(permission)}`);
          continue;
        }
        if (seen.has(permission)) error(`permissions 重复项: ${permission}`);
        seen.add(permission);
        if (STATIC_PERMISSIONS.includes(permission)) continue;
        if (NETWORK_PERMISSION.test(permission)) {
          networkCount += 1;
          continue;
        }
        error(
          `permissions 含未支持的权限: ${permission}`,
          `固定权限: ${STATIC_PERMISSIONS.join(", ")}；网络权限形如 host.network:https://host[:port]（HTTPS、无路径/通配符/Token）。`,
        );
      }
      if (networkCount > MAX_NETWORK_PERMISSIONS) {
        error(`host.network 权限数量 ${networkCount} 超过上限 ${MAX_NETWORK_PERMISSIONS}`);
      }
    }
  }

  // entrypoints + 资源
  const include = state.include;
  const covered = (p) => include.some((inc) => p === inc || p.startsWith(`${inc}/`));

  const ui = isPlainObject(manifest.entrypoints) ? manifest.entrypoints.ui : undefined;
  if (ui !== undefined) {
    if (!isPlainObject(ui)) {
      error("entrypoints.ui 必须是对象");
    } else {
      const extra = Object.keys(ui).filter((k) => k !== "root" && k !== "entry");
      if (extra.length) error(`entrypoints.ui 含未知字段: ${extra.join(", ")}`);
      if (ui.kind !== undefined) {
        error("entrypoints.ui.kind 已废弃", "DBX 插件 UI 永远是沙箱化的，请删除该字段。");
      }
      const entry = ui.entry;
      if (typeof entry !== "string" || entry === "") {
        error("entrypoints.ui.entry 是必需的非空字符串");
      } else {
        const reason = unsafePathReason(entry);
        if (reason) error(`entrypoints.ui.entry 路径不安全: ${reason}`);
        const root = typeof ui.root === "string" && ui.root !== "" ? ui.root : "ui";
        const rootReason = unsafePathReason(root);
        if (rootReason) error(`entrypoints.ui.root 路径不安全: ${rootReason}`);
        if (!entry.startsWith(root)) {
          error(
            `entrypoints.ui.entry "${entry}" 不在 root "${root}" 内`,
            'root 为 "ui" 时入口应写 "ui/index.html"，不是 "index.html"。',
          );
        }
        if (state.include.length === 0) {
          warn("缺少 [package].include，无法判断 UI 入口是否会被打包");
        } else {
          checkPackagedFile(entry, "entrypoints.ui.entry");
        }
      }
    }
  }

  const backend = isPlainObject(manifest.entrypoints) ? manifest.entrypoints.backend : undefined;
  if (backend !== undefined && backend !== null) {
    if (!isPlainObject(backend)) {
      error("entrypoints.backend 必须是对象");
    } else {
      const extra = Object.keys(backend).filter(
        (k) => k !== "protocol_versions" && k !== "transport" && k !== "executable",
      );
      if (extra.length) error(`entrypoints.backend 含未知字段: ${extra.join(", ")}`);
      if (backend.binaries !== undefined) {
        error("entrypoints.backend.binaries 已废弃", "每个平台打一个包，改用 executable。");
      }
      if (backend.protocol !== undefined) {
        error("entrypoints.backend.protocol 已废弃", "Manifest v1 使用 DBX JSON-RPC 协议，删除该字段。");
      }
      if (backend.transport !== undefined && !["stdio-jsonl", "stdio-framed"].includes(backend.transport)) {
        error(`entrypoints.backend.transport 非法: ${JSON.stringify(backend.transport)}`);
      }
      if (backend.protocol_versions !== undefined) {
        if (
          !Array.isArray(backend.protocol_versions) ||
          backend.protocol_versions.length === 0 ||
          backend.protocol_versions.some((v) => !Number.isInteger(v) || v < 1)
        ) {
          error("entrypoints.backend.protocol_versions 必须是非空正整数数组");
        } else if (new Set(backend.protocol_versions).size !== backend.protocol_versions.length) {
          error("entrypoints.backend.protocol_versions 不能有重复项");
        }
      }
      if (typeof backend.executable !== "string" || backend.executable === "") {
        error("entrypoints.backend.executable 是必需的非空字符串");
      } else {
        const reason = unsafePathReason(backend.executable);
        if (reason) error(`entrypoints.backend.executable 路径不安全: ${reason}`);
        if (backend.transport === "stdio-framed" && !(manifest.permissions ?? []).includes("host.binary")) {
          error(
            "声明了 stdio-framed 但没有 host.binary 权限",
            "二进制帧需要 host.binary。",
          );
        }
      }
    }
  }

  const hasManifestBackend = isPlainObject(backend);
  const hasTomlBackend = isPlainObject(state.toml?.backend);
  if (hasManifestBackend !== hasTomlBackend) {
    error(
      "manifest.json 与 dbx-plugin.toml 的 backend 声明不一致",
      "要么都声明，要么都省略；CLI 会在打包时直接报错。",
    );
  }

  if (typeof manifest.icon === "string" && manifest.icon !== "") {
    const reason = unsafePathReason(manifest.icon);
    if (reason) error(`icon 路径不安全: ${reason}`);
    else checkPackagedFile(manifest.icon, "manifest icon");
  }

  checkContributions(manifest, dir);
  checkLocalizations(manifest);
}

function checkPackagedFile(relPath, label) {
  const files = state.files;
  if (!files.has(relPath)) {
    error(`${label} "${relPath}" 在项目中不存在`);
    return;
  }
  if (state.include.length === 0) return;
  const covered = state.include.some((inc) => relPath === inc || relPath.startsWith(`${inc}/`));
  if (!covered) {
    error(
      `${label} "${relPath}" 未被 [package].include 覆盖`,
      `请把所在目录加入 include（当前: [${state.include.join(", ")}]）。`,
    );
  }
}

function checkContributions(manifest, dir) {
  if (manifest.contributions === undefined) return;
  if (!Array.isArray(manifest.contributions)) {
    error("contributions 必须是数组");
    return;
  }
  const declared = new Set();
  const usage = new Set();
  for (const contribution of manifest.contributions) {
    if (isPlainObject(contribution) && typeof contribution.id === "string") {
      if (declared.has(contribution.id)) error(`contributions 里 id 重复: ${contribution.id}`);
      declared.add(contribution.id);
    }
  }
  manifest.contributions.forEach((contribution, index) => {
    const at = `contributions[${index}]`;
    if (!isPlainObject(contribution)) {
      error(`${at} 必须是对象`);
      return;
    }
    const { type } = contribution;
    if (!CONTRIBUTION_TYPES.includes(type)) {
      error(`${at}.type 非法: ${JSON.stringify(type)}`, `允许: ${CONTRIBUTION_TYPES.join(", ")}`);
      return;
    }
    if (typeof contribution.id !== "string" || !IDENTIFIER.test(contribution.id)) {
      error(`${at}.id 非法: ${JSON.stringify(contribution.id)}`);
    }
    if (contribution.icon !== undefined) {
      const reason = unsafePathReason(contribution.icon);
      if (reason) error(`${at}.icon 路径不安全: ${reason}`);
      else if (!state.files.has(contribution.icon)) error(`${at}.icon "${contribution.icon}" 不存在`);
    }
    if (contribution.type !== "connection-provider" && (typeof contribution.label !== "string" || contribution.label === "")) {
      error(`${at}.label 是必需的非空字符串`);
    }
    if (["workbench", "filesystem-provider", "context-menu", "result-view"].includes(type)) {
      const extra = Object.keys(contribution).filter(
        (k) => !["type", "id", "label", "description", "icon"].includes(k),
      );
      if (type !== "filesystem-provider" && extra.length) {
        error(`${at} 含未知字段: ${extra.join(", ")}`);
      }
    }

    switch (type) {
      case "connection-provider":
        checkConnectionProvider(contribution, at, declared, usage);
        break;
      case "filesystem-provider":
        checkFilesystemProvider(contribution, at);
        break;
      case "context-menu":
        if (contribution.menu !== "connection") {
          error(`${at}.menu 必须是 "connection"（v1 仅支持该菜单）`);
        }
        break;
      default:
        break;
    }
  });

  for (const ref of usage) {
    if (!declared.has(ref)) {
      error(`贡献点引用 "${ref}" 但未在本插件声明`, "引用的 workbench / filesystem-provider 必须有对应的 contributions 条目。");
    }
  }
}

function checkConnectionProvider(contribution, at, declared, usage) {
  const allowed = [
    "type",
    "id",
    "label",
    "icon",
    "database_type",
    "description",
    "fields",
    "workbench",
    "filesystem_provider",
    "capabilities",
    "actions",
  ];
  const extra = Object.keys(contribution).filter((k) => !allowed.includes(k));
  if (extra.length) error(`${at} 含未知字段: ${extra.join(", ")}`);

  if (typeof contribution.database_type !== "string" || !IDENTIFIER.test(contribution.database_type)) {
    error(`${at}.database_type 是必需字段且必须是小写标识符（如 ssh、example-files）`);
  }
  if (!Array.isArray(contribution.fields)) {
    error(`${at}.fields 是必需字段且必须是数组`);
  } else {
    const keys = new Set();
    contribution.fields.forEach((field, i) => {
      const fAt = `${at}.fields[${i}]`;
      if (!isPlainObject(field)) {
        error(`${fAt} 必须是对象`);
        return;
      }
      const fieldAllowed = [
        "key",
        "label",
        "type",
        "description",
        "placeholder",
        "required",
        "default",
        "options",
        "binding",
        "visible_when",
        "required_when",
      ];
      const fieldExtra = Object.keys(field).filter((k) => !fieldAllowed.includes(k));
      if (fieldExtra.length) error(`${fAt} 含未知字段: ${fieldExtra.join(", ")}`);

      if (typeof field.key !== "string" || !IDENTIFIER.test(field.key)) error(`${fAt}.key 非法`);
      else if (keys.has(field.key)) error(`${fAt}.key 重复: ${field.key}`);
      else keys.add(field.key);
      if (typeof field.label !== "string" || field.label === "") error(`${fAt}.label 必须是非空字符串`);
      if (!FIELD_TYPES.includes(field.type)) {
        error(`${fAt}.type 非法: ${JSON.stringify(field.type)}`, `允许: ${FIELD_TYPES.join(", ")}`);
      }
      if (["select", "radio"].includes(field.type)) {
        if (!Array.isArray(field.options) || field.options.length === 0) {
          error(`${fAt} 是 ${field.type}，必须提供非空 options`);
        } else {
          field.options.forEach((option, oi) => {
            if (!isPlainObject(option) || typeof option.label !== "string" || option.label === "" || typeof option.value !== "string") {
              error(`${fAt}.options[${oi}] 必须是 { label: 非空字符串, value: 字符串 }`);
            } else if (Object.keys(option).some((k) => !["label", "value"].includes(k))) {
              error(`${fAt}.options[${oi}] 含未知字段`);
            }
          });
        }
      } else if (field.options !== undefined) {
        error(`${fAt} 的 type 是 ${field.type}，不允许出现 options`);
      }
      if (field.binding !== undefined) {
        if (!BINDINGS.includes(field.binding)) {
          error(`${fAt}.binding 非法: ${JSON.stringify(field.binding)}`, `允许: ${BINDINGS.join(", ")}`);
        } else {
          if (field.binding === "port" && field.type !== "number") error(`${fAt} binding 为 port 时 type 必须是 number`);
          if (TEXTUAL_BINDINGS.includes(field.binding) && !TEXTUAL_TYPES.includes(field.type)) {
            error(`${fAt} binding 为 ${field.binding} 时 type 只能是 ${TEXTUAL_TYPES.join("/")}`);
          }
        }
      }
      for (const conditionKey of ["visible_when", "required_when"]) {
        const condition = field[conditionKey];
        if (condition === undefined) continue;
        if (!isPlainObject(condition) || typeof condition.field !== "string" || !Array.isArray(condition.one_of) || condition.one_of.length === 0) {
          error(`${fAt}.${conditionKey} 必须是 { field: string, one_of: [至少 1 项] }`);
        } else if (Object.keys(condition).some((k) => !["field", "one_of"].includes(k))) {
          error(`${fAt}.${conditionKey} 含未知字段`);
        }
      }
    });
  }

  if (contribution.capabilities !== undefined) {
    if (!Array.isArray(contribution.capabilities) || contribution.capabilities.some((c) => !CAPABILITIES.includes(c))) {
      error(`${at}.capabilities 只能是 ${CAPABILITIES.join(" / ")}`);
    } else if (new Set(contribution.capabilities).size !== contribution.capabilities.length) {
      error(`${at}.capabilities 不能有重复项`);
    }
  }

  if (contribution.actions !== undefined) {
    if (!Array.isArray(contribution.actions)) error(`${at}.actions 必须是数组`);
    else {
      const actionIds = new Set();
      contribution.actions.forEach((action, ai) => {
        const aAt = `${at}.actions[${ai}]`;
        if (!isPlainObject(action)) {
          error(`${aAt} 必须是对象`);
          return;
        }
        const actionAllowed = [
          "id",
          "label",
          "description",
          "variant",
          "when",
          "close_on_success",
          "requires_valid_form",
          "timeout_ms",
        ];
        const actionExtra = Object.keys(action).filter((k) => !actionAllowed.includes(k));
        if (actionExtra.length) error(`${aAt} 含未知字段: ${actionExtra.join(", ")}`);
        if (typeof action.id !== "string" || !IDENTIFIER.test(action.id)) error(`${aAt}.id 非法`);
        else if (actionIds.has(action.id)) error(`${aAt}.id 重复`);
        else actionIds.add(action.id);
        if (typeof action.label !== "string" || action.label === "") error(`${aAt}.label 必须是非空字符串`);
        if (action.variant !== undefined && !ACTION_VARIANTS.includes(action.variant)) {
          error(`${aAt}.variant 非法: ${JSON.stringify(action.variant)}`);
        }
        if (action.when !== undefined && !ACTION_WHEN.includes(action.when)) {
          error(`${aAt}.when 非法: ${JSON.stringify(action.when)}`);
        }
        if (
          action.timeout_ms !== undefined &&
          (!Number.isInteger(action.timeout_ms) || action.timeout_ms < 1 || action.timeout_ms > 120000)
        ) {
          error(`${aAt}.timeout_ms 必须是 1–120000 的整数`);
        }
      });
    }
  }

  for (const refKey of ["workbench", "filesystem_provider"]) {
    const ref = contribution[refKey];
    if (ref === undefined) continue;
    if (typeof ref !== "string" || !IDENTIFIER.test(ref)) error(`${at}.${refKey} 非法: ${JSON.stringify(ref)}`);
    else usage.add(ref);
  }
}

function checkFilesystemProvider(contribution, at) {
  const allowed = ["type", "id", "label", "description", "icon", "schemes", "root_uri", "capabilities"];
  const extra = Object.keys(contribution).filter((k) => !allowed.includes(k));
  if (extra.length) error(`${at} 含未知字段: ${extra.join(", ")}`);

  if (!Array.isArray(contribution.schemes) || contribution.schemes.length === 0) {
    error(`${at}.schemes 是必需字段且必须是非空数组`);
  } else {
    for (const scheme of contribution.schemes) {
      if (typeof scheme !== "string" || !/^[a-z0-9][a-z0-9._:-]*$/.test(scheme)) {
        error(`${at}.schemes 含非法项: ${JSON.stringify(scheme)}`);
      }
    }
    if (new Set(contribution.schemes).size !== contribution.schemes.length) {
      error(`${at}.schemes 不能有重复项`);
    }
  }
  if (contribution.root_uri !== undefined) {
    const uri = contribution.root_uri;
    if (typeof uri !== "string" || uri.length < 2 || uri.length > 4096 || !/^[a-z0-9._-]+:.+$/.test(uri)) {
      error(`${at}.root_uri 非法: ${JSON.stringify(uri)}`, '形如 "s3://bucket"。');
    }
  }
  if (contribution.capabilities !== undefined) {
    if (
      !Array.isArray(contribution.capabilities) ||
      contribution.capabilities.some((c) => !FS_CAPABILITIES.includes(c))
    ) {
      error(`${at}.capabilities 只能是 ${FS_CAPABILITIES.join(" / ")}`);
    } else if (new Set(contribution.capabilities).size !== contribution.capabilities.length) {
      error(`${at}.capabilities 不能有重复项`);
    }
  }
}

function checkLocalizations(manifest) {
  const localizations = manifest.localizations;
  if (localizations === undefined) return;
  if (!isPlainObject(localizations)) {
    error("localizations 必须是对象");
    return;
  }
  for (const [locale, entry] of Object.entries(localizations)) {
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) {
      warn(`localizations 的 locale "${locale}" 不符合常见 BCP-47 形态`);
    }
    if (!isPlainObject(entry)) {
      error(`localizations["${locale}"] 必须是对象`);
      continue;
    }
    const extra = Object.keys(entry).filter((k) => !["name", "description", "contributions"].includes(k));
    if (extra.length) error(`localizations["${locale}"] 含未知字段: ${extra.join(", ")}`);
    if (entry.contributions === undefined) continue;
    if (!isPlainObject(entry.contributions)) {
      error(`localizations["${locale}"].contributions 必须是对象`);
      continue;
    }
    for (const [id, override] of Object.entries(entry.contributions)) {
      const at = `localizations["${locale}"].contributions["${id}"]`;
      if (!isPlainObject(override)) {
        error(`${at} 必须是对象`);
        continue;
      }
      const overrideExtra = Object.keys(override).filter(
        (k) => !["label", "description", "fields", "actions"].includes(k),
      );
      if (overrideExtra.length) error(`${at} 含未知字段: ${overrideExtra.join(", ")}`);
      if (override.fields !== undefined && !isPlainObject(override.fields)) error(`${at}.fields 必须是对象`);
      if (override.actions !== undefined && !isPlainObject(override.actions)) error(`${at}.actions 必须是对象`);
    }
  }
}

function checkToml(toml) {
  if (toml === undefined) {
    error("缺少 dbx-plugin.toml", "该文件决定打包包含哪些目录与是否构建原生后端。");
    return;
  }
  if (toml.schema_version !== 1) {
    error(`dbx-plugin.toml 的 schema_version 必须是 1（当前 ${JSON.stringify(toml.schema_version)}）`);
  }
  const topExtra = Object.keys(toml).filter((k) => !["schema_version", "backend", "package", "dev"].includes(k));
  if (topExtra.length) warn(`dbx-plugin.toml 含未知顶层键: ${topExtra.join(", ")}`);

  if (toml.backend !== undefined) {
    const backend = toml.backend;
    if (!isPlainObject(backend)) {
      error("dbx-plugin.toml 的 [backend] 必须是表");
    } else {
      const lang = backend.language;
      if (!["rust", "go", "golang"].includes(lang)) {
        error(`[backend].language 非法: ${JSON.stringify(lang)}`, "允许 rust / go / golang。");
      }
      const backendExtra = Object.keys(backend).filter((k) => !["language", "directory", "binary"].includes(k));
      if (backendExtra.length) warn(`[backend] 含未知键: ${backendExtra.join(", ")}`);
      const dirReason = safeRelativeReason(backend.directory);
      if (dirReason) error(`[backend].directory 非法: ${dirReason}`);
      if (typeof backend.binary !== "string" || backend.binary === "" || /[\\/]/.test(backend.binary) || backend.binary === "." || backend.binary === "..") {
        error(`[backend].binary 必须是纯文件名: ${JSON.stringify(backend.binary)}`);
      }
      const dir = typeof backend.directory === "string" ? backend.directory : "backend";
      if (lang === "rust" && !state.files.has(posix.join(dir, "Cargo.toml"))) {
        error(`Rust 后端缺少 ${dir}/Cargo.toml`);
      }
      if ((lang === "go" || lang === "golang") && !state.files.has(posix.join(dir, "go.mod"))) {
        error(`Go 后端缺少 ${dir}/go.mod`);
      }
    }
  }

  if (toml.package === undefined || !isPlainObject(toml.package)) {
    error("dbx-plugin.toml 缺少 [package] 段（需要 include）");
  } else if (!Array.isArray(toml.package.include)) {
    error("[package].include 必须是字符串数组");
  }

  if (toml.dev !== undefined) {
    if (!isPlainObject(toml.dev)) {
      error("dbx-plugin.toml 的 [dev] 必须是表");
    } else {
      const devExtra = Object.keys(toml.dev).filter((k) => !["ui_build", "ui_watch"].includes(k));
      if (devExtra.length) {
        error(
          `[dev] 含未支持的键: ${devExtra.join(", ")}`,
          "[dev] 使用 deny_unknown_fields，只允许 ui_build / ui_watch。",
        );
      }
      for (const key of ["ui_build", "ui_watch"]) {
        const value = toml.dev[key];
        if (value === undefined) continue;
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
          error(`[dev].${key} 必须是字符串数组（命令按参数数组执行，不经过 shell）`);
        } else if (value.length > 0 && value[0].trim() === "") {
          error(`[dev].${key} 的第一项必须是非空可执行文件名`);
        }
      }
    }
  }
}

function checkIncludes(toml) {
  const include = Array.isArray(toml?.package?.include) ? toml.package.include : [];
  for (const entry of include) {
    const reason = safeRelativeReason(entry);
    if (reason) {
      error(`[package].include 项 "${entry}" 非法: ${reason}`);
      continue;
    }
    const segments = entry.split(/[\\/]+/);
    if (segments.includes(".dbx-dev")) {
      error(`[package].include 不能包含 .dbx-dev: ${entry}`, "打包会直接拒绝开发数据目录。");
      continue;
    }
    const exists =
      state.files.has(entry) ||
      state.dirs.has(entry) ||
      [...state.files].some((f) => f.startsWith(`${entry}/`));
    if (!exists) error(`[package].include 项 "${entry}" 在项目中不存在`);
  }
  // 开发数据泄露检查
  const devFiles = [...state.files].filter((f) => f === ".dbx-dev" || f.startsWith(".dbx-dev/"));
  if (devFiles.length && include.some((inc) => inc === ".dbx-dev" || ".dbx-dev".startsWith(`${inc}/`))) {
    error("`.dbx-dev/` 会被打进包", "把 `.dbx-dev/` 加入 .gitignore 并从 [package].include 移除。");
  }
  if (devFiles.length && !existsSync(join(state.dir, ".gitignore"))) {
    warn("项目存在 `.dbx-dev/` 但没有 .gitignore", "该目录可能含明文凭据，请加入 .gitignore。");
  } else if (devFiles.length) {
    const gitignore = readFileSync(join(state.dir, ".gitignore"), "utf8");
    if (!gitignore.includes(".dbx-dev")) warn("`.dbx-dev/` 未出现在 .gitignore 中", "它可能含明文凭据。");
  }
}

// ---------------------------------------------------------------- 主流程

const state = { dir: process.cwd(), files: new Set(), dirs: new Set(), include: [], toml: undefined };

function main() {
  const args = process.argv.slice(2);
  const positional = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      jsonMode = true;
    } else if (arg === "--quiet") quiet = true;
    else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "用法: node check-project.mjs [项目目录] [--json] [--quiet]\n\n" +
          "打包前预检 DBX 插件项目：manifest.json / dbx-plugin.toml / include 覆盖 / 资源存在性。\n",
      );
      return;
    } else if (arg.startsWith("-")) {
      process.stderr.write(`未知选项: ${arg}\n`);
      process.exit(2);
    } else positional.push(arg);
  }

  let dir = resolve(positional[0] ?? ".");
  if (!existsSync(dir)) {
    process.stderr.write(`目录不存在: ${dir}\n`);
    process.exit(2);
  }
  if (!statSync(dir).isDirectory()) {
    process.stderr.write(`不是目录: ${dir}\n`);
    process.exit(2);
  }
  state.dir = dir;

  if (!existsSync(join(dir, "manifest.json"))) {
    error(`缺少 manifest.json（${dir}）`, "manifest.json 必须位于插件包根目录。是否为项目目录？");
    finish(json);
    return;
  }

  try {
    state.files = new Set(walkFiles(dir));
    state.dirs = new Set(walkDirs(dir));
  } catch (err) {
    error(`遍历项目文件失败: ${err.message}`);
    finish(json);
    return;
  }
  // 不把 dist / node_modules / target 当作项目内容，但保留用于 include 校验的判断
  const ignored = ["dist", "node_modules", "target", ".git", ".dbx-dev"];
  const notIgnored = (f) => !ignored.some((prefix) => f === prefix || f.startsWith(`${prefix}/`));
  state.files = new Set([...state.files].filter(notIgnored));
  state.dirs = new Set([...state.dirs].filter(notIgnored));

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    if (!isPlainObject(manifest)) {
      error("manifest.json 顶层必须是对象");
      finish(json);
      return;
    }
  } catch (err) {
    error(`manifest.json 解析失败: ${err.message}`);
    finish(json);
    return;
  }

  let toml;
  if (existsSync(join(dir, "dbx-plugin.toml"))) {
    try {
      toml = parseToml(readFileSync(join(dir, "dbx-plugin.toml"), "utf8"));
    } catch (err) {
      error(`dbx-plugin.toml 解析失败: ${err.message}`);
    }
  }
  state.toml = toml;
  state.include = Array.isArray(toml?.package?.include) ? toml.package.include : [];

  checkToml(toml);
  if (toml) checkIncludes(toml);
  checkManifest(dir, manifest);

  finish(json);
}

function finish(json) {
  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warn");
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: errors.length === 0,
          directory: state.dir,
          errors: errors.length,
          warnings: warnings.length,
          findings,
        },
        null,
        2,
      )}\n`,
    );
  } else if (!quiet) {
    process.stdout.write(
      `\n预检完成: ${errors.length} 个错误, ${warnings.length} 个警告（${state.dir}）\n`,
    );
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
