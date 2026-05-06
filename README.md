# steam-mcp

`steam-mcp` is a Windows-first local MCP server for working with a Steam library safely. It gives MCP clients a practical way to inspect a local Steam setup, search owned games, enrich results with Steam Deck and store data, generate links, and plan collection changes before any write step.

## What it can do

- Inspect the active Steam environment and selected user with `steam_status`
- List and filter owned games with `steam_library_list`
- Search the local library with `steam_library_search`
- Search the public Steam store with `steam_store_search`
- Find similar games deterministically with `steam_find_similar`
- Export results as JSON or Markdown with `steam_export`
- Generate `steam://` and web links with `steam_link_generate`
- Preview collection and hidden-state changes with `steam_collection_plan`
- Apply a reviewed collection plan with `steam_collection_apply` when writes are explicitly enabled, using the permanent staged cloudstorage apply flow

## Safety model

- Read-heavy by default
- `steam_collection_apply` is the only tool that mutates Steam-owned state
- Steam-owned writes stay disabled unless `STEAM_ENABLE_COLLECTION_WRITES=1`; treat this as the explicit write-unlock / operator kill switch for Steam-owned mutations
- `STEAM_ENABLE_WINDOWS_ORCHESTRATION=1` is a separate Windows-only opt-in wrapper that can best-effort launch Steam on MCP startup and close/relaunch Steam around each staged apply call without changing the write gate
- `steam_collection_plan` creates durable preview plans under MCP-owned state without mutating Steam-owned data
- Apply is backup-first, drift-checked, rollback-capable, and still requires Steam to be closed; orchestration only satisfies that precondition on supported Windows runtimes
- Staged sync is JSON-only for cloudstorage files: `cloud-storage-namespace-1.json`, `cloud-storage-namespace-1.modified.json`, and `cloud-storage-namespaces.json`
- Staged sync requires pair-array cloudstorage format, rejects object-shaped cloudstorage documents for apply, and does not fall back to a legacy one-shot path
- Dirty-stage and finalize calls each create backups for the files touched in that invocation

## Quick start

To use `steam-mcp`, you need an MCP client that can launch a local `stdio` server. The current setup path is: build this repo, then point your client at the built server entrypoint.

### Requirements

- Windows with a local Steam install
- Node.js `>=24.15.0`
- npm `>=11.13.0`

### Build from source

```bash
npm install
npm run build
```

### Connect it to an MCP client

Configure your MCP client to launch the built server over `stdio`.

```json
{
  "mcpServers": {
    "steam": {
      "command": "node",
      "args": ["packages/steam-mcp/dist/index.js"],
      "cwd": "C:\\path\\to\\steam-mcp"
    }
  }
}
```

The exact config shape depends on the client, but the runtime entrypoint in this repo is `packages/steam-mcp/dist/index.js` after `npm run build`.

## Guided workflows

If your MCP client supports prompts, `steam-mcp` includes built-in workflows for common tasks:

- `steam_library_curator` — safe library analysis, search, recommendations, exports, and links
- `steam_collection_planner` — plan-first collection or hidden-state changes with protected-collection awareness
- `steam_deck_backlog_triage` — shortlist Steam Deck-friendly backlog candidates

## Environment variables

### Steam detection and runtime overrides

- `STEAM_ID` — pin the Steam user ID to use
- `STEAM_INSTALL_DIR` — override the Steam install directory
- `STEAM_USERDATA_DIR` — override the Steam userdata directory
- `STEAM_MCP_STATE_DIR` — override where MCP-owned plans, backups, logs, and metadata cache files are stored
- `STEAM_STORE_TTL_DAYS` — positive integer day count before persisted store metadata is treated as stale and refreshed on next access; defaults to `30`

### Safety and default collection behavior

- `STEAM_ENABLE_COLLECTION_WRITES` — enable `steam_collection_apply` when set to `1`
- `STEAM_ENABLE_WINDOWS_ORCHESTRATION` — when set to `1` on Windows, best-effort launch Steam during MCP startup, close Steam before each staged apply call, ensure it is stopped, then best-effort relaunch it only if the wrapper stopped it
- `STEAM_DEFAULT_READ_ONLY_COLLECTIONS` — JSON array of collection names to preserve during planning and apply
- `STEAM_DEFAULT_IGNORE_COLLECTIONS` — JSON array of collection names excluded from similarity, search, and list filtering when the tool opts in

Default MCP-owned state lives under `%LOCALAPPDATA%/steam-mcp/`:

- `plans/`
- `backups/`
- `logs/`
- `metadata/`

## Tools overview

| Tool | Purpose |
| --- | --- |
| `steam_status` | Inspect the detected Steam install, user, backend, and write safety state |
| `steam_library_list` | Enumerate owned games with filters such as collections, favorites, play state, and Deck status |
| `steam_library_search` | Search the local library with deterministic match reasons |
| `steam_store_search` | Search the public Steam store without authenticated session reuse |
| `steam_find_similar` | Rank similar library or store candidates deterministically |
| `steam_collection_plan` | Create a durable preview plan for collection or hidden-state changes |
| `steam_collection_apply` | Apply a previously generated plan when writes are enabled; plain apply performs the dirty stage, `finalize=true` completes finalize, and optional Windows orchestration can close/relaunch Steam around each staged call without adding new tool arguments |
| `steam_export` | Render library or plan data as JSON or Markdown |
| `steam_link_generate` | Generate store, community, library, and launch links |

## Notes and limitations

- This is a local `stdio` MCP server, not a hosted service
- The project is Windows-first and assumes a local Steam installation
- Steam store and Steam Deck data are used as read-only enrichment sources
- Collection changes should follow the plan-first flow: preview with `steam_collection_plan`, then apply only after explicit confirmation and with writes enabled
- Collection sync is explicitly limited to cloudstorage JSON files; it does not modify `localconfig.vdf`, LevelDB, `sharedconfig.vdf`, or undocumented Steam APIs
- `steam_collection_apply` semantics are staged-only: omit `finalize` for the default dirty stage, then call again with `finalize=true` for stage-2 finalize; no legacy one-shot apply path remains
- Manual workflow remains valid: users can still close Steam themselves and run the existing staged flow without orchestration
- When `STEAM_ENABLE_WINDOWS_ORCHESTRATION=1` is enabled on Windows, steam-mcp may best-effort start Steam during MCP startup, and each dirty/finalize apply call may independently close and best-effort relaunch Steam if the wrapper stopped it
- Restart is best-effort only and does not imply Steam cloud sync has completed
- Staged apply requires Steam to stay closed; `requireSteamClosed=false` is rejected

## More docs

- `docs/prompts/steam-mcp-agent-prompts.md`

## Development

If you're working on the repo:

```bash
npm run build
npm test
npm run typecheck
npm run clean
```
