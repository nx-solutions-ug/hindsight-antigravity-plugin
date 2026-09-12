---
description: Review a Renovate/Dependabot pull request: research changelogs and assess the impact of the update
argument-hint: <pr-number>
---

You MUST review dependency PR $ARGUMENTS right now. Do NOT ask for more information — execute all steps immediately.

## Step 0: Resolve repository

Determine the full owner/repo slug. Use the GH_REPO environment variable if available, otherwise detect it:

```bash
REPO_SLUG="${GH_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
echo "Repository: $REPO_SLUG"
```

Use $REPO_SLUG in all subsequent gh api calls instead of {owner}/{repo}.

## Step 1: Read the PR and Diff

Fetch PR details:

```bash
gh pr view $ARGUMENTS --json title,body,author,headRefOid --jq '{title: .title, body: .body, author: .author.login, headSha: .headRefOid}'
```

**Read the diff from the local checkout, never via `gh pr diff`.** The GitHub diff API refuses any PR above 300 files with HTTP 406 (`PullRequest.diff too_large`) and `gh pr diff` then silently prints nothing. The repository is checked out at full depth (`fetch-depth: 0`).

Determine from `git diff "origin/main"...HEAD`:
- Which packages were updated
- Old and new versions
- The update type (patch / minor / major)

Focus on `package.json`, `bun.lock`, and GitHub Actions workflow files.

## Step 2: Research Release Notes

For EACH updated dependency, find the actual changelog or release notes:
- **npm/bun packages**: Check GitHub releases via `gh api /repos/{owner}/{repo}/releases` or inspect `CHANGELOG.md`.
- **GitHub Actions**: Check the action repository's releases via `gh api /repos/{owner}/{repo}/releases`.

If you cannot find release notes, state so explicitly. Do NOT fabricate changes.

## Step 3: Assess Impact on hindsight-antigravity-plugin

hindsight-antigravity-plugin is a TypeScript/Node.js Antigravity plugin built with:
- **Runtime**: Node.js >=18 (execution); Bun (package manager + testing).
- **Package manager**: Bun (`bun install`, `bun.lock`). There is no `package-lock.json` or `yarn.lock`.
- **Build**: `tsup` — output in `dist/`.
- **Test runner**: Bun test (`bun test`).
- **Key deps**: `@modelcontextprotocol/sdk`.
- **Code conventions**: ESM; `node:` prefix for built-ins (`node:fs`, `node:path`, `node:os`, `node:url`).

Check:
- Whether version constraints in `package.json` are compatible.
- For library updates: check if deprecated or removed APIs are used in `src/` (scan imports across `src/`).
- Whether `bun.lock` must be regenerated (note that renovate/dependabot target `package.json`, not `bun.lock`).
- Pay special attention to `@modelcontextprotocol/sdk` — breaking changes affect the MCP server in `src/mcp/`.
- Note any new features or performance improvements that could be leveraged.

## Step 4: Check for Renovate Dashboard

If the PR author is `renovate[bot]`, find the Renovate Dashboard issue:

```bash
DASHBOARD_ISSUE=$(gh issue list --search "Renovate Dashboard" --json number --jq '.[0].number')
```

If found, include a reference line at the bottom:
`> 📋 Tracked in #$DASHBOARD_ISSUE`

## Step 5: Post Review

Submit a GitHub review via the pulls API:

```markdown
## Dependency Update Summary

### Changes
| Package | From | To | Type |
|---------|------|----|------|
| [package-name] | [old-version] | [new-version] | [patch/minor/major] |

### Release Highlights
- **Security fixes**: CVEs or security patches (if any)
- **Bug fixes**: Notable fixes relevant to our usage
- **Breaking changes**: Anything that could affect us
- **Deprecations**: New deprecations to be aware of
- **New features**: Anything we might want to leverage

### Impact Assessment
- [ ] No breaking changes detected
- [ ] Version constraints are compatible
- [ ] No deprecated API usage found in codebase
- [ ] bun.lock is consistent with package.json changes

### Recommendation
[SAFE TO MERGE / REVIEW RECOMMENDED / ACTION REQUIRED] with reasoning
```

Submit using the GitHub API:
- For safe patches and minor updates with no breaking changes:
  ```bash
  HEAD_SHA=$(gh pr view $ARGUMENTS --json headRefOid --jq .headRefOid)
  gh api --method POST /repos/$REPO_SLUG/pulls/$ARGUMENTS/reviews \
    -f event=APPROVE \
    -f commit_id="$HEAD_SHA" \
    -f body="[Review content here]"
  ```
- If review is recommended or uncertain:
  ```bash
  gh api --method POST /repos/$REPO_SLUG/pulls/$ARGUMENTS/reviews \
    -f event=COMMENT \
    -f commit_id="$HEAD_SHA" \
    -f body="[Review content here]"
  ```
- If breaking changes or regressions are identified:
  ```bash
  gh api --method POST /repos/$REPO_SLUG/pulls/$ARGUMENTS/reviews \
    -f event=REQUEST_CHANGES \
    -f commit_id="$HEAD_SHA" \
    -f body="[Review content here]"
  ```

## Rules
- Do NOT push commits or modify repository files.
- Do NOT merge the PR.
- Always use $REPO_SLUG for API calls.
- Always read the diff locally via `git diff "origin/main"...HEAD`, never via `gh pr diff`.
- Ground all claims in real changelogs; never fabricate version changes.
- Use `bun` references (not `npm` or `yarn`) when discussing package management.
