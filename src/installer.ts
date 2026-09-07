import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

export interface InstallOptions {
  global?: boolean;
  targetDir?: string;
  enable?: boolean;
}

export function installPlugin(opts: InstallOptions = {}): { targetDir: string; enabled: boolean } {
  const isGlobal = opts.global ?? true;
  const targetDir =
    opts.targetDir ||
    (isGlobal
      ? join(homedir(), ".gemini", "config", "plugins", "hindsight")
      : join(process.cwd(), ".agents", "plugins", "hindsight"));

  console.log(`Installing Hindsight Antigravity Plugin to: ${targetDir}`);

  // Create destination directory
  mkdirSync(targetDir, { recursive: true });

  // Files and directories to copy
  const entriesToCopy = [
    "plugin.json",
    "hooks.json",
    "mcp_config.json",
    "package.json",
    "dist",
    "bin",
    "rules",
    "skills"
  ];

  for (const entry of entriesToCopy) {
    const src = join(PROJECT_ROOT, entry);
    const dest = join(targetDir, entry);
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true, force: true });
      console.log(`  Copied ${entry}`);
    }
  }

  // Ensure plugin is enabled in config.json
  let enabled = false;
  if (opts.enable !== false) {
    const configPath = isGlobal
      ? join(homedir(), ".gemini", "config", "config.json")
      : join(process.cwd(), ".agents", "config.json");

    try {
      mkdirSync(dirname(configPath), { recursive: true });
      let cfg: Record<string, any> = {};
      if (existsSync(configPath)) {
        try {
          cfg = JSON.parse(readFileSync(configPath, "utf8"));
        } catch {
          cfg = {};
        }
      }
      cfg.plugins = cfg.plugins || {};
      cfg.plugins["hindsight"] = { enabled: true };
      writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
      console.log(`  Enabled plugin in ${configPath}`);
      enabled = true;
    } catch (err: any) {
      console.warn(`  Could not write to config.json: ${err.message}`);
    }
  }

  console.log("\nInstallation complete! Hindsight plugin is ready.");
  return { targetDir, enabled };
}

// Entrypoint is invoked via bin/install.js


