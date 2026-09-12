---
name: hindsight-coding-agent
description: How this machine's Hindsight coding-agent memory works in the Antigravity app — the plugin behind the 🧠 credits. Use when the user says "store/remember this in hindsight", asks what the memory or knowledge pages are, wants to configure per-repo memory (disable it, rename banks, change git depth), or something memory-related looks broken.
---

# Hindsight Coding-Agent Memory (Antigravity app)

This machine runs `@chronova/hindsight-antigravity-plugin`: long-term project memory for the
Antigravity desktop app, backed by a Hindsight server. The memory logic is
[`@vectorize-io/hindsight-coding-agents`](https://github.com/vectorize-io/hindsight); the plugin
wires it into Antigravity's `PreInvocation` and `Stop` hooks and a stdio MCP server. You (the agent)
are already wired into it — this skill explains what happens automatically, which tools you have,
and how to configure or debug it.

## What happens automatically (no action needed)

- **Per-repo memory bank**: each repository resolves to one bank, `coding-agent::<repo>` by default
  — `hindsight_diagnose` reports the resolved id. Every coding agent the user runs on that repo
  shares it (the Antigravity CLI included), and linked worktrees resolve to the main checkout's bank.
- **Ingestion builds itself**: on first open, the bank is seeded from recent commit messages and a
  read-only codebase survey; every session start, a background engine tops it up (new commits, new
  conversations) and keeps 5 knowledge pages current. There is NO ingest or setup command to run.
- **Session synthesis**: the first prompt of a session triggers one deep `reflect`, injected as an
  ephemeral message before the turn. With `autoReflect: false`, nothing is injected — search the
  knowledge pages first and reflect only when they are too shallow.
- **Write-back**: the session transcript is retained into the bank automatically by the `Stop` hook.
  The user never needs to "save" a conversation.

## Storing things deliberately

When the user says "store this in hindsight" / "remember this":

- The **current conversation** is captured automatically at session end — say so; no tool needed.
- An **external document, notes, or durable findings** → `hindsight_ingest_document(title, content)`.
- A **new feature/initiative being started** → `hindsight_capture_initiative(title, summary)`, right
  after the plan is agreed and before code is written.
- A **plan that materially changed** (goal, scope, or rationale — including mid-implementation) →
  call `hindsight_capture_initiative` again with `relates_to_page_id` set to that initiative's page
  id, summarising the _current_ intent. Same page, updated plan — never a second page. Trivial
  course-corrections don't count.

## Retrieving

- `hindsight_search_knowledge_pages(query)` — FIRST STOP for project questions (components,
  conventions, past decisions, initiatives). Server-side hybrid search, fast.
- `hindsight_read_knowledge_page(page_id)` / `hindsight_list_knowledge_pages` — read pages fully.
- `hindsight_reflect(query)` — deep reasoning over the whole memory for WHY questions and exact
  decided values; slower (seconds), use deliberately.
- Credit visibly whenever memory informs an answer: start that part with
  `🧠 From Hindsight memory (<page>): …` — and never credit memory that didn't contribute.
- Verify a recalled memory against the current source before acting on it. Code moves; memory
  records what was true when it was written.

## Correcting wrong or stale memory

If you verify that something Hindsight served is wrong or outdated (the code, git, or an external
source contradicts it), FIX THE RECORD — don't just ignore it. Call `hindsight_ingest_document`
with:

- **title**: `Correction: <topic>` (e.g. `Correction: retry policy 4xx set`)
- **content**: (1) what memory claimed, (2) what is verifiably true now, (3) the evidence you
  checked (file/commit/output). Quote exact values verbatim.

Newer facts supersede older ones in retrieval, so one clear correction permanently outranks the
stale memory. Silent disregard leaves the trap armed for the next session.

## Configuration

Configuration is **one JSON file**: `~/.hindsight/coding-agent.json` (`HINDSIGHT_CONFIG` relocates
it). There is deliberately no repo-carried config file — a cloned repository must not be able to
turn memory on. Layering, later wins per field:

1. built-in defaults
2. environment variables — `HINDSIGHT_API_URL`, `HINDSIGHT_API_TOKEN`, and one per scalar setting
   (`HINDSIGHT_<FIELD_IN_CAPS>`), for containers and CI that inject config rather than write a file
3. the file's top level
4. `harnesses.antigravity-cli` — this harness's section. The id is `antigravity-cli` even in the
   desktop app: it is the runtime's name for its Antigravity integration, hardcoded in its hook
   entry points, and it covers the app and the CLI alike
5. `banks.<resolvedBankId>` — per-repo override, applied after the bank is resolved

Environment variables are a **fallback**: the file wins wherever it sets a value.

**When an edit applies**: each Antigravity hook is its own short-lived process, so a config edit
lands on the user's **next prompt**; the MCP server behind the `hindsight_*` tools reads the file at
startup, so tool-side changes apply in the next session. `apiToken` is the exception — it is
re-read whenever the server rejects a request, so enabling auth or rotating a key needs no restart.
`hindsight_diagnose` reports both sides of that gap: what the file says now, and what the running
client is using.

### Where memory lives

| `serverMode`  | what runs                                 | needs                                    |
| ------------- | ----------------------------------------- | ---------------------------------------- |
| `cloud`       | Hindsight Cloud (default)                 | an API token                             |
| `self-hosted` | a Hindsight server the user already runs  | its `apiUrl`                             |
| `daemon`      | a local `hindsight-embed` on this machine | `uv` on PATH + an LLM key for extraction |

In `daemon` mode the runtime listens on `127.0.0.1:9077` (`apiPort`) and adopts a server already on
the port rather than restarting it. A cold start downloads the daemon and loads models in the
background, so a session that starts first has no memory for a turn or two — that is expected, not a
fault.

### Per-repo control — `banks.<bankId>`

Keyed by the **resolved bank id** (the one `hindsight_diagnose` reports) and applied AFTER bank
resolution, so it survives directory moves:

```jsonc
{
  "banks": {
    "coding-agent::secret-client": { "disabled": true }, // no memory at all for this repo
    "coding-agent::old-name": { "bank": "team::shared" }, // rename / converge banks
    "coding-agent::big-mono": { "gitIngest": "full", "retainSessions": false },
  },
}
```

Any behavioural field can be overridden per bank; `bank` renames the destination (single hop, so
several repos can converge on one shared bank). To route by directory instead, use `mapPathToBank`
(absolute path → bank, longest prefix wins). To remember nothing until a project is named, set
`optInOnly: true` with `optInPaths`.

### Bank resolution

1. `mapPathToBank` — longest matching absolute-path prefix; overrides even an explicit `bankId`.
2. Static — `bankId` set (or `dynamicBankId: false`).
3. Dynamic — `bankIdTemplate`, default `"coding-agent::{gitProject}"`. `{gitProject}` is
   worktree-aware (every linked worktree resolves to the main worktree's name); `{project}` is the
   working-directory basename; `{harness}` is `antigravity-cli` here. Use
   `"{harness}::{gitProject}"` to give each agent its own bank instead of sharing one per repo —
   note this does NOT separate the app from the CLI, which share that harness id.

### Other settings users ask about

`gitIngest` (`"message"` default | `"full"` = messages + per-commit diffs | `"none"`),
`retainSessions` (write-back on/off), `autoReflect`, `disabled` (hard off-switch, global / per
harness / per bank), `logLevel`. The full reference is in
[upstream's README](https://github.com/vectorize-io/hindsight).

## Installing, updating, uninstalling

```bash
hindsight-antigravity-install            # wire the app up; restart the app afterwards
hindsight-antigravity-install uninstall  # remove exactly what it added
```

What it writes, and why each goes where it does:

- `~/.gemini/config/hooks.json` — the `PreInvocation` and `Stop` hooks. Host-wide: every Antigravity
  flavour reads this file, and the app has no hooks file of its own.
- `~/.gemini/antigravity/mcp_config.json` — `mcpServers.hindsight`, the app's own MCP registry (the
  file its Settings → Customizations → "Open MCP Config" button opens). `--shared-mcp` additionally
  writes Antigravity 2.x's shared `~/.gemini/config/mcp_config.json`; it is opt-in because a host
  that reads both lists the server twice.
- `~/.gemini/config/plugins/hindsight/` — the plugin bundle: `plugin.json`, this skill, and the
  always-on memory rules. It deliberately carries no `hooks.json` or `mcp_config.json`, because a
  second registration of the same command would inject memory twice per turn.

Nothing is ever written under `~/.gemini/antigravity-cli/` — that tree belongs to the Antigravity
CLI. For memory in the CLI, the user wants `npx @vectorize-io/hindsight-coding-agents install agy`,
which wires the same runtime into the TUI under the same `coding-agents` hook name. Both can be
installed; they share one bank per repository. Each touched file is backed up once to
`<path>.hindsight-backup`.

## Diagnosing

- `hindsight_diagnose` — config vs. the running client, and where memory is pointed.
- `hindsight_sync_status` — `"synced": true` means the seeded memory is queryable. It also reports
  gitlog freshness, how far per-commit deepening has got, and the codebase survey's state.
- Logs live in `~/.hindsight/coding-agents-logs/`: `plugin.log` (leveled, set `logLevel: "debug"`
  for detail) and `diag.jsonl` (one JSON line per reflect and page fetch, with `reflect_failed` /
  `pages_failed` on errors).
- Failures never break the session. A reflect, page fetch or retain that fails degrades to an
  ordinary memoryless turn; if the runtime cannot start at all, the hooks answer neutrally and exit
  zero. "No memory" is therefore a log question, not a crash.
- To reset a repo's memory, delete its bank on the server. The bank is the only state kept — there
  are no client-side files to clean up.
- New wiring needs an app restart: the app reads `hooks.json` and `mcp_config.json` at startup. If
  the `hindsight_*` tools are missing, that is the first thing to check — then whether the app lists
  `hindsight` under its MCP servers at all.
- A session that was already running when the plugin was installed has no session start behind it;
  its first prompt after the install self-heals.
