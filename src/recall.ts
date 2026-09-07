import { HindsightClient, RecallResult } from "./client.js";
import { HindsightPluginConfig } from "./config.js";

const TRIVIAL_PROMPTS = new Set([
  "hi",
  "hello",
  "hey",
  "ok",
  "okay",
  "yes",
  "no",
  "yep",
  "sure",
  "thanks",
  "thank you",
  "proceed",
  "continue",
  "go ahead",
  "approved"
]);

/**
 * Check whether a user prompt warrants memory recall
 */
export function shouldPerformRecall(prompt: string): boolean {
  const clean = prompt.trim().toLowerCase().replace(/^[^\w]+|[^\w]+$/g, "");
  if (!clean || clean.length < 4) return false;
  if (TRIVIAL_PROMPTS.has(clean)) return false;
  return true;
}

/**
 * Automatically recall memories relevant to the user's prompt
 */
export async function recallForPrompt(
  prompt: string,
  client: HindsightClient,
  config: HindsightPluginConfig
): Promise<string | null> {
  if (!config.autoRecall || !shouldPerformRecall(prompt)) {
    return null;
  }

  try {
    const bankId = client.getBankId();
    // Bounded search query (up to 300 chars to focus the semantic embedding)
    const searchQuery = prompt.trim().slice(0, 300);

    const recallParams: {
      query: string;
      budget?: "low" | "mid" | "high";
      max_tokens?: number;
      tags?: string[];
      tags_match?: "any" | "all" | "any_strict" | "all_strict" | "exact";
    } = {
      query: searchQuery,
      budget: config.recallBudget,
      max_tokens: config.recallMaxTokens
    };

    if (config.bankScope === "per-project-tagged" && config.projectTag) {
      recallParams.tags = [config.projectTag];
      recallParams.tags_match = "any";
    }

    const resp = await client.recall(recallParams);
    const results = resp.results || [];
    if (results.length === 0) {
      return null;
    }

    return formatRecalledMemories(
      results,
      searchQuery,
      bankId,
      config.bankScope,
      config.projectName
    );
  } catch (err: any) {
    // Graceful degradation: never crash the agent prompt if recall fails
    return null;
  }
}

/**
 * Format recalled memories into an XML/Markdown injection block
 */
export function formatRecalledMemories(
  results: RecallResult[],
  query: string,
  bankId: string,
  scope: string = "per-project",
  projectName: string = ""
): string {
  // Deduplicate and filter empty texts
  const seen = new Set<string>();
  const facts: string[] = [];

  for (const r of results) {
    const text = (r.text || "").trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      const ctx = r.context && r.context !== "N/A" ? ` (${r.context})` : "";
      facts.push(`- ${text}${ctx}`);
    }
  }

  if (facts.length === 0) {
    return "";
  }

  // Display top 8 facts max to keep context token-efficient
  const displayedFacts = facts.slice(0, 8);
  const excerpt = query.length > 60 ? `${query.slice(0, 57)}...` : query;
  const scopeAttr = scope ? ` scope="${scope}"` : "";
  const projAttr = projectName ? ` project="${projectName}"` : "";

  return `<hindsight_recalled_memories bank="${bankId}" topic="${excerpt}"${scopeAttr}${projAttr}>
Relevant memories automatically recalled from Hindsight bank "${bankId}" for topic "${excerpt}":

${displayedFacts.join("\n")}

> 🧠 **Guidance**: Ground your decisions in these past learnings and conventions. If a memory conflicts with current code, verify against actual files.
</hindsight_recalled_memories>`;
}
