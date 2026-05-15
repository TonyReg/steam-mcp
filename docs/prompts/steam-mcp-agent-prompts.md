# Steam MCP Agent Prompts

This repository exposes MCP prompts as the primary agent-facing workflow surface for v1.

## Prompt list

### `steam_library_curator`

Use this when an agent should analyze the owned Steam library safely, search for candidates, explain recommendations grounded in deterministic overlap or optional official store prioritization, export results, or generate `steam://` links.

Arguments:

- `goal` (required)
- `deckStatus` (optional: `verified`, `playable`, `unsupported`, `unknown`)

Recommended flow:

1. `steam_status`
2. `steam_library_list` or `steam_library_search`
3. `steam_store_query`, `steam_store_search`, and/or `steam_find_similar` when enrichment or comparison is needed; use `steam_store_query` for authenticated official catalog filtering, `steam_store_search` for unauthenticated public-store lookup, keep `steam_find_similar` deterministic by default, and use `mode="official"` only for `scope="store"` or `scope="both"` when authenticated official prioritization is explicitly useful
4. `steam_export` and `steam_link_generate`

This workflow depends on API-authoritative owned-library enumeration through `GetOwnedGames`. If `steam_status` reports missing `STEAM_API_KEY`, stop and ask for configuration instead of relying on stale local data.

### `steam_wishlist_curator`

Use this when an agent should curate the selected user's wishlist safely, including enriched wishlist inspection, sale discovery, deterministic wishlist search, Deck-focused shortlisting, discount summaries, export, and links.

Arguments:

- `goal` (required)
- `limit` (optional string integer, for example `"20"`)
- `deckStatus` (optional: `verified`, `playable`, `unsupported`, `unknown`)

Recommended flow:

1. `steam_status`
2. `steam_wishlist` or `steam_wishlist_details`
3. `steam_wishlist_search`
4. `steam_wishlist_on_sale` or `steam_wishlist_discount_summary`
5. `steam_wishlist_deck_shortlist`
6. `steam_export` and `steam_link_generate`

This workflow is read-only. It depends on a discoverable selected Steam user, a resolvable SteamID64, and `STEAM_API_KEY`. Official wishlist APIs provide membership/count data, while public appdetails enrichment supplies details, live price metadata, and optional Deck context. Preserve the existing caveats: `steam_wishlist_details` reports `missingDetailsCount` only for the scanned slice after any `limit`; `steam_wishlist_on_sale` may report `unknownPriceCount`; `steam_wishlist_discount_summary` counts ignore the returned-item limit; and `steam_wishlist_deck_shortlist` gives `query` precedence over `seedAppIds` when both are supplied.

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
3. `steam_find_similar` for backlog ranking; keep the default deterministic mode unless authenticated official store prioritization is explicitly needed for `scope="store"` or `scope="both"`
4. `steam_export` and `steam_link_generate`

This workflow also depends on API-authoritative owned-library enumeration. If `steam_status` reports missing `STEAM_API_KEY`, stop and ask for configuration before triaging the backlog.

### `steam_discovery_router`

Use this when an agent should route a broad discovery request to the right current Steam MCP surface without inventing a new endpoint or collapsing the discovery tools into one opaque path.

Arguments:

- `request` (required)
- `limit` (optional string integer, for example `"10"`)
- `preferredSource` (optional: `auto`, `library`, `store`, `featured`, `releases`, `similar`, `recent`)

Recommended flow:

1. `steam_status`
2. Choose exactly one primary path before calling any discovery surface
3. Use `steam_library_curator` for owned-library analysis, recommendations, exports, and links; this is not the removed storefront curator/list discovery surface
4. Use `steam_wishlist_curator` for selected-user wishlist curation, sale/discount discovery, wishlist search, or wishlist Deck shortlisting
5. Use `steam_deck_backlog_triage` for Deck-friendly backlog asks, `steam_recently_played` for selected-user recent activity, `steam_find_similar` for “like this” / overlap intent, `steam_release_scout` for new or upcoming releases, `steam_featured_scout` for featured/editorial/promoted asks, `steam_store_query` for authenticated official catalog filtering, and `steam_store_search` for simpler public-store lookup
6. Allow at most one adjacent fallback only if the primary path yields too few usable results or cannot satisfy the request honestly without changing semantics
7. Keep fallbacks adjacent and explicit: release or featured discovery may fall back to `steam_store_query` for broader authenticated catalog lookup; `steam_store_query` may fall back to `steam_store_search` for simpler public-store lookup; recently played or library analysis may use `steam_find_similar` only as a follow-up comparison step; wishlist curation may use `steam_store_search` or `steam_link_generate` only after the wishlist primary step when public-store context or direct links are needed
8. Keep provenance explicit in the answer: name the chosen primary path, and if a fallback was needed, name that path and explain why
9. `steam_export` and `steam_link_generate` for handoff and links after the main discovery step

This workflow must not revive the removed storefront curator/list surface. Do not route anything to that removed curator/list API path. If the selected primary path requires `STEAM_API_KEY` or selected-user resolution and `steam_status` reports that prerequisite missing, stop unless one adjacent public fallback still satisfies the same request honestly.

### `steam_recently_played`

Use this when an agent should inspect recently played games for the selected Steam user through the official Steam Web API path.

Arguments:

- `limit` (optional string integer, for example `"10"`)

Recommended flow:

1. `steam_status`
2. `steam_recently_played`
3. `steam_find_similar`, `steam_store_search`, or `steam_link_generate` when deeper comparison or links are useful
4. `steam_export`

This workflow depends on a discoverable selected Steam user, a resolvable SteamID64, and `STEAM_API_KEY`. If `steam_status` reports any of those prerequisites missing, stop and ask for configuration or user-selection correction instead of improvising.

### `steam_store_query`

Use this when an agent should query the authenticated official Steam catalog with bounded filters, optional authoritative human-readable facet filtering, and optional facet enrichment.

Arguments:

- `limit` (optional string integer, for example `"20"`)
- `types` (optional comma-separated string, for example `"game,dlc"`)
- `language` (optional Steam language string, for example `"schinese"` or `"japanese"`)
- `countryCode` (optional Steam country code string, for example `"US"` or `"JP"`)
- `comingSoonOnly` (optional boolean string: `"true"` or `"false"`)
- `freeToPlay` (optional boolean string: `"true"` or `"false"`)
- `includeFacets` (optional boolean string: `"true"` or `"false"`)
- `genres` (optional comma-separated string, for example `"puzzle,adventure"`)
- `categories` (optional comma-separated string, for example `"single-player,co-op"`)
- `tags` (optional comma-separated string, for example `"story rich,cozy"`)
- `genresExclude` (optional comma-separated string, for example `"horror,anime"`)
- `categoriesExclude` (optional comma-separated string, for example `"multi-player,vr"`)
- `tagsExclude` (optional comma-separated string, for example `"survival,roguelike"`)

Recommended flow:

1. `steam_status`
2. `steam_store_query`
3. Use optional locale, release-state, pricing-model, and include/exclude facet filters only when the user explicitly wants them; includes are OR within a facet family and AND across different facet families, and any matching exclude facet removes the candidate after authoritative comparison
4. `steam_store_search`, `steam_release_scout`, `steam_find_similar`, or `steam_link_generate` when comparison, scouting, or direct links are useful
5. `steam_export`

This workflow depends on `STEAM_API_KEY`. If `steam_status` reports that the key is unavailable, stop and ask for configuration instead of improvising with unauthenticated substitutes. When facet filtering is active, explain that results are bounded post-filtering over the candidate window, so fewer than the requested limit may still be returned. When `includeFacets=true`, explain that `facetsAvailable=false` means the item remained valid but no facet payload could be attached for that result.

### `steam_featured_scout`

Use this when an agent should scout authenticated official Steam featured/editorial marketing placements through `GetItemsToFeature`.

Arguments:

- `limit` (optional string integer, for example `"20"`; defaults to `20` in the prompt guidance)
- `types` (optional comma-separated string, for example `"game,software"`; defaults to `game,software,dlc` in the prompt guidance)
- `language` (optional Steam language string, for example `"schinese"` or `"japanese"`)
- `countryCode` (optional Steam country code string, for example `"US"` or `"JP"`)

Recommended flow:

1. `steam_status`
2. `steam_featured_scout`
3. Use optional `language` / `countryCode` when the user wants locale-scoped official marketing results; otherwise keep the official client defaults.
4. Use optional `types` when the user wants to keep only specific app families after official enrichment; explain that returned results preserve marketing ordering after enrichment, deduplication, and bounded filtering.
5. Switch to `steam_release_scout` for release-specific scouting, `steam_store_query` for broader authenticated catalog filtering, and `steam_store_search` for unauthenticated public-store lookup.
6. `steam_export` and `steam_link_generate` when handoff or direct store links are useful.

This workflow depends on `STEAM_API_KEY`. If `steam_status` reports that the key is unavailable, stop and ask for configuration instead of improvising with charts or release-query substitutes.

### `steam_release_scout`

Use this when an agent should scout upcoming or newly released Steam catalog apps through the authenticated official catalog path.

Arguments:

- `limit` (optional string integer, for example `"20"`; defaults to `20` in the prompt guidance)
- `types` (optional comma-separated string, for example `"game,dlc"`)
- `language` (optional Steam language string, for example `"schinese"` or `"japanese"`)
- `countryCode` (optional Steam country code string, for example `"US"` or `"JP"`)
- `comingSoonOnly` (optional boolean string: `"true"` or `"false"`; defaults to `true` in the prompt guidance)
- `freeToPlay` (optional boolean string: `"true"` or `"false"`)
- `genres` (optional comma-separated string, for example `"puzzle,adventure"`)
- `categories` (optional comma-separated string, for example `"single-player,co-op"`)
- `tags` (optional comma-separated string, for example `"story rich,co-op"`)

Recommended flow:

1. `steam_status`
2. `steam_release_scout`
3. Use optional `language` / `countryCode` when the user wants locale-scoped official catalog results, optional `freeToPlay` when they want to narrow by pricing model, and optional `genres` / `categories` / `tags` when they want human-readable facet filtering (OR within a family, AND across families)
4. `steam_store_search`, `steam_find_similar`, or `steam_link_generate` when deeper comparison or links are useful; `steam_find_similar` can stay deterministic or use optional official prioritization for store-side comparison only with `mode="official"`, `scope="store"` or `scope="both"`, and a resolvable selected user
5. `steam_export` for JSON or Markdown handoff

## Safety notes

- Prompts never bypass runtime safeguards.
- `steam_collection_apply` remains the only tool that mutates Steam-owned state.
- `steam_collection_plan` may persist MCP-owned durable plan files under the local state directory.
