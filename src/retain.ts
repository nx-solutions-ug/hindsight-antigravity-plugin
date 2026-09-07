import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HindsightClient, RetainMemoryItem } from "./client.js";
import { HindsightPluginConfig } from "./config.js";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  stepIndex?: number;
}

const SYNTHETIC_TAG_RE =
  /<(hindsight_mental_models|hindsight_recalled_memories|hindsight_memory|hook_prompt|system-reminder)\b[\s\S]*?<\/\1>/gi;

/**
 * Remove injected synthetic memory tags to avoid echo cycles in Hindsight
 */
export function stripInjectedTags(text: string): string {
  return text.replace(SYNTHETIC_TAG_RE, "").trim();
}

/**
 * Read and parse turns from Antigravity JSONL transcript
 */
export function parseAntigravityTranscript(transcriptPath: string): ConversationTurn[] {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return [];
  }

  const raw = readFileSync(transcriptPath, "utf8");
  const turns: ConversationTurn[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const entry = JSON.parse(trimmed);
      const roleRaw = entry.role ?? entry.message?.role ?? entry.type;
      let role: "user" | "assistant" | undefined;

      if (roleRaw === "user" || roleRaw === "USER_INPUT") {
        role = "user";
      } else if (
        roleRaw === "assistant" ||
        roleRaw === "model" ||
        roleRaw === "PLANNER_RESPONSE"
      ) {
        role = "assistant";
      }

      if (!role) continue;

      let contentRaw =
        entry.content ??
        entry.text ??
        entry.message?.content ??
        entry.message?.text ??
        "";

      if (typeof contentRaw !== "string") {
        if (Array.isArray(contentRaw)) {
          contentRaw = contentRaw
            .map((c) => (typeof c === "string" ? c : c?.text || ""))
            .join("\n");
        } else {
          contentRaw = "";
        }
      }

      const cleanContent = stripInjectedTags(contentRaw);
      if (cleanContent) {
        turns.push({
          role,
          content: cleanContent,
          timestamp: entry.created_at ?? entry.timestamp,
          stepIndex: entry.step_index
        });
      }
    } catch {
      // Ignore unparseable lines
    }
  }

  return turns;
}

interface WatermarkData {
  lastRetainedTurnCount: number;
  lastRetainedTimestamp?: string;
}

function getWatermarkPath(conversationId: string): string {
  const dir = join(tmpdir(), "hindsight-antigravity", "watermarks");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Ignore
    }
  }
  const safeId = conversationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(dir, `${safeId}.json`);
}

/**
 * Retain new conversation turns for a conversation session
 */
export async function retainConversation(params: {
  conversationId: string;
  transcriptPath: string;
  client: HindsightClient;
  config: HindsightPluginConfig;
}): Promise<{ retained: boolean; turnsCount: number }> {
  const { conversationId, transcriptPath, client, config } = params;

  if (!config.autoRetain) {
    return { retained: false, turnsCount: 0 };
  }

  const allTurns = parseAntigravityTranscript(transcriptPath);
  if (allTurns.length === 0) {
    return { retained: false, turnsCount: 0 };
  }

  // Check watermark
  const watermarkPath = getWatermarkPath(conversationId);
  let lastRetainedCount = 0;
  if (existsSync(watermarkPath)) {
    try {
      const wm: WatermarkData = JSON.parse(readFileSync(watermarkPath, "utf8"));
      lastRetainedCount = wm.lastRetainedTurnCount || 0;
    } catch {
      // Ignore
    }
  }

  // Only retain turns that haven't been retained yet
  const newTurns = allTurns.slice(lastRetainedCount);
  if (newTurns.length === 0) {
    return { retained: false, turnsCount: 0 };
  }

  // Format new turns into a rich transcript segment
  const formattedDialogue = newTurns
    .map((t) => {
      const speaker = t.role === "user" ? "User" : "Assistant";
      const ts = t.timestamp ? `[${t.timestamp}] ` : "";
      return `${ts}${speaker}: ${t.content}`;
    })
    .join("\n\n");

  const tags: string[] = ["conversation", "antigravity", `session:${conversationId}`];
  if (config.bankScope === "per-project-tagged" && config.projectTag) {
    tags.push(config.projectTag);
  }

  const metadata: Record<string, string> = {
    conversation_id: conversationId,
    turns_count: String(newTurns.length),
    project: config.projectName,
    scope: config.bankScope
  };

  const item: RetainMemoryItem = {
    content: formattedDialogue,
    context: "conversation",
    tags,
    timestamp: new Date().toISOString(),
    metadata
  };

  try {
    await client.retain([item], true);

    // Update watermark
    try {
      const wm: WatermarkData = {
        lastRetainedTurnCount: allTurns.length,
        lastRetainedTimestamp: new Date().toISOString()
      };
      writeFileSync(watermarkPath, JSON.stringify(wm, null, 2), "utf8");
    } catch {
      // Ignore
    }

    return { retained: true, turnsCount: newTurns.length };
  } catch (err: any) {
    // Gracefully handle retain failure
    return { retained: false, turnsCount: 0 };
  }
}
