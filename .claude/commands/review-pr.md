---
description: Full code review of a pull request, posting inline comments and resolving addressed threads
argument-hint: <pr-number>
---

You MUST review PR $ARGUMENTS right now. Do NOT ask for more information — execute all steps immediately.

## Step 0: Resolve repository and install extension

Determine the full owner/repo slug. Use the GH_REPO environment variable if available, otherwise detect it:

```bash
REPO_SLUG="${GH_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
echo "Repository: $REPO_SLUG"
```

Use $REPO_SLUG in all subsequent gh api calls instead of {owner}/{repo}.

Ensure the `gh-pr-review` extension is installed (it provides the inline review comment workflow):

```bash
gh extension install agynio/gh-pr-review --pin v1.6.2 --force 2>/dev/null || true
```

All inline review comments are posted via `gh pr-review` subcommands, NOT `gh pr review`. The built-in `gh pr review` CLI command cannot attach inline comments to specific diff lines.

## Step 0.5: Detect Jules involvement

Check the `IS_JULES` and `JULES_CONTEXT` environment variables (set by the CI workflow):

```bash
echo "IS_JULES=${IS_JULES:-false}"
echo "JULES_CONTEXT=${JULES_CONTEXT:-}"
```

The workflow sets `IS_JULES=true` when Jules (`google-labs-jules[bot]`) is involved. The `JULES_CONTEXT` value indicates the trigger:
- `jules-authored-pr`: Jules created this PR (either as author or on behalf of a human) — review it and address Jules directly
- `jules-review-submitted`: Jules posted a review — read Jules' review and respond
- `jules-review-comment`: Jules posted a review comment/suggestion — address the specific suggestion

After reading the PR in Step 1, also verify Jules involvement from the PR data:
- PR author login contains `jules`
- PR body contains `created automatically by Jules`
- Any comment author login contains `jules`

If `IS_JULES` is not set but any of these markers are found, treat `IS_JULES` as `true`.

## Step 1: Read the PR

Fetch PR metadata:

```bash
gh pr view $ARGUMENTS --json title,body,labels,author,headRefOid,baseRefName --jq '{title: .title, body: .body, labels: [.labels[].name], author: .author.login, headSha: .headRefOid, baseRef: .baseRefName}'
```

Store `headSha` — pass it as `--commit` when starting a pending review so comments anchor to the correct commit.
Store `baseRef` — used for local git diff against base branch.

## Step 2: Fetch Review Threads & Evaluate Conversation History

Fetch all review threads with full comment history:

```bash
gh pr-review review view $ARGUMENTS -R $REPO_SLUG
```

To view unresolved threads specifically:

```bash
gh pr-review review view $ARGUMENTS -R $REPO_SLUG --unresolved
```

Also check top-level PR comments if relevant:

```bash
gh pr view $ARGUMENTS --comments
```

### Evaluate Thread Comments & Developer Justifications

Examine the entire conversation history in all review threads (`reviews[].comments[].thread_comments[]` alongside the parent comment).
Developers or PR authors often reply explaining intentional design decisions, architectural trade-offs, domain constraints, or why an implementation is correct.

1. **Read all replies in thread conversations**:
   - Inspect comments from PR authors, human reviewers, or peer agents in `thread_comments[]`.
   - Extract technical claims, rationale, or domain context provided in comments.
2. **Ground and verify claims against project standards & codebase**:
   - Query `AGENTS.md`, `.wiki/`, and surrounding code to verify whether the developer's claim conforms to documented project standards or intentional architecture.
3. **Assess the impact of developer justifications**:
   - **Sound & Justified Claims**: If the explanation provides a sound, technically valid justification (e.g. deliberate design override, documented exception, intentional API contract):
     - **Accept the justification**: Do NOT treat this pattern as a violation or re-raise it.
     - **Mark for auto-resolution**: If the thread is unresolved, mark the thread to be resolved in Step 3.
     - **Update review context**: Do NOT block the PR on intentional design choices.
   - **Unsound or Erroneous Claims**: If a reply makes a claim that introduces security vulnerabilities, breaks type safety, or causes genuine logic bugs:
     - Do not resolve the thread.
     - Keep the finding active and clearly explain why the justification is insufficient.
   - **Peer Reviewer Consensus**: Respect consensus from peer reviewers or agents unless a critical bug/vulnerability is present.

## Step 3: Auto-Resolve Fixed or Justified Issues

For each unresolved review thread (comments with `is_resolved: false`):
1. **Resolved by code change**: Code was modified, removed, or refactored so the reported issue no longer exists, OR the comment has `is_outdated: true`.
2. **Resolved by valid justification**: The author or reviewer provided a sound, validated explanation in thread comments (evaluated in Step 2) demonstrating that the implementation is intentional and correct.

If either condition is met, resolve the thread using DIRECT GraphQL mutation (this bypasses client-side `viewerCanResolve: false` gates):

```bash
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: {threadId: "[THREAD_ID]"}) {
      thread { isResolved }
    }
  }'
```

If replying with a clarification or resolution comment before resolving:

```bash
gh pr-review comments reply $ARGUMENTS \
  -R $REPO_SLUG \
  --thread-id "[THREAD_ID]" \
  --body "..."
```

## Step 4: Analyze PR and Find Issues

**Read the diff from the local checkout, never via `gh pr diff`.** The GitHub diff API refuses any PR above 300 files with HTTP 406 (`PullRequest.diff too_large`) and `gh pr diff` then silently prints nothing. The repository is checked out at full depth (`fetch-depth: 0`).

Enumerate first, then read per module:

```bash
BASE="origin/${BASE_REF:-main}"
# List all changed files (excluding deletions)
git diff --name-only --diff-filter=d "$BASE"...HEAD

# Inspect diffs per module
git diff "$BASE"...HEAD -- src/
git diff "$BASE"...HEAD -- rules/
git diff "$BASE"...HEAD -- skills/
```

### Review Criteria (Hindsight Antigravity Plugin Standards)

Check for ALL of the following (backed by `rules/AGENTS.md`):
- **Imports**: ESM imports. Node built-ins use the `node:` prefix (`node:fs`, `node:path`, `node:os`, `node:url`).
- **Type Safety**: TypeScript strict mode compliance. NEVER allow `as any` or `@ts-ignore` / `@ts-expect-error`.
- **Hindsight Integration**:
  - `PreInvocation` hook fetches mental models and topic recalls, returning markdown context via `hook_specific_output.additionalContext`.
  - `Stop` hook parses session transcripts, cleans synthetic model tags, and retains memories asynchronously with watermark tracking.
  - Bank scoping adheres strictly to the 3 modes: `per-project-tagged` (shared bank, tagged `project:<id>`), `per-project` (dedicated bank `<prefix>-<id>`), `global` (single shared bank).
- **Graceful Error Handling**: Hooks MUST exit cleanly with code 0 and log warnings rather than crashing or blocking agent execution if Hindsight is unavailable.
- **Package manager**: Bun (`bun install`, `bun.lock`). Do NOT introduce or reference `package-lock.json` or `yarn.lock`. Node.js >=18 is the execution runtime.
- **Build**: `tsup` bundles TypeScript sources to ESM in `dist/`.
- **Testing**: Bun test (`bun test`), tests located in `test/`. Tests mock network/Hindsight calls deterministically. New behavior requires tests.

**What to Avoid**:
- Do NOT comment on pre-existing code outside of this PR's diff.
- Do NOT comment on formatting that a formatter handles.

## Step 5: Deduplicate Findings

For each finding identified in Step 4, check UNRESOLVED threads for semantic matches:
- Same file + same issue type within nearby lines (allow ±5 line shift) = DUPLICATE (skip)
- Already discussed and pending resolution in an active thread = DUPLICATE (skip)
- Same file + different function/root cause = NEW (include)

Categorize into **new_issues** and **old_issues**.

## Step 6: Mapping Findings to Diff Lines

GitHub inline review comments MUST reference a line that exists in the PR diff:
- **Added/context lines** (RIGHT side): `--side RIGHT`, count line numbers from `+NEW_START` in the diff hunk header.
- **Removed lines** (LEFT side): `--side LEFT`, count line numbers from `-OLD_START` in the diff hunk header.
- Findings that do not map to a specific diff line belongs in the review `--body` summary, not inline.

## Step 7: Post Review

**Decision logic:**
1. `new_issues` has items -> Submit review with `event=REQUEST_CHANGES` and all inline comments.
2. `new_issues` empty + unresolved threads == 0 (all issues either fixed, justified & resolved, or clean) -> Submit review with `event=APPROVE` (no comments).
3. `new_issues` empty + unresolved threads > 0 (genuine issues still legitimately outstanding without sound justification) -> **Do NOT submit a review** (existing inline comments remain visible).

### Submit Batched Review with Inline Comments

```bash
# 1. Start pending review pinned to HEAD SHA
REVIEW_JSON=$(gh pr-review review --start $ARGUMENTS \
  -R $REPO_SLUG \
  --commit "$HEAD_SHA")
REVIEW_ID=$(echo "$REVIEW_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# 2. Add each inline comment using the captured REVIEW_ID
gh pr-review review --add-comment $ARGUMENTS \
  -R $REPO_SLUG \
  --review-id "$REVIEW_ID" \
  --path "src/tools.ts" \
  --line 42 \
  --side RIGHT \
  --body "**[P1]** Issue description and rationale.

\`\`\`suggestion
replacement code here
\`\`\`"

# 3. Submit the review
gh pr-review review --submit $ARGUMENTS \
  -R $REPO_SLUG \
  --review-id "$REVIEW_ID" \
  --event REQUEST_CHANGES \
  --body "## Code Review

Summary of findings..."
```

Comment body conventions:
- Start each inline body with severity tag: `[P0]` critical/security, `[P1]` high-impact bug, `[P2]` defect/convention violation, `[P3]` nit.
- **Include a `suggestion` block whenever proposing a concrete code fix.** GitHub renders `` ```suggestion `` fenced blocks inside inline review comments as apply-able "Commit suggestion" buttons.
- The suggestion block content MUST be valid replacement code without diff markers (`+`/`-`).

### For APPROVE (clean PR, single atomic call):

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/$REPO_SLUG/pulls/$ARGUMENTS/reviews \
  -f event='APPROVE' \
  -f commit_id="$HEAD_SHA"
```

### When Jules is involved (`IS_JULES=true`):
The review body MUST start with `@jules` on the first line so Jules detects and acts on the review:

```markdown
@jules

[Review content...]
```

## Step 8: Print Summary

Print a single summary line:

```
Reviewed PR #$ARGUMENTS: <APPROVE / REQUEST_CHANGES / COMMENT> — <one-line summary>. <N> inline comments posted.
```

## Rules
- Do NOT push commits or modify repository files.
- Do NOT apply labels or merge the PR.
- Always read diff locally against `origin/${BASE_REF:-main}`, never via `gh pr diff`.
- Auto-resolve threads via direct GraphQL `resolveReviewThread` mutation when issues are fixed or justified.
- Evaluate thread replies and respect sound developer justifications.
- Use `gh pr-review` subcommands for inline comments, passing captured `--review-id`.
- Anchor reviews to the exact HEAD SHA.