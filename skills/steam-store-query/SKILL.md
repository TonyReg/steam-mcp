---
name: steam-store-query
description: "Use when the user wants authenticated official Steam catalog discovery with bounded filters, optional authoritative human-readable facet filtering, or optional facet enrichment. Trigger phrases: 'steam store query', 'official Steam catalog', 'filter the Steam catalog', 'authenticated store query', 'find Steam games by genre/tag/category'."
---

# Steam Store Query

Use this skill for read-only authenticated official catalog discovery built on top of the Steam MCP prompt `steam_store_query`.

## When to Use

- The user wants authenticated official Steam catalog discovery rather than unauthenticated public store lookup.
- The user wants bounded type, locale, release-state, or pricing-model filters.
- The user wants human-readable genre, category, or tag include/exclude filtering.
- The user wants optional facet enrichment, export, comparison, or direct store links after the official catalog pass.

## Workflow

1. Start with the MCP prompt `steam_store_query` when your client supports prompts.
2. Call `steam_status` first and confirm the detected Steam user and whether `STEAM_API_KEY` is available for authenticated official catalog access.
3. Use `steam_store_query` for the primary read-only official catalog pass.
4. Add `language` and `countryCode` only when the user wants locale-scoped official catalog results. Add `comingSoonOnly` and `freeToPlay` only when the user wants explicit release-state or pricing-model narrowing.
5. Add `genres`, `categories`, `tags`, `genresExclude`, `categoriesExclude`, and `tagsExclude` only when the user wants human-readable facet filtering. Includes are OR within a facet family and AND across different facet families; any matching exclude facet removes the candidate after authoritative comparison.
6. Add `includeFacets=true` only when the user wants per-item human-readable genres, categories, and tags attached to the results.
7. Use `steam_store_search` for unauthenticated public-store lookup, `steam_release_scout` for release-focused scouting, `steam_find_similar` for comparison, `steam_link_generate` for store links, and `steam_export` for JSON or Markdown handoff when useful.

## Safety Rules

- This workflow is read-only by default.
- If `steam_status` reports that `STEAM_API_KEY` is unavailable, stop and tell the user that `steam_store_query` requires authenticated official catalog access.
- When facet filtering is active, explain that filtering is bounded post-filtering over the candidate window, so fewer than the requested limit may still be returned.
- When `includeFacets=true`, explain that `facetsAvailable=false` means the item remained valid but no facet payload could be attached for that result.
- Do not switch to collection mutation unless the user separately asks to change Steam-owned state.

## Tool Order Reference

```text
steam_status
steam_store_query
steam_store_search | steam_release_scout | steam_find_similar | steam_link_generate
steam_export
```

## Notes

- Leave optional filters unset when the user wants the official client defaults to apply.
- Prefer `steam_store_search` instead of `steam_store_query` when the user does not need authenticated official filtering.
- Keep reasoning explicit: result limits, type filters, locale context, release state, pricing model, include/exclude facet filters, additive metadata, and optional facet enrichment.
