import { describe, expect, test } from "bun:test";
import {
  deriveFallbackBankId,
  loadConfig,
  parseIniConfig
} from "../src/config.js";

describe("Configuration System", () => {
  test("parseIniConfig correctly parses simple key-value pairs with quotes and comments", () => {
    const sample = `
      # This is a comment
      api_url = "https://api.refz.link"
      api_key = 'secret-key-123'
      bank_id = my-bank
      ; Another comment
      empty_val =
    `;
    const parsed = parseIniConfig(sample);
    expect(parsed.api_url).toBe("https://api.refz.link");
    expect(parsed.api_key).toBe("secret-key-123");
    expect(parsed.bank_id).toBe("my-bank");
  });

  test("deriveFallbackBankId returns sanitized repository or directory name", () => {
    const bankId = deriveFallbackBankId(process.cwd());
    expect(typeof bankId).toBe("string");
    expect(bankId.length).toBeGreaterThan(0);
    expect(bankId).toMatch(/^[a-z0-9_-]+$/);
  });

  test("loadConfig respects environment variable overrides", () => {
    const customEnv: Record<string, string> = {
      HINDSIGHT_API_URL: "https://custom.hindsight.io/",
      HINDSIGHT_API_KEY: "test-token",
      HINDSIGHT_BANK_ID: "special_bank_99",
      HINDSIGHT_AUTO_RECALL: "false",
      HINDSIGHT_AUTO_RETAIN: "true",
      HINDSIGHT_MENTAL_MODELS: "true"
    };

    const config = loadConfig({ env: customEnv });
    expect(config.apiUrl).toBe("https://custom.hindsight.io");
    expect(config.apiKey).toBe("test-token");
    expect(config.bankId).toBe("special_bank_99");
    expect(config.autoRecall).toBe(false);
    expect(config.autoRetain).toBe(true);
    expect(config.mentalModelsEnabled).toBe(true);
  });
});
