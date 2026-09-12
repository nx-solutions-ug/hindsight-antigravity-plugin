# [3.0.0](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/compare/v2.0.0...v3.0.0) (2026-09-12)


* feat!: retarget the plugin at the Antigravity desktop app ([1e42b46](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/commit/1e42b46709f54de34ed231119e8c97bc2fb5e540))


### BREAKING CHANGES

* the install targets change. The MCP server moves from
~/.gemini/config/mcp_config.json to ~/.gemini/antigravity/mcp_config.json
(the old file is still cleaned on uninstall, and --shared-mcp writes it
again), and the companion skill moves from ~/.gemini/config/skills into the
plugin bundle at ~/.gemini/config/plugins/hindsight. Re-run the installer
after upgrading. Two things 2.0 wrote are outside what this version knows
about and need removing by hand: the "statusLine" key in
~/.gemini/antigravity-cli/settings.json, and
~/.gemini/config/skills/hindsight-coding-agent. The status-line entry point
and the hindsight-antigravity-statusline bin are gone. Nothing about memory
itself changes: same runtime, same harness id, same bank, same tools.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016D9QvuboXvWZwHBYBZG5tS

# [2.0.0](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/compare/v1.0.1...v2.0.0) (2026-09-12)


* feat!: rewrite as an Antigravity packaging of hindsight-coding-agents ([365ffa5](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/commit/365ffa53c2be56f972080273f9d9067734739fd3))


### Bug Fixes

* **test:** stop the MCP suite from ending a green run red ([adc9729](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/commit/adc972904af97c32a97a5170ca0e44554facbd0d))


### BREAKING CHANGES

* memory now comes from @vectorize-io/hindsight-coding-agents.
Configuration moves to the single file ~/.hindsight/coding-agent.json;
.hindsight.json, hindsight.config.json, ~/.hindsight/config and the
HINDSIGHT_BANK_SCOPE / HINDSIGHT_BANK_ID / mental-model settings are no
longer read. Banks default to one per repository (coding-agent::{gitProject})
shared with every other coding agent; { "bankIdTemplate": "{harness}::{gitProject}" }
keeps per-agent naming. The MCP tools change: hindsight_recall,
hindsight_retain, hindsight_status and every *_mental_model tool are replaced
by hindsight_search_knowledge_pages, hindsight_read_knowledge_page,
hindsight_list_knowledge_pages, hindsight_reflect, hindsight_ingest_document,
hindsight_capture_initiative, hindsight_diagnose and hindsight_sync_status.
bin/install.js now merges into ~/.gemini/config/* instead of copying a plugin
directory into ~/.gemini/config/plugins/hindsight.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FuvFobjt9L2awFYNugmj38

## [1.0.1](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/compare/v1.0.0...v1.0.1) (2026-09-07)


### Bug Fixes

* **issue-4:** upgrade toolchain to typescript 6 and @types/node 26 ([7c5018a](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/commit/7c5018a66bf0670323a7fbaae7378966b49058c2)), closes [#4](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/issues/4) [#4](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/issues/4)

# 1.0.0 (2026-09-07)


### Features

* initial release of @chronova/hindsight-antigravity-plugin with bank scoping and full workflow suite ([4ddbd5f](https://github.com/nx-solutions-ug/hindsight-antigravity-plugin/commit/4ddbd5f7cdb671d24d290f5944f073b436510271))
