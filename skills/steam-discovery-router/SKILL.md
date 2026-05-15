---
name: steam-discovery-router
description: "Use when the user has a broad Steam discovery request and needs guidance to choose one primary discovery path plus at most one adjacent fallback across the current validated Steam MCP surface. Trigger phrases: 'steam discovery router', 'help me find something on Steam', 'browse something new on Steam', 'which Steam discovery tool should I use', 'route this Steam discovery request'."
---

# Steam Discovery Router

Use this skill for broad-intent Steam discovery routing built on top of the Steam MCP prompt `steam_discovery_router`.

## When to Use

- The user has a broad Steam discovery request and the right discovery surface is not obvious yet.
- The user wants help deciding between library-first, wishlist-first, release-first, featured/editorial, authenticated catalog, public-store lookup, or similarity-driven discovery.
- The user needs one primary discovery path and, only if necessary, one adjacent fallback without collapsing the MCP into an opaque mega-tool.
- The user wants explicit provenance for why a specific discovery path was chosen.

## Workflow

1. Start with the MCP prompt `steam_discovery_router` when your client supports prompts.
2. Call `steam_status` first and confirm whether `STEAM_API_KEY` is available and whether a selected Steam user can be resolved when the likely path depends on user-specific data.
3. Choose exactly one primary path before calling any discovery surface.
4. Route to `steam_library_curator` for owned-library analysis, recommendations, exports, and links; `steam_wishlist_curator` for selected-user wishlist curation, sale/discount discovery, wishlist search, or wishlist Deck shortlisting; `steam_deck_backlog_triage` for Deck-friendly backlog asks; `steam_recently_played` for selected-user recent activity; `steam_find_similar` for “like this” / overlap intent; `steam_release_scout` for new or upcoming releases; `steam_featured_scout` for featured/editorial/promoted discovery; `steam_store_query` for authenticated official catalog filtering; and `steam_store_search` for simpler public-store lookup.
5. Allow at most one adjacent fallback only when the primary path yields too few usable results or cannot satisfy the request honestly without changing semantics.
6. Keep fallbacks adjacent and explicit: release or featured discovery may fall back to `steam_store_query`; `steam_store_query` may fall back to `steam_store_search`; recently played or library analysis may use `steam_find_similar` only as a follow-up comparison step; wishlist curation may use `steam_store_search` or `steam_link_generate` only after the wishlist primary step when public-store context or direct links are needed.
7. Use `steam_export` and `steam_link_generate` after the main discovery step when the user wants handoff artifacts or direct links.

## Safety Rules

- This workflow is prompt-only guidance over the existing validated discovery surface; it does not add a new discovery tool or a new Steam endpoint contract.
- Keep provenance explicit: name the chosen primary path, and if a fallback was needed, name that path and explain why.
- Do not route anything to the removed storefront curator/list discovery surface or any removed curator/list API path.
- Do not confuse `steam_library_curator` with the removed storefront-curator discovery surface; `steam_library_curator` is still valid because it is the owned-library workflow.
- If the selected primary path requires `STEAM_API_KEY` or selected-user resolution and `steam_status` shows that prerequisite missing, stop unless one adjacent public fallback still satisfies the same request honestly.
- Wishlist routing depends on both `STEAM_API_KEY` and a selected Steam user that can be resolved to a SteamID64.

## Tool Order Reference

```text
steam_status
steam_discovery_router
steam_library_curator | steam_wishlist_curator | steam_deck_backlog_triage | steam_recently_played | steam_find_similar | steam_release_scout | steam_featured_scout | steam_store_query | steam_store_search
steam_export | steam_link_generate
```

## Notes

- Prefer a single clear primary path over blending multiple discovery tools together.
- Use `preferredSource` only as a routing hint; it should not override the actual user intent when the request clearly belongs elsewhere.
- Reopen a first-class MCP router tool only if this prompt-only contract later proves insufficient.
