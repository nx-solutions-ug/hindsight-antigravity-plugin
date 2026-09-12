# AGENTS.md — Repository Guidelines for @chronova/hindsight-antigravity-plugin

This file establishes the architectural standards, code quality conventions, testing requirements,
and operational rules for AI coding assistants working in this repository.

---

## 1. Project Overview

- **Name**: `@chronova/hindsight-antigravity-plugin`
- **Description**: Antigravity (`agy`) packaging of
  [`@vectorize-io/hindsight-coding-agents`](https://github.com/vectorize-io/hindsight) — the
  [Hindsight](https://hindsight.vectorize.io) long-term memory runtime for coding agents.
- **What this package does**:
  - Mirrors the runtime's `antigravity-cli` harness wiring: a `PreInvocation` hook (recall and
    injection), a `Stop` hook (transcript write-back), a stdio MCP server, a `Hindsight · <bank>`
    status line, a companion skill and an always-on rule file.
  - Resolves the runtime's entry points through Node's resolver and runs them in-process.
  - Fails safe: a hook that cannot start the runtime still answers the host and exits zero.
  - Merges the same wiring into an existing Antigravity install (`bin/install.js`), and removes
    exactly what it added.
- **What this package does NOT do**: memory. Recall, retention, bank resolution, config layering,
  ingestion and the `hindsight_*` tools all belong to the runtime. See §7.

---

## 2. Tech Stack

- **Runtime**: Node.js >= 18 (execution); Bun (package manager & test runner).
- **Language**: TypeScript 5.7+ with strict type checking enabled.
- **Bundler**: `tsup` targeting ESM (`node18`).
- **Dependencies**: `@vectorize-io/hindsight-coding-agents` (the memory runtime).
- **Test Runner**: Bun test (`bun test`).
- **Release Automation**: `semantic-release` (Bun adapted) via GitHub Actions.

---

## 3. Architecture & Data Flow

```text
hindsight-antigravity-plugin/
├── plugin.json                 # Antigravity plugin manifest (${PLUGIN_ROOT} paths)
├── hooks.json                  # Lifecycle hooks registration (PreInvocation, Stop)
├── mcp_config.json             # Stdio MCP server registration
├── rules/
│   └── AGENTS.md               # Always-on rule file shipped into Antigravity
├── skills/
│   └── hindsight-coding-agent/
│       └── SKILL.md            # Companion skill; directory name is the install target name
├── src/
│   ├── index.ts                # Public surface
│   ├── harness.ts              # Wiring constants mirroring upstream's antigravity-cli harness
│   ├── runtime.ts              # Resolves @vectorize-io/hindsight-coding-agents/dist/* and runs it
│   ├── config.ts               # Reads ~/.hindsight/coding-agent.json; the installer is its only writer
│   ├── installer.ts            # Merge/remove wiring in ~/.gemini/config/*
│   ├── statusline.ts           # Status line entry point
│   ├── hooks/
│   │   ├── delegate.ts         # Run an entry point; neutral reply when the runtime cannot start
│   │   ├── pre-invocation.ts   # PreInvocation entry point
│   │   └── stop-hook.ts        # Stop entry point
│   └── mcp/
│       └── server.ts           # Stdio MCP server wrapper (sets HINDSIGHT_MCP_HARNESS)
├── bin/                        # Wrappers the host spawns (pre-invocation, stop-hook, statusline, mcp-server, install)
├── test/                       # Fast, isolated unit tests using Bun test
└── .github/workflows/          # Release, OMP CI, code review, auto-manage workflows
```

### Lifecycle Flow

1. **A prompt is submitted** → Antigravity runs the `PreInvocation` hook (`bin/pre-invocation.js`).
   - stdin: `{ "workspacePaths": ["/abs/path"], "conversationId": "…", "transcriptPath": "…" }`.
     There is **no prompt field** — the runtime recovers the last user turn from the transcript
     JSONL.
   - The wrapper delegates to `@vectorize-io/hindsight-coding-agents/dist/antigravity-hook.js`,
     which resolves the bank, reflects or searches knowledge pages, and writes its own reply.
   - stdout: `{"injectSteps":[{"ephemeralMessage":"…"}]}`.
   - `PreInvocation` is Antigravity's only injection point, so it also carries the session-start work
     other harnesses do in a `SessionStart` hook.
2. **The turn runs** with memory in context, the shipped rules, the companion skill and the
   `hindsight_*` MCP tools.
3. **The session ends** → Antigravity runs the `Stop` hook (`bin/stop-hook.js`).
   - stdin: `{ "conversationId": "…", "transcriptPath": "…", "workspacePaths": ["/abs/path"] }`.
   - The runtime (`dist/antigravity-stop-hook.js`) writes the transcript back into the bank.
   - stdout: `{}`.
4. **Status line** (`bin/statusline.js` → `dist/antigravity-statusline.js`) prints
   `Hindsight · <bank>` as a bare string.

Antigravity-specific hook contracts and dogfooding steps live in [GEMINI.md](./GEMINI.md).

---

## 4. Code Conventions & Quality Gates

- **ESM Modules**: Use standard ES module imports with `.js` extensions where required by NodeNext or
  plain module specifiers.
- **Node Built-ins**: Always use the `node:` protocol prefix:
  - `node:fs`, `node:path`, `node:os`, `node:url`, `node:http`, `node:https`.
- **Type Safety**: TypeScript strict mode is mandatory.
  - Never use `as any`, `@ts-ignore`, or `@ts-expect-error`.
  - Validate and narrow external inputs explicitly.
- **Robust Error Surface**:
  - Lifecycle hooks MUST never crash or exit with non-zero error codes on network/server/runtime
    failures; they log warnings to `stderr` and exit with `0` so agent execution is never blocked.
  - The status line writes nothing when it cannot produce a real one — the host renders stdout
    verbatim, so an error message would be shown to the user as their status line.
- **Naming Conventions**:
  - Files: kebab-case (`pre-invocation.ts`, `stop-hook.ts`).
  - Functions & variables: camelCase (`resolveRuntimeEntry`, `delegateToRuntime`).
  - Interfaces & types: PascalCase (`HookWiring`, `CodingAgentConfig`).
  - Constants: UPPER_SNAKE_CASE (`HARNESS`, `RUNTIME_PACKAGE`, `HOOK_MARKER`).

---

## 5. Development & Testing Commands

```bash
# Install dependencies
bun install

# Build distribution bundle (tsup -> dist/)
bun run build

# Run unit tests
bun test

# Run type check
bun run lint

# Package preview (dry run)
npm pack --dry-run
```

---

## 6. Testing Rules

- Place all tests in `test/*.test.ts`.
- Tests must be fast, fully deterministic, and must not require a live Hindsight server, a running
  runtime, or external network access. Delegation seams (`run`, `stdout`, `stderr` on
  `delegateToRuntime`) exist so hooks can be tested without either.
- Isolate file system tests using temporary directories (`os.tmpdir()`) and clean up in `afterEach`;
  the installer takes `home` and `pkgRoot` for exactly this reason.
- Every new feature or bugfix must be accompanied by corresponding unit tests.

---

## 7. Do Not Reimplement the Runtime

This package must not reimplement memory behaviour. Recall, retention, bank resolution, config
layering, ingestion, the knowledge pages and the `hindsight_*` tools are the runtime's, and a second
implementation here would drift from the one that actually decides where memory goes. The plugin's
job is **wiring, fail-safe delegation and packaging**.

Concretely:

- New behaviour that belongs to memory goes upstream, not here.
- `src/config.ts` reads the runtime's config file only for what the installer must report or seed; it
  is not a second resolver.
- Wiring constants in `src/harness.ts` must keep matching upstream's `antigravity-cli` harness, so a
  machine wired by either route behaves identically and can be uninstalled by either side.
- Settings, tool names and vocabulary come from upstream's README and skill. Do not invent them.

---

## 8. Git & Release Conventions

- Conventional commit prefixes:
  - `feat:` — New capabilities (triggers MINOR version bump).
  - `fix:` — Bug fixes (triggers PATCH version bump).
  - `docs:`, `chore:`, `test:`, `refactor:` — Non-release changes (no version bump unless paired with
    qualifying commits).
- Automated publishing is handled entirely by GitHub Actions on push to `main` via
  `semantic-release`. Do not manually bump versions or tag releases.
