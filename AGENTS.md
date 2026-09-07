# AGENTS.md — Repository Guidelines for @chronova/hindsight-antigravity-plugin

This file establishes the architectural standards, code quality conventions, testing requirements, and operational rules for AI coding assistants working in this repository.

---

## 1. Project Overview

- **Name**: `@chronova/hindsight-antigravity-plugin`
- **Description**: Antigravity lifecycle plugin and stdio MCP server integrating [Hindsight](https://hindsight.vectorize.io) long-term agent memory into Google Antigravity.
- **Key Capabilities**:
  - Automatically fetches living **Mental Models** and injects them into the system prompt via the `PreInvocation` hook.
  - Performs semantic **Topic Recall** on user input to supply relevant historical context.
  - Automatically parses conversation transcripts and retains learnings via the `Stop` hook with synthetic tag stripping and watermark tracking.
  - Supports three **Bank Scoping** strategies (`per-project-tagged`, `per-project`, `global`).
  - Exposes an 8-tool stdio **Model Context Protocol (MCP)** server for on-demand memory operations.

---

## 2. Tech Stack

- **Runtime**: Node.js >= 18 (execution); Bun (package manager & test runner).
- **Language**: TypeScript 5.7+ with strict type checking enabled.
- **Bundler**: `tsup` targeting ESM (`node18`).
- **Dependencies**: `@modelcontextprotocol/sdk`.
- **Test Runner**: Bun test (`bun test`).
- **Release Automation**: `semantic-release` (Bun adapted) via GitHub Actions.

---

## 3. Architecture & Data Flow

```text
hindsight-antigravity-plugin/
├── plugin.json                 # Antigravity plugin manifest
├── hooks.json                  # Lifecycle hooks registration (PreInvocation, Stop)
├── mcp_config.json             # Stdio MCP server registration
├── rules/
│   └── AGENTS.md               # Shipped rule file installed into Antigravity
├── skills/
│   └── hindsight/
│       └── SKILL.md            # Shipped skill installed into Antigravity
├── src/
│   ├── index.ts                # Main library exports
│   ├── config.ts               # Multi-tiered configuration & scoping resolver
│   ├── client.ts               # Hindsight REST API client with tag filtering
│   ├── mental-models.ts        # Mental model caching & prompt injection builder
│   ├── recall.ts               # Topic recall heuristics & result formatting
│   ├── retain.ts               # JSONL transcript parser, tag cleaner & retain batcher
│   ├── installer.ts            # One-step installer (global ~/.gemini or local .agents)
│   ├── hooks/
│   │   ├── pre-invocation.ts   # PreInvocation hook entry logic
│   │   └── stop-hook.ts        # Stop hook entry logic
│   └── mcp/
│       └── server.ts           # Stdio MCP server (8 tools)
├── bin/                        # CLI wrapper binaries (pre-invocation, stop-hook, mcp, install)
├── test/                       # Fast, isolated unit tests using Bun test
└── .github/workflows/          # Release, OMP CI, code review, auto-manage workflows
```

### Lifecycle Flow

1. **User Prompt Arrives** → Antigravity executes `PreInvocation` hook (`bin/pre-invocation.js`).
   - Reads stdin JSON (`session_id`, `turn_index`, `user_prompt`, `workspace_root`).
   - Resolves config (mode, bank, project tag).
   - Fetches active mental models (cached with 5-minute TTL) and relevant memories.
   - Outputs JSON to stdout: `{ "hook_specific_output": { "additionalContext": "..." } }`.
2. **Turn Executes** → Agent uses memory context, citations, and can invoke MCP tools if needed.
3. **Session Ends / Agent Stops** → Antigravity executes `Stop` hook (`bin/stop-hook.js`).
   - Reads stdin JSON (`session_id`, `transcript_path`, `workspace_root`).
   - Parses newly added turns from `transcript.jsonl` past the saved watermark.
   - Cleans synthetic `<hindsight_...>` tags from dialogue content.
   - Retains conversational exchanges into Hindsight asynchronously with project tags.

---

## 4. Code Conventions & Quality Gates

- **ESM Modules**: Use standard ES module imports with `.js` extensions where required by NodeNext or plain module specifiers.
- **Node Built-ins**: Always use the `node:` protocol prefix:
  - `node:fs`, `node:path`, `node:os`, `node:url`, `node:http`, `node:https`.
- **Type Safety**: TypeScript strict mode is mandatory.
  - Never use `as any`, `@ts-ignore`, or `@ts-expect-error`.
  - Validate and narrow external inputs explicitly.
- **Robust Error Surface**:
  - Lifecycle hooks MUST never crash or exit with non-zero error codes on network/server failures; they log warnings to `stderr` and exit with `0` so agent execution is never blocked.
  - MCP tool handlers catch exceptions and return informative markdown error messages.
- **Naming Conventions**:
  - Files: kebab-case (`pre-invocation.ts`, `mental-models.ts`).
  - Functions & variables: camelCase (`resolveBankScope`, `formatMentalModelsForPrompt`).
  - Interfaces & types: PascalCase (`HindsightConfig`, `PreInvocationInput`).
  - Constants: UPPER_SNAKE_CASE (`DEFAULT_API_URL`, `CACHE_TTL_MS`).

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
- Tests must be fast, fully deterministic, and must not require a live Hindsight server or external network access.
- Isolate file system tests using temporary directories (`os.tmpdir()`) and clean up in `afterEach`.
- Every new feature or bugfix must be accompanied by corresponding unit tests.

---

## 7. Git & Release Conventions

- Conventional commit prefixes:
  - `feat:` — New capabilities (triggers MINOR version bump).
  - `fix:` — Bug fixes (triggers PATCH version bump).
  - `docs:`, `chore:`, `test:`, `refactor:` — Non-release changes (no version bump unless paired with qualifying commits).
- Automated publishing is handled entirely by GitHub Actions on push to `main` via `semantic-release`. Do not manually bump versions or tag releases.
