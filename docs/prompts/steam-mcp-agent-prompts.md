# Steam MCP Agent Prompts

This repository exposes MCP prompts as the primary agent-facing workflow surface for v1.

## Prompt list

### `steam_library_curator`

Use this when an agent should analyze the owned Steam library safely, search for candidates, explain deterministic recommendations, export results, or generate `steam://` links.

Arguments:

- `goal` (required)
- `deckStatus` (optional: `verified`, `playable`, `unsupported`, `unknown`)

Recommended flow:

1. `steam_status`
2. `steam_library_list` or `steam_library_search`
3. `steam_find_similar` and/or `steam_store_search` when enrichment is needed
4. `steam_export` and `steam_link_generate`

This workflow depends on API-authoritative owned-library enumeration through `GetOwnedGames`. If `steam_status` reports missing `STEAM_API_KEY`, stop and ask for configuration instead of relying on stale local data.

### `steam_collection_planner`

Use this when an agent should propose collection, favorite, or hidden-state changes without immediately mutating Steam-owned state.

Arguments:

- `request` (required)
- `mode` (optional: `add-only`, `merge`, `replace`)

Recommended flow:

1. `steam_status`
2. `steam_library_search` or `steam_library_list`
3. `steam_collection_plan`
4. Review matched games, warnings, and destructive status with the user
5. Only use `steam_collection_apply` after explicit confirmation and when `STEAM_ENABLE_COLLECTION_WRITES=1`; treat that flag as the explicit write-unlock for Steam-owned mutations.
6. `STEAM_ENABLE_WINDOWS_ORCHESTRATION=1` is a separate Windows-only opt-in wrapper: it closes Steam before each apply call but does NOT restart after a dirty-only apply (state is staged-only; sync is not complete until `finalize=true` succeeds); it restarts only after a finalize apply or after a failed apply if the wrapper stopped it.
7. Plain apply performs the dirty stage (staged-only; not sync-complete) and `finalize=true` completes finalize; any restart after finalize is best-effort only and does not imply Steam cloud sync has completed.

Actionable collection planning also depends on API-authoritative owned-library enumeration. If `steam_status` reports missing `STEAM_API_KEY`, stop and ask for configuration instead of attempting a partial local-only plan.

### `steam_deck_backlog_triage`

Use this when an agent should find the best backlog candidates for Steam Deck play.

Arguments:

- `focus` (optional)
- `deckStatus` (optional: defaults to `verified` in the prompt guidance)

Recommended flow:

1. `steam_status`
2. `steam_library_search` with backlog and Deck filters
3. `steam_find_similar` for deterministic ranking
4. `steam_export` and `steam_link_generate`

This workflow also depends on API-authoritative owned-library enumeration. If `steam_status` reports missing `STEAM_API_KEY`, stop and ask for configuration before triaging the backlog.

### `steam_release_scout`

Use this when an agent should scout upcoming or newly released Steam catalog apps through the authenticated official catalog path.

Arguments:

- `limit` (optional string integer, for example `"20"`; defaults to `20` in the prompt guidance)
- `types` (optional comma-separated string, for example `"game,dlc"`)
- `comingSoonOnly` (optional boolean string: `"true"` or `"false"`; defaults to `true` in the prompt guidance)

Recommended flow:

1. `steam_status`
2. `steam_release_scout`
3. `steam_store_search`, `steam_find_similar`, or `steam_link_generate` when deeper comparison or links are useful
4. `steam_export` for JSON or Markdown handoff

## Safety notes

- Prompts never bypass runtime safeguards.
- `steam_collection_apply` remains the only tool that mutates Steam-owned state.
- `steam_collection_plan` may persist MCP-owned durable plan files under the local state directory.
