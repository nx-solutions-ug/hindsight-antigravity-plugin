# AGENTS.md — Repository Guidelines for @chronova/hindsight-antigravity-plugin

This file establishes the architectural standards, code quality conventions, testing requirements,
and operational rules for AI coding assistants working in this repository.

---

## 1. Project Overview

- **Name**: `@chronova/hindsight-antigravity-plugin`
- **Description**: **Antigravity desktop application** packaging of
  [`@vectorize-io/hindsight-coding-agents`](https://github.com/vectorize-io/hindsight) — the
  [Hindsight](https://hindsight.vectorize.io) long-term memory runtime for coding agents.
- **The host is the app, not `agy`.** The Antigravity CLI is already served by upstream's own
  `install agy`, which owns `~/.gemini/antigravity-cli/` (its `settings.json`, its status line, its
  plugin staging directory). This package must never write there. What it targets instead:
  - `~/.gemini/config/hooks.json` — the global hooks file every Antigravity flavour reads.
  - `~/.gemini/antigravity/mcp_config.json` — the **app's own** MCP registry.
  - `~/.gemini/config/plugins/hindsight/` — a namespaced plugin bundle for the skill and rules.
- **What this package does**:
  - Wires a `PreInvocation` hook (recall and injection), a `Stop` hook (transcript write-back), a
    stdio MCP server, a companion skill and an always-on rule file into the app.
  - Resolves the runtime's entry points through Node's resolver and runs them in-process.
  - Fails safe: a hook that cannot start the runtime still answers the host and exits zero.
  - Installs and uninstalls that wiring (`bin/install.js`), removing exactly what it added.
- **No status line.** It is a feature of the CLI's TUI; the app has nothing to render one in.
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
├── plugin.json                 # Plugin manifest TEMPLATE; the installer stamps the version
├── rules/
│   └── AGENTS.md               # Always-on rule file, copied into the bundle's rules/
├── skills/
│   └── hindsight-coding-agent/
│       └── SKILL.md            # Companion skill; directory name is the install target name
├── src/
│   ├── index.ts                # Public surface
│   ├── host.ts                 # The app's wiring: paths, hook events, harness id, and why each is
│   │                           # what it is. The one file to read before changing install targets.
│   ├── runtime.ts              # Resolves @vectorize-io/hindsight-coding-agents/dist/* and runs it
│   ├── config.ts               # Reads ~/.hindsight/coding-agent.json; the installer is its only writer
│   ├── installer.ts            # Writes/removes the hooks, the MCP entry and the plugin bundle
│   ├── hooks/
│   │   ├── delegate.ts         # Run an entry point; neutral reply when the runtime cannot start
│   │   ├── pre-invocation.ts   # PreInvocation entry point
│   │   └── stop-hook.ts        # Stop entry point
│   └── mcp/
│       └── server.ts           # Stdio MCP server wrapper (sets HINDSIGHT_MCP_HARNESS)
├── bin/                        # Wrappers the host spawns (pre-invocation, stop-hook, mcp-server, install)
├── test/                       # Fast, isolated unit tests using Bun test
└── .github/workflows/          # Release, OMP CI, code review, auto-manage workflows
```

There is deliberately **no `hooks.json` and no `mcp_config.json`** in the repository or in the
installed bundle. Antigravity expands no path placeholder in those files, so their commands must be
absolute — which means written at install time, by `src/installer.ts`, once each. A second copy
inside the plugin bundle would register the same command twice and make every turn inject memory
twice and retain twice.

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

### Harness id vs. host

`HOST` is `"antigravity"` (the app). `RUNTIME_HARNESS` is `"antigravity-cli"` — upstream's name for
its Antigravity *integration*, hardcoded inside `dist/antigravity-hook.js` and
`dist/antigravity-stop-hook.js` with no way to override it. Because that id selects the
`harnesses.<id>` config section and feeds `{harness}` in `bankIdTemplate`, the MCP server must be
given the same value: `HINDSIGHT_MCP_HARNESS=antigravity` would split the tools and the hooks across
two config sections, and possibly two banks, inside one session. Keep the two constants separate and
keep `RUNTIME_HARNESS` as it is.

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
  - The MCP server is the one exception to silent degradation: a stdio server that answers nothing
    leaves the client waiting on a peer that will never speak, so it sets a non-zero
    `process.exitCode` — without throwing — when the runtime cannot start.
- **Naming Conventions**:
  - Files: kebab-case (`pre-invocation.ts`, `stop-hook.ts`).
  - Functions & variables: camelCase (`resolveRuntimeEntry`, `delegateToRuntime`).
  - Interfaces & types: PascalCase (`HookWiring`, `CodingAgentConfig`).
  - Constants: UPPER_SNAKE_CASE (`HOST`, `RUNTIME_HARNESS`, `RUNTIME_PACKAGE`, `HOOK_NAME`).

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
- `src/host.ts` owns every install target and the reason for it. Change an install path there, with
  the comment that justifies it, never inline in the installer. The hook *protocol* (events,
  payloads, the `coding-agents` grouping key, the harness id) must keep matching upstream, so a
  machine wired by this plugin or by `install agy` behaves identically and either side can uninstall
  the other's entries; only the *files written* differ, because the app and the CLI are extended
  differently.
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
