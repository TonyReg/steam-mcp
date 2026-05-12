# steam-mcp

`steam-mcp` is a Windows-first local MCP server for working with a Steam library safely. It gives MCP clients a practical way to inspect a local Steam setup, search owned games, enrich results with Steam Deck and store data, generate links, and plan collection changes before any write step.

## What it can do

- Inspect the active Steam environment and selected user with `steam_status`
- List and filter owned games with `steam_library_list`
- Search the local library with `steam_library_search`
- Search the public Steam store with `steam_store_search`
- Query the authenticated official Steam catalog with `steam_store_query`
- Scout upcoming or newly released Steam catalog apps with `steam_release_scout`
- List recently played games with `steam_recently_played`
- Find similar games with deterministic ranking by default and optional official store prioritization via `steam_find_similar`
- Export results as JSON or Markdown with `steam_export`
- Generate `steam://` and web links with `steam_link_generate`
- Preview collection and hidden-state changes with `steam_collection_plan`
- Apply a reviewed collection plan with `steam_collection_apply` when writes are explicitly enabled, using a staged cloudstorage apply flow

## Safety model

- Read-heavy by default
- `steam_collection_apply` is the only tool that mutates Steam-owned state
- Steam-owned writes stay disabled unless `STEAM_ENABLE_COLLECTION_WRITES=1`; treat this as the explicit write-unlock / operator kill switch for Steam-owned mutations
- `STEAM_ENABLE_WINDOWS_ORCHESTRATION=1` is a separate Windows-only opt-in wrapper that can best-effort launch Steam on MCP startup and close Steam before each apply call; after a successful dirty-only apply it leaves Steam closed, and after a finalize apply or a failed apply it best-effort relaunches Steam only if the wrapper stopped it
- `steam_collection_plan` creates durable preview plans under MCP-owned state without mutating Steam-owned data
- Apply is backup-first, drift-checked, rollback-capable, and requires Steam to be closed; orchestration satisfies that precondition on supported Windows runtimes
- Staged sync is JSON-only for cloudstorage files: `cloud-storage-namespace-1.json`, `cloud-storage-namespace-1.modified.json`, and `cloud-storage-namespaces.json`
- Staged sync requires pair-array cloudstorage format, rejects object-shaped cloudstorage documents for apply, and does not fall back to a legacy one-shot path
- Dirty-stage and finalize calls each create backups for the files touched in that invocation

## Quick start

To use `steam-mcp`, you need an MCP client that can launch a local `stdio` server. Build this repo, then point your client at the built server entrypoint.

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
- `steam_recently_played` — read-only workflow for inspecting recent play history for the selected Steam user
- `steam_release_scout` — read-only workflow for upcoming or newly released Steam catalog scouting

## Environment variables

### Steam detection and runtime overrides

- `STEAM_ID` — pin the Steam user ID to use
- `STEAM_INSTALL_DIR` — override the Steam install directory
- `STEAM_USERDATA_DIR` — override the Steam userdata directory
- `STEAM_MCP_STATE_DIR` — override where MCP-owned plans, backups, logs, and metadata cache files are stored
- `STEAM_STORE_TTL_DAYS` — positive integer day count before persisted store metadata is treated as stale and refreshed on next access; defaults to `30`
- `STEAM_API_KEY` — Steam Web API key used for authenticated official catalog access, official similarity prioritization, and owned-game fallback metadata

### Safety and default collection behavior

- `STEAM_ENABLE_COLLECTION_WRITES` — enable `steam_collection_apply` when set to `1`
- `STEAM_ENABLE_WINDOWS_ORCHESTRATION` — when set to `1` on Windows, best-effort launch Steam during MCP startup, close Steam before each apply call, ensure it is stopped, leave Steam closed after a successful dirty-only apply, and best-effort relaunch it only after a finalize apply or a failed apply if the wrapper stopped it
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
| `steam_store_query` | Query the authenticated official Steam catalog with bounded type, release-state, free-to-play, and human-readable genre/category/tag filters; requires a Steam Web API key |
| `steam_release_scout` | Read-only upcoming/recent release scouting via official catalog access plus public appdetails enrichment, with optional locale passthrough and bounded human-readable facet filters; requires a Steam Web API key |
| `steam_recently_played` | Read-only recently played game listing via the official Steam Web API; requires a Steam Web API key |
| `steam_find_similar` | Rank similar library or store candidates with deterministic ranking by default and optional official store prioritization for `scope="store"` or `scope="both"` |
| `steam_collection_plan` | Create a durable preview plan for collection or hidden-state changes |
| `steam_collection_apply` | Apply a generated plan when writes are enabled; plain apply performs the dirty stage, `finalize=true` completes finalize, and optional Windows orchestration can close Steam around apply calls, leave Steam closed after a dirty-only apply, and best-effort relaunch after finalize or a failed apply when the wrapper stopped Steam |
| `steam_export` | Render library or plan data as JSON or Markdown |
| `steam_link_generate` | Generate store, community, library, and launch links |

## Notes and limitations

- This is a local `stdio` MCP server, not a hosted service
- The project is Windows-first and assumes a local Steam installation
- Steam store and Steam Deck data are used as read-only enrichment sources
- `steam_store_query` is read-only, requires `STEAM_API_KEY`, supports bounded human-readable genre/category/tag filtering via authoritative cacheable store details, and complements the unauthenticated public-store `steam_store_search` path
- `steam_release_scout` is read-only and fails explicitly when no Steam Web API key is available
- `steam_recently_played` is read-only and fails explicitly when no Steam Web API key is available or no selected Steam user can be resolved
- `steam_find_similar` defaults to deterministic ranking; `mode="official"` is opt-in, only works with `scope="store"` or `scope="both"`, and fails explicitly when `STEAM_API_KEY` is unavailable or the selected user cannot be resolved to a SteamID64
- Collection changes should follow the plan-first flow: preview with `steam_collection_plan`, then apply only after explicit confirmation and with writes enabled
- Collection sync is explicitly limited to cloudstorage JSON files; it does not modify `localconfig.vdf`, LevelDB, `sharedconfig.vdf`, or undocumented Steam APIs
- `steam_collection_apply` uses a staged flow: omit `finalize` for the default dirty stage, then call again with `finalize=true` to complete finalize
- You can close Steam yourself and run the staged flow without orchestration
- When `STEAM_ENABLE_WINDOWS_ORCHESTRATION=1` is enabled on Windows, steam-mcp may best-effort start Steam during MCP startup; for a dirty-only apply the wrapper closes Steam if needed and leaves it closed, and after a finalize apply or a failed apply it best-effort relaunches Steam only if the wrapper stopped it
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
