import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HindsightClient, MentalModelItem } from "./client.js";
import { HindsightPluginConfig } from "./config.js";

interface MentalModelCacheData {
  timestamp: number;
  bankId: string;
  bankScope: string;
  projectName: string;
  items: MentalModelItem[];
}

function getCacheFilePath(bankId: string, scope: string, projectName: string): string {
  const dir = join(tmpdir(), "hindsight-antigravity");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Ignore
    }
  }
  const safeBank = bankId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeProj = projectName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(dir, `mental-models-${safeBank}-${scope}-${safeProj}.json`);
}

/**
 * Fetch mental models for the configured bank and scope, using local cache if fresh
 */
export async function getMentalModels(
  client: HindsightClient,
  config: HindsightPluginConfig,
  forceRefresh = false
): Promise<MentalModelItem[]> {
  if (!config.mentalModelsEnabled) {
    return [];
  }

  const bankId = client.getBankId();
  const cachePath = getCacheFilePath(bankId, config.bankScope, config.projectName);
  const now = Date.now();

  // Try reading from cache
  if (!forceRefresh && existsSync(cachePath)) {
    try {
      const data: MentalModelCacheData = JSON.parse(readFileSync(cachePath, "utf8"));
      if (
        data.bankId === bankId &&
        data.bankScope === config.bankScope &&
        data.projectName === config.projectName &&
        now - data.timestamp < config.mentalModelsTtlMs
      ) {
        return data.items;
      }
    } catch {
      // Cache read failed, proceed to fetch
    }
  }

  // Fetch from Hindsight API (scoped by tag if per-project-tagged)
  try {
    const fetchParams: {
      bankId: string;
      detail: "metadata" | "content" | "full";
      tags?: string[];
      tags_match?: "any" | "all" | "exact";
    } = {
      bankId,
      detail: "content"
    };

    if (config.bankScope === "per-project-tagged" && config.projectTag) {
      fetchParams.tags = [config.projectTag];
      fetchParams.tags_match = "any";
    }

    const res = await client.listMentalModels(fetchParams);
    const items = res.items || [];

    // Save to cache
    try {
      const cacheData: MentalModelCacheData = {
        timestamp: now,
        bankId,
        bankScope: config.bankScope,
        projectName: config.projectName,
        items
      };
      writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), "utf8");
    } catch {
      // Ignore cache write error
    }

    return items;
  } catch (err: any) {
    // If API fails, fall back to cached data even if expired
    if (existsSync(cachePath)) {
      try {
        const data: MentalModelCacheData = JSON.parse(readFileSync(cachePath, "utf8"));
        return data.items;
      } catch {
        // Fall back to empty
      }
    }
    return [];
  }
}

/**
 * Format mental models for system prompt injection
 */
export function formatMentalModelsForPrompt(
  models: MentalModelItem[],
  bankId: string,
  scope: string = "per-project",
  projectName: string = ""
): string | null {
  if (!models || models.length === 0) {
    return null;
  }

  const sections = models
    .filter((m) => Boolean(m.content && m.content.trim()))
    .map((m) => {
      const tagsStr = m.tags && m.tags.length > 0 ? ` [tags: ${m.tags.join(", ")}]` : "";
      return `#### Mental Model: ${m.name} (${m.id})${tagsStr}\n${m.content!.trim()}`;
    });

  if (sections.length === 0) {
    return null;
  }

  const scopeAttr = scope ? ` scope="${scope}"` : "";
  const projAttr = projectName ? ` project="${projectName}"` : "";
  const scopeDesc = projectName ? ` [scope: ${scope}, project: ${projectName}]` : ` [scope: ${scope}]`;

  return `<hindsight_mental_models bank="${bankId}"${scopeAttr}${projAttr}>
The following persistent mental models (synthesized project context, coding standards, and architectural decisions) are active for memory bank "${bankId}"${scopeDesc}. Apply these conventions throughout your work:

${sections.join("\n\n")}
</hindsight_mental_models>`;
}
