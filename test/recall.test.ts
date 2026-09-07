import { describe, expect, test } from "bun:test";
import { formatRecalledMemories, shouldPerformRecall } from "../src/recall.js";
import { RecallResult } from "../src/client.js";

describe("Automatic Topic Recall", () => {
  test("shouldPerformRecall filters out trivial affirmations and short strings", () => {
    expect(shouldPerformRecall("")).toBe(false);
    expect(shouldPerformRecall("hi")).toBe(false);
    expect(shouldPerformRecall("ok")).toBe(false);
    expect(shouldPerformRecall("yes")).toBe(false);
    expect(shouldPerformRecall("thank you")).toBe(false);
    expect(shouldPerformRecall("proceed")).toBe(false);

    expect(shouldPerformRecall("How do we deploy the auth service?")).toBe(true);
    expect(shouldPerformRecall("What database credentials are used in testing?")).toBe(true);
  });

  test("formatRecalledMemories formats and deduplicates results", () => {
    const results: RecallResult[] = [
      {
        id: "1",
        text: "Database migrations run via Prisma in Docker Compose.",
        context: "architecture"
      },
      {
        id: "2",
        text: "Database migrations run via Prisma in Docker Compose.",
        context: "duplicate"
      },
      {
        id: "3",
        text: "JWT tokens expire after 15 minutes.",
        context: "security"
      }
    ];

    const formatted = formatRecalledMemories(
      results,
      "database and auth",
      "my-bank",
      "per-project-tagged",
      "auth-service"
    );
    expect(formatted).toContain('<hindsight_recalled_memories bank="my-bank" topic="database and auth" scope="per-project-tagged" project="auth-service">');
    expect(formatted).toContain("- Database migrations run via Prisma in Docker Compose. (architecture)");
    expect(formatted).toContain("- JWT tokens expire after 15 minutes. (security)");
    expect(formatted).toContain("</hindsight_recalled_memories>");
    // Verify deduplication
    const count = (formatted.match(/Database migrations run via Prisma/g) || []).length;
    expect(count).toBe(1);
  });
});
