import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";

export type BankScopingMode = "per-project-tagged" | "per-project" | "global";

export interface HindsightPluginConfig {
  apiUrl: string;
  apiKey?: string;
  bankId: string;
  bankScope: BankScopingMode;
  projectName: string;
  projectTagPrefix: string;
  projectTag?: string;
  bankIdTemplate?: string;
  autoRecall: boolean;
  autoRetain: boolean;
  mentalModelsEnabled: boolean;
  mentalModelsTtlMs: number;
  recallBudget: "low" | "mid" | "high";
  recallMaxTokens: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface ConfigResolutionOptions {
  cwd?: string;
  explicitPath?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Parse an INI/TOML-like simple key-value file such as ~/.hindsight/config
 */
export function parseIniConfig(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Read and parse a JSON config file safely
 */
function readJsonConfig(path: string): Record<string, any> {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8"));
    }
  } catch {
    // Ignore invalid JSON syntax or read error
  }
  return {};
}

/**
 * Derives a sanitized project name from git repo or folder name
 */
export function deriveProjectName(cwd: string): string {
  try {
    const gitTop = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000
    }).trim();
    if (gitTop) {
      return sanitizeIdentifier(basename(gitTop));
    }
  } catch {
    // Not a git repo or git not found
  }
  return sanitizeIdentifier(basename(cwd || process.cwd()) || "default");
}

export function sanitizeIdentifier(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "default";
}

export const deriveFallbackBankId = deriveProjectName;

/**
 * Resolve Hindsight configuration following precedence rules:
 * 1. Explicit path / Local workspace config
 * 2. Environment variables
 * 3. Global config (~/.hindsight/config or ~/.hindsight/coding-agent.json)
 * 4. Defaults, bank scoping, and dynamic project derivation
 */
export function loadConfig(opts: ConfigResolutionOptions = {}): HindsightPluginConfig {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;

  // 1. Check Global ~/.hindsight/config (INI) and ~/.hindsight/coding-agent.json
  const home = homedir();
  let globalIni: Record<string, string> = {};
  const globalIniPath = join(home, ".hindsight", "config");
  if (existsSync(globalIniPath)) {
    try {
      globalIni = parseIniConfig(readFileSync(globalIniPath, "utf8"));
    } catch {
      // Ignore
    }
  }

  const globalJson = readJsonConfig(join(home, ".hindsight", "coding-agent.json"));

  // 2. Check Workspace Config
  const candidateLocalPaths = [
    opts.explicitPath,
    join(cwd, ".hindsight.json"),
    join(cwd, "hindsight.config.json"),
    join(cwd, ".hindsightrc")
  ].filter((p): p is string => Boolean(p));

  let localConfig: Record<string, any> = {};
  for (const p of candidateLocalPaths) {
    if (existsSync(p)) {
      localConfig = readJsonConfig(p);
      break;
    }
  }

  // 3. Resolve API URL
  const apiUrl = (
    env.HINDSIGHT_API_URL ||
    localConfig.apiUrl ||
    localConfig.api_url ||
    globalIni.api_url ||
    globalJson.apiUrl ||
    "https://api.refz.link"
  ).replace(/\/$/, "");

  // 4. Resolve API Key / Token
  const apiKey =
    env.HINDSIGHT_API_KEY ||
    env.HINDSIGHT_API_TOKEN ||
    localConfig.apiKey ||
    localConfig.api_key ||
    localConfig.apiToken ||
    globalIni.api_key ||
    globalIni.api_token ||
    globalJson.apiToken ||
    undefined;

  // 5. Resolve Project Name
  const rawProjectName =
    env.HINDSIGHT_PROJECT_NAME ||
    localConfig.projectName ||
    localConfig.project_name ||
    deriveProjectName(cwd);
  const projectName = sanitizeIdentifier(String(rawProjectName));

  const projectTagPrefix =
    env.HINDSIGHT_PROJECT_TAG_PREFIX ||
    localConfig.projectTagPrefix ||
    localConfig.project_tag_prefix ||
    "project:";

  // 6. Resolve Bank Scoping Mode: "per-project-tagged" | "per-project" | "global"
  const rawScope = (
    env.HINDSIGHT_BANK_SCOPE ||
    localConfig.bankScope ||
    localConfig.bank_scope ||
    globalIni.bank_scope ||
    ""
  ).toLowerCase();

  let bankScope: BankScopingMode;
  if (rawScope === "per-project-tagged" || rawScope === "per-project" || rawScope === "global") {
    bankScope = rawScope;
  } else {
    // Smart default:
    // If a shared bank ID is explicitly provided, default to per-project-tagged
    // If bankIdTemplate or no bank ID is set, default to per-project
    const rawBankId =
      env.HINDSIGHT_BANK_ID ||
      env.HINDSIGHT_BANK ||
      localConfig.bankId ||
      localConfig.bank_id ||
      globalIni.bank_id ||
      globalJson.bankId;

    if (rawBankId && !String(rawBankId).includes("{project}")) {
      bankScope = "per-project-tagged";
    } else {
      bankScope = "per-project";
    }
  }

  // 7. Resolve Bank ID & Bank Template
  const bankIdTemplate =
    env.HINDSIGHT_BANK_ID_TEMPLATE ||
    localConfig.bankIdTemplate ||
    localConfig.bank_id_template ||
    undefined;

  const rawBankId =
    env.HINDSIGHT_BANK_ID ||
    env.HINDSIGHT_BANK ||
    localConfig.bankId ||
    localConfig.bank_id ||
    globalIni.bank_id ||
    globalJson.bankId;

  let bankId: string;
  if (bankScope === "per-project") {
    if (bankIdTemplate) {
      bankId = sanitizeIdentifier(bankIdTemplate.replace(/\{project\}/g, projectName));
    } else if (rawBankId && String(rawBankId).includes("{project}")) {
      bankId = sanitizeIdentifier(String(rawBankId).replace(/\{project\}/g, projectName));
    } else if (rawBankId) {
      bankId = sanitizeIdentifier(String(rawBankId));
    } else {
      bankId = projectName;
    }
  } else {
    // per-project-tagged or global: bankId is the designated shared bank
    bankId = rawBankId ? sanitizeIdentifier(String(rawBankId)) : projectName;
  }

  // 8. Calculate Effective Project Tag
  const projectTag = bankScope === "per-project-tagged" ? `${projectTagPrefix}${projectName}` : undefined;

  // 9. Booleans & Feature Flags
  const autoRecall =
    env.HINDSIGHT_AUTO_RECALL !== undefined
      ? ["1", "true", "yes", "on"].includes(env.HINDSIGHT_AUTO_RECALL.toLowerCase())
      : localConfig.autoRecall ?? true;

  const autoRetain =
    env.HINDSIGHT_AUTO_RETAIN !== undefined
      ? ["1", "true", "yes", "on"].includes(env.HINDSIGHT_AUTO_RETAIN.toLowerCase())
      : localConfig.autoRetain ?? true;

  const mentalModelsEnabled =
    env.HINDSIGHT_MENTAL_MODELS !== undefined
      ? ["1", "true", "yes", "on"].includes(env.HINDSIGHT_MENTAL_MODELS.toLowerCase())
      : localConfig.mentalModelsEnabled ?? true;

  const mentalModelsTtlMs =
    Number(env.HINDSIGHT_MENTAL_MODELS_TTL_MS || localConfig.mentalModelsTtlMs) || 5 * 60 * 1000;

  const rawBudget = (env.HINDSIGHT_RECALL_BUDGET || localConfig.recallBudget || "mid").toLowerCase();
  const recallBudget: "low" | "mid" | "high" = ["low", "mid", "high"].includes(rawBudget)
    ? (rawBudget as "low" | "mid" | "high")
    : "mid";

  const recallMaxTokens =
    Number(env.HINDSIGHT_RECALL_MAX_TOKENS || localConfig.recallMaxTokens) || 2048;

  const rawLogLevel = (env.HINDSIGHT_LOG_LEVEL || localConfig.logLevel || "info").toLowerCase();
  const logLevel: "debug" | "info" | "warn" | "error" = ["debug", "info", "warn", "error"].includes(
    rawLogLevel
  )
    ? (rawLogLevel as "debug" | "info" | "warn" | "error")
    : "info";

  return {
    apiUrl,
    apiKey,
    bankId,
    bankScope,
    projectName,
    projectTagPrefix,
    projectTag,
    bankIdTemplate,
    autoRecall,
    autoRetain,
    mentalModelsEnabled,
    mentalModelsTtlMs,
    recallBudget,
    recallMaxTokens,
    logLevel
  };
}
