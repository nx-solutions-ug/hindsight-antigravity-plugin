import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_BANK_ID_TEMPLATE,
  configPath,
  describeServer,
  readConfig,
  writeConfig,
  type CodingAgentConfig
} from "../src/config.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hindsight-config-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** The config file inside the throwaway home, without going through `configPath`. */
const configFile = (): string => join(home, ".hindsight", "coding-agent.json");

function writeRaw(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

describe("configPath", () => {
  test("defaults to <home>/.hindsight/coding-agent.json", () => {
    expect(configPath({ home, env: {} })).toBe(configFile());
  });

  test("HINDSIGHT_CONFIG relocates the file", () => {
    const relocated = join(home, "elsewhere", "custom.json");

    expect(configPath({ home, env: { HINDSIGHT_CONFIG: relocated } })).toBe(relocated);
  });

  test("an empty or blank HINDSIGHT_CONFIG falls back to the home-relative default", () => {
    expect(configPath({ home, env: { HINDSIGHT_CONFIG: "" } })).toBe(configFile());
    expect(configPath({ home, env: { HINDSIGHT_CONFIG: "   " } })).toBe(configFile());
  });
});

describe("readConfig", () => {
  test("reads the runtime's config file", () => {
    writeRaw(configFile(), JSON.stringify({ serverMode: "cloud", apiPort: 9077 }));

    const config = readConfig(configFile());

    expect(config.serverMode).toBe("cloud");
    expect(config.apiPort).toBe(9077);
  });

  test("a missing file reads as an empty config", () => {
    expect(readConfig(join(home, "nope", "coding-agent.json"))).toEqual({});
  });

  test("malformed JSON reads as an empty config rather than throwing", () => {
    writeRaw(configFile(), "{ this is not json");

    expect(readConfig(configFile())).toEqual({});
  });

  test("a JSON value that is not an object reads as an empty config", () => {
    writeRaw(configFile(), "[1, 2, 3]");
    expect(readConfig(configFile())).toEqual({});

    writeRaw(configFile(), '"a string"');
    expect(readConfig(configFile())).toEqual({});
  });

  test("preserves settings this plugin does not know about", () => {
    writeRaw(
      configFile(),
      JSON.stringify({ apiUrl: "https://memory.example", somethingNewer: { nested: true } })
    );

    const config = readConfig(configFile());

    expect(config.apiUrl).toBe("https://memory.example");
    expect(config.somethingNewer).toEqual({ nested: true });
  });
});

describe("writeConfig", () => {
  test("creates parent directories and writes 2-space JSON with a trailing newline", () => {
    const target = join(home, "deep", "nested", "coding-agent.json");

    writeConfig({ serverMode: "daemon", apiPort: 9077 }, target);

    const text = readFileSync(target, "utf8");
    expect(text).toBe(`${JSON.stringify({ serverMode: "daemon", apiPort: 9077 }, null, 2)}\n`);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "serverMode"');
  });

  test("round-trips through readConfig", () => {
    const config: CodingAgentConfig = {
      bankIdTemplate: DEFAULT_BANK_ID_TEMPLATE,
      harnesses: { "antigravity-cli": { disabled: false } },
      banks: { "coding-agent::demo": { note: "keep" } }
    };

    writeConfig(config, configFile());

    expect(readConfig(configFile())).toEqual(config);
    expect(DEFAULT_BANK_ID_TEMPLATE).toBe("coding-agent::{gitProject}");
  });

  test("backs the user's file up once, and never overwrites that backup", () => {
    const original = '{ "apiUrl": "https://original.example" }';
    writeRaw(configFile(), original);

    writeConfig({ apiUrl: "https://first.example" }, configFile());
    writeConfig({ apiUrl: "https://second.example" }, configFile());

    const backup = `${configFile()}.hindsight-backup`;
    expect(readFileSync(backup, "utf8")).toBe(original);
    expect(readConfig(configFile()).apiUrl).toBe("https://second.example");
  });

  test("writes no backup when there was no file to back up", () => {
    writeConfig({ apiUrl: "https://fresh.example" }, configFile());

    expect(existsSync(`${configFile()}.hindsight-backup`)).toBe(false);
    expect(existsSync(configFile())).toBe(true);
  });
});

describe("describeServer", () => {
  test("defaults to the hosted cloud server when nothing is configured", () => {
    const description = describeServer({}, {});

    expect(description.mode).toBe("cloud");
    expect(description.source).toBe("default");
    expect(description.hasToken).toBe(false);
    expect(description.apiUrl).toStartWith("https://");
  });

  test("falls back to the environment when the file says nothing", () => {
    const description = describeServer(
      {},
      { HINDSIGHT_API_URL: "https://env.example", HINDSIGHT_API_TOKEN: "env-token" }
    );

    expect(description.source).toBe("env");
    expect(description.apiUrl).toBe("https://env.example");
    expect(description.mode).toBe("self-hosted");
    expect(description.hasToken).toBe(true);
  });

  test("the file wins over the environment", () => {
    const description = describeServer(
      { apiUrl: "https://file.example", serverMode: "self-hosted" },
      { HINDSIGHT_API_URL: "https://env.example", HINDSIGHT_SERVER_MODE: "cloud" }
    );

    expect(description.source).toBe("config");
    expect(description.apiUrl).toBe("https://file.example");
    expect(description.mode).toBe("self-hosted");
  });

  test("a daemon reports its loopback endpoint", () => {
    const description = describeServer({ serverMode: "daemon", apiPort: 9123 }, {});

    expect(description.mode).toBe("daemon");
    expect(description.source).toBe("config");
    expect(description.apiUrl).toBe("http://127.0.0.1:9123");
  });

  test("an unknown server mode in the file is ignored, not propagated", () => {
    // What a hand-edited file can actually contain: a mode the runtime does not define.
    const config = JSON.parse('{ "serverMode": "teleport" }') as CodingAgentConfig;

    const description = describeServer(config, {});

    expect(["cloud", "self-hosted", "daemon"]).toContain(description.mode);
    expect(description.mode).toBe("cloud");
  });

  test("reports that a token exists without ever handing it back", () => {
    const token = "sk-super-secret-value";

    const fromFile = describeServer({ apiToken: token }, {});
    const fromEnv = describeServer({}, { HINDSIGHT_API_TOKEN: token });
    const blank = describeServer({ apiToken: "   " }, {});

    expect(fromFile.hasToken).toBe(true);
    expect(fromEnv.hasToken).toBe(true);
    expect(blank.hasToken).toBe(false);

    for (const description of [fromFile, fromEnv, blank]) {
      expect(JSON.stringify(description)).not.toContain(token);
      expect(Object.values(description)).not.toContain(token);
    }
  });
});
