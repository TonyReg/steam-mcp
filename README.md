# steam-mcp

Windows-first local Steam MCP scaffold for Node.js + TypeScript.

## Status

- Experimental v1 scaffold.
- Local `stdio` MCP only.
- Read-heavy by default.
- `steam_collection_apply` is the only tool that mutates Steam-owned state and is disabled unless `STEAM_ENABLE_COLLECTION_WRITES=1`.
- `steam_collection_plan` may persist MCP-owned durable plan files under the local state directory.

## Workspace

```text
packages/
  steam-core/   # Steam discovery, library, store, deck, collections, safety
  steam-mcp/    # thin MCP stdio server using @modelcontextprotocol/sdk
test/
fixtures/
docs/design/
```

## Locked v1 behavior

- Uses `@modelcontextprotocol/sdk@1.29.0`.
- Diagnostics go to `stderr` only.
- Collection authority is `userdata/<steamId>/config/cloudstorage/cloud-storage-namespace-1.json`.
- `sharedconfig.vdf` is explicitly **not** the primary collection backend.
- Public Steam store/deck endpoints are read-only enrichment sources.
- No browser automation, authenticated Steam reuse, API keys, or live Steam IPC.
- Deterministic ranking only; no hidden model calls.

## Tools

- `steam_status`
- `steam_library_list`
- `steam_library_search`
- `steam_store_search`
- `steam_find_similar`
- `steam_collection_plan`
- `steam_collection_apply`
- `steam_export`
- `steam_link_generate`

## MCP prompts

- `steam_library_curator`
- `steam_collection_planner`
- `steam_deck_backlog_triage`

These prompts are the v1 agent-facing workflow surface. They guide clients toward the safe tool order, keep collection changes plan-first, and do not bypass the Steam-owned write gate.

- `steam_library_curator` is library-first, but may add store enrichment/comparison when useful.
- `steam_collection_planner` is the plan-first workflow for collections, hidden-state changes, and protected-group-aware planning.
- `steam_deck_backlog_triage` is owned-library/backlog focused rather than general store discovery.

## Environment

- `STEAM_ID`
- `STEAM_INSTALL_DIR`
- `STEAM_USERDATA_DIR`
- `STEAM_MCP_STATE_DIR`
- `STEAM_ENABLE_COLLECTION_WRITES` (`0` by default)

Default MCP-owned state lives under `%LOCALAPPDATA%/steam-mcp/`:

- `plans/`
- `backups/`
- `logs/`

## Development

```bash
npm install
npm run build
npm test
```

## Notes on collection apply

`steam_collection_apply` is intentionally narrow and safety-first:

- requires a durable plan file
- requires snapshot-hash drift checks
- requires backup-first behavior
- uses temp-file write plus rename
- verifies post-write state
- attempts rollback on validation failure
- defaults to requiring Steam to be closed

`steam_collection_plan` may create a durable preview artifact under `%LOCALAPPDATA%/steam-mcp/plans/`; that is MCP-owned state, not a Steam-owned mutation.

## Docs

- `docs/design/windows-first-steam-mcp-v1.md`
- `docs/prompts/steam-mcp-agent-prompts.md`
