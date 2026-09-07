import { describe, expect, test } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAntigravityTranscript, stripInjectedTags } from "../src/retain.js";

describe("Conversation Retain & Autolearn", () => {
  test("stripInjectedTags cleans synthetic memory blocks", () => {
    const raw = `
      <hindsight_mental_models bank="test">
      Some model info
      </hindsight_mental_models>
      User's actual question: Where is the config file?
      <hindsight_recalled_memories bank="test" topic="config">
      Config is in /etc
      </hindsight_recalled_memories>
    `;

    const cleaned = stripInjectedTags(raw);
    expect(cleaned).not.toContain("<hindsight_mental_models");
    expect(cleaned).not.toContain("<hindsight_recalled_memories");
    expect(cleaned).toContain("User's actual question: Where is the config file?");
  });

  test("parseAntigravityTranscript parses JSONL turns correctly", () => {
    const tempFile = join(tmpdir(), `test-transcript-${Date.now()}.jsonl`);
    const lines = [
      JSON.stringify({
        step_index: 0,
        type: "USER_INPUT",
        content: "Please check the database status.",
        created_at: "2026-09-07T11:00:00Z"
      }),
      JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        content: "The database is running on port 5432.",
        created_at: "2026-09-07T11:00:15Z"
      }),
      JSON.stringify({
        step_index: 2,
        type: "USER_INPUT",
        content: "<hindsight_memory>noise</hindsight_memory>Can we restart it?",
        created_at: "2026-09-07T11:01:00Z"
      })
    ].join("\n");

    writeFileSync(tempFile, lines, "utf8");

    try {
      const turns = parseAntigravityTranscript(tempFile);
      expect(turns.length).toBe(3);
      expect(turns[0].role).toBe("user");
      expect(turns[0].content).toBe("Please check the database status.");
      expect(turns[1].role).toBe("assistant");
      expect(turns[1].content).toBe("The database is running on port 5432.");
      expect(turns[2].role).toBe("user");
      expect(turns[2].content).toBe("Can we restart it?");
    } finally {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }
    }
  });
});
