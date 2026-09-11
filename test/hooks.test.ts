import { afterEach, describe, expect, test } from "bun:test";
import { HARNESS, MCP_HARNESS_ENV, type RuntimeEntry } from "../src/harness.js";
import { delegateToRuntime } from "../src/hooks/delegate.js";
import { PRE_INVOCATION_FALLBACK, runPreInvocation } from "../src/hooks/pre-invocation.js";
import { STOP_FALLBACK, runStopHook } from "../src/hooks/stop-hook.js";
import { runServer } from "../src/mcp/server.js";
import { runStatusLine } from "../src/statusline.js";

/** Collects everything a wrapper writes, so no test ever reaches the real stdio. */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const seen: RuntimeEntry[] = [];

  return {
    out,
    err,
    seen,
    stdout: (chunk: string) => void out.push(chunk),
    stderr: (chunk: string) => void err.push(chunk),
    /** Stands in for the runtime: records the entry and succeeds without importing anything. */
    ok: async (entry: RuntimeEntry) => void seen.push(entry),
    /** Stands in for a runtime that cannot be started at all. */
    fail: (message = "runtime missing") =>
      async (entry: RuntimeEntry): Promise<void> => {
        seen.push(entry);
        throw new Error(message);
      },
    stdoutText: () => out.join(""),
    stderrText: () => err.join("")
  };
}

describe("delegateToRuntime", () => {
  test("runs the entry and writes nothing when the runtime starts", async () => {
    const io = capture();

    const ok = await delegateToRuntime({
      entry: "antigravity-hook.js",
      fallback: "FALLBACK",
      run: io.ok,
      stdout: io.stdout,
      stderr: io.stderr
    });

    expect(ok).toBe(true);
    expect(io.seen).toEqual(["antigravity-hook.js"]);
    expect(io.stdoutText()).toBe("");
    expect(io.stderrText()).toBe("");
  });

  test("writes the fallback and a hindsight: diagnostic when the runtime cannot start", async () => {
    const io = capture();

    const ok = await delegateToRuntime({
      entry: "antigravity-hook.js",
      fallback: "FALLBACK",
      run: io.fail("boom"),
      stdout: io.stdout,
      stderr: io.stderr
    });

    expect(ok).toBe(false);
    expect(io.stdoutText()).toBe("FALLBACK");
    expect(io.stderrText()).toBe("hindsight: boom\n");
  });

  test("reports a non-Error rejection without throwing", async () => {
    const io = capture();

    const ok = await delegateToRuntime({
      entry: "mcp-server.js",
      fallback: "",
      run: async () => {
        throw "just a string";
      },
      stdout: io.stdout,
      stderr: io.stderr
    });

    expect(ok).toBe(false);
    expect(io.stderrText()).toBe("hindsight: just a string\n");
    expect(io.stdoutText()).toBe("");
  });
});

describe("PreInvocation hook", () => {
  test("delegates to the runtime's antigravity-hook entry", async () => {
    const io = capture();

    const ok = await runPreInvocation({ run: io.ok, stdout: io.stdout, stderr: io.stderr });

    expect(ok).toBe(true);
    expect(io.seen).toEqual(["antigravity-hook.js"]);
    expect(io.stdoutText()).toBe("");
    expect(io.stderrText()).toBe("");
  });

  test("answers with an empty injectSteps reply when the runtime is unavailable", async () => {
    const io = capture();

    const ok = await runPreInvocation({
      run: io.fail("runtime gone"),
      stdout: io.stdout,
      stderr: io.stderr
    });

    expect(ok).toBe(false);
    expect(io.stdoutText()).toBe(PRE_INVOCATION_FALLBACK);
    expect(PRE_INVOCATION_FALLBACK).toBe('{"injectSteps":[]}\n');
    expect(JSON.parse(io.stdoutText()) as unknown).toEqual({ injectSteps: [] });
    expect(io.stderrText()).toStartWith("hindsight: ");
    expect(io.stderrText()).toEndWith("\n");
  });

  test("never throws, whatever the runtime does", async () => {
    const io = capture();

    await expect(
      runPreInvocation({ run: io.fail(), stdout: io.stdout, stderr: io.stderr })
    ).resolves.toBe(false);
  });

  test("the caller cannot override the entry or the fallback", async () => {
    const io = capture();

    const ok = await runPreInvocation({
      entry: "mcp-server.js",
      fallback: "nope",
      run: io.fail(),
      stdout: io.stdout,
      stderr: io.stderr
    });

    expect(ok).toBe(false);
    expect(io.seen).toEqual(["antigravity-hook.js"]);
    expect(io.stdoutText()).toBe(PRE_INVOCATION_FALLBACK);
  });
});

describe("Stop hook", () => {
  test("delegates to the runtime's antigravity-stop-hook entry", async () => {
    const io = capture();

    const ok = await runStopHook({ run: io.ok, stdout: io.stdout, stderr: io.stderr });

    expect(ok).toBe(true);
    expect(io.seen).toEqual(["antigravity-stop-hook.js"]);
    expect(io.stdoutText()).toBe("");
    expect(io.stderrText()).toBe("");
  });

  test("answers with an empty object when the runtime is unavailable", async () => {
    const io = capture();

    const ok = await runStopHook({
      run: io.fail("runtime gone"),
      stdout: io.stdout,
      stderr: io.stderr
    });

    expect(ok).toBe(false);
    expect(io.stdoutText()).toBe(STOP_FALLBACK);
    expect(STOP_FALLBACK).toBe("{}\n");
    expect(JSON.parse(io.stdoutText()) as unknown).toEqual({});
    expect(io.stderrText()).toStartWith("hindsight: ");
  });
});

describe("Status line", () => {
  test("delegates to the runtime's statusline entry", async () => {
    const io = capture();

    const ok = await runStatusLine({ run: io.ok, stdout: io.stdout, stderr: io.stderr });

    expect(ok).toBe(true);
    expect(io.seen).toEqual(["antigravity-statusline.js"]);
    expect(io.stdoutText()).toBe("");
  });

  test("writes nothing to stdout when the runtime is unavailable", async () => {
    const io = capture();

    const ok = await runStatusLine({
      run: io.fail("runtime gone"),
      stdout: io.stdout,
      stderr: io.stderr
    });

    // The host renders stdout verbatim: a fallback would be shown to the user as their status line.
    expect(ok).toBe(false);
    expect(io.stdoutText()).toBe("");
    expect(io.stderrText()).toStartWith("hindsight: ");
  });
});

describe("MCP server", () => {
  const previousExitCode = process.exitCode;

  afterEach(() => {
    // `runServer` marks a failed start on the process; keep that out of the test run's own status.
    process.exitCode = previousExitCode;
  });

  test("tells the runtime which harness is asking", async () => {
    const io = capture();
    const env: NodeJS.ProcessEnv = {};

    const ok = await runServer({ env, run: io.ok, stdout: io.stdout, stderr: io.stderr });

    expect(ok).toBe(true);
    expect(env[MCP_HARNESS_ENV]).toBe(HARNESS);
    expect(env[MCP_HARNESS_ENV]).toBe("antigravity-cli");
    expect(io.seen).toEqual(["mcp-server.js"]);
  });

  test("leaves a harness the host already pinned alone", async () => {
    const io = capture();
    const env: NodeJS.ProcessEnv = { [MCP_HARNESS_ENV]: "claude-code" };

    await runServer({ env, run: io.ok, stdout: io.stdout, stderr: io.stderr });

    expect(env[MCP_HARNESS_ENV]).toBe("claude-code");
  });

  test("does not touch the caller's other environment variables", async () => {
    const io = capture();
    const env: NodeJS.ProcessEnv = { HOME: "/somewhere", PATH: "/usr/bin" };

    await runServer({ env, run: io.ok, stdout: io.stdout, stderr: io.stderr });

    expect(env.HOME).toBe("/somewhere");
    expect(env.PATH).toBe("/usr/bin");
    expect(Object.keys(env).sort()).toEqual([MCP_HARNESS_ENV, "HOME", "PATH"].sort());
  });

  test("fails visibly and silently when the runtime cannot start", async () => {
    const io = capture();
    const env: NodeJS.ProcessEnv = {};

    const ok = await runServer({
      env,
      run: io.fail("runtime gone"),
      stdout: io.stdout,
      stderr: io.stderr
    });

    // A stdio client must not be left waiting on a peer that will never speak — but nothing
    // unparseable may reach stdout either.
    expect(ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(io.stdoutText()).toBe("");
    expect(io.stderrText()).toStartWith("hindsight: ");
  });
});
