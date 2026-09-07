import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { HindsightClient } from "../src/client.js";
import { retainConversation } from "../src/retain.js";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Hindsight Bank Scoping", () => {
  test("per-project-tagged mode sets projectTag and preserves shared bankId", () => {
    const config = loadConfig({
      env: {
        HINDSIGHT_BANK_ID: "pi-memory",
        HINDSIGHT_BANK_SCOPE: "per-project-tagged",
        HINDSIGHT_PROJECT_NAME: "chronova",
        HINDSIGHT_PROJECT_TAG_PREFIX: "project:"
      }
    });

    expect(config.bankScope).toBe("per-project-tagged");
    expect(config.bankId).toBe("pi-memory");
    expect(config.projectName).toBe("chronova");
    expect(config.projectTag).toBe("project:chronova");
  });

  test("per-project mode resolves bankId to projectName or bankIdTemplate", () => {
    const directConfig = loadConfig({
      env: {
        HINDSIGHT_BANK_SCOPE: "per-project",
        HINDSIGHT_PROJECT_NAME: "payment-api"
      }
    });

    expect(directConfig.bankScope).toBe("per-project");
    expect(directConfig.bankId).toBe("payment-api");
    expect(directConfig.projectTag).toBeUndefined();

    const templatedConfig = loadConfig({
      env: {
        HINDSIGHT_BANK_SCOPE: "per-project",
        HINDSIGHT_PROJECT_NAME: "payment-api",
        HINDSIGHT_BANK_ID_TEMPLATE: "pi-memory-{project}"
      }
    });

    expect(templatedConfig.bankScope).toBe("per-project");
    expect(templatedConfig.bankId).toBe("pi-memory-payment-api");
    expect(templatedConfig.projectTag).toBeUndefined();
  });

  test("global mode uses designated bankId without project tags", () => {
    const config = loadConfig({
      env: {
        HINDSIGHT_BANK_ID: "central-org-memory",
        HINDSIGHT_BANK_SCOPE: "global"
      }
    });

    expect(config.bankScope).toBe("global");
    expect(config.bankId).toBe("central-org-memory");
    expect(config.projectTag).toBeUndefined();
  });

  test("retainConversation adds project tag in per-project-tagged mode", async () => {
    const config = loadConfig({
      env: {
        HINDSIGHT_BANK_ID: "pi-memory",
        HINDSIGHT_BANK_SCOPE: "per-project-tagged",
        HINDSIGHT_PROJECT_NAME: "demo-app"
      }
    });

    let retainedTags: string[] | undefined;
    let retainedMetadata: any;

    const mockClient = {
      getBankId: () => config.bankId,
      retain: async (items: any[]) => {
        retainedTags = items[0]?.tags;
        retainedMetadata = items[0]?.metadata;
        return { success: true, items_count: items.length };
      }
    } as unknown as HindsightClient;

    const tempFile = join(tmpdir(), `test-scoping-transcript-${Date.now()}.jsonl`);
    writeFileSync(
      tempFile,
      JSON.stringify({
        step_index: 0,
        type: "USER_INPUT",
        content: "Hello world"
      }) +
        "\n" +
        JSON.stringify({
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "Hi there"
        }) +
        "\n",
      "utf8"
    );

    try {
      const result = await retainConversation({
        conversationId: `conv-scope-${Date.now()}`,
        transcriptPath: tempFile,
        client: mockClient,
        config
      });

      expect(result.retained).toBe(true);
      expect(retainedTags).toBeDefined();
      expect(retainedTags).toContain("project:demo-app");
      expect(retainedMetadata.project).toBe("demo-app");
      expect(retainedMetadata.scope).toBe("per-project-tagged");
    } finally {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }
    }
  });
});
