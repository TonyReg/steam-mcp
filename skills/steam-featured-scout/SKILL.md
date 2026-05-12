---
name: steam-featured-scout
description: "Use when the user wants authenticated official Steam featured/editorial discovery through marketing placements, bounded type or locale filtering, or a read-only featured shortlist with preserved marketing ordering. Trigger phrases: 'steam featured scout', 'featured Steam games', 'Steam editorial picks', 'Steam daily deals', 'Steam specials', 'featured/editorial Steam apps'."
---

# Steam Featured Scout

Use this skill for read-only authenticated featured/editorial Steam discovery built on top of the Steam MCP prompt `steam_featured_scout`.

## When to Use

- The user wants featured, promoted, or editorial Steam store placements rather than release scouting.
- The user wants authenticated official marketing-backed discovery through `GetItemsToFeature`.
- The user wants to narrow the shortlist by app type such as games, software, or DLC.
- The user wants locale-scoped official featured discovery.
- The user wants export, store links, or follow-up comparison after the featured shortlist is built.

## Workflow

1. Start with the MCP prompt `steam_featured_scout` when your client supports prompts.
2. Call `steam_status` first and confirm the detected Steam user and whether `STEAM_API_KEY` is available for authenticated official marketing access.
3. Use `steam_featured_scout` for the primary read-only featured/editorial pass.
4. Add optional `language` and `countryCode` when the user wants locale-scoped official marketing results.
5. Add optional `types` when the user wants to keep only specific app families after official enrichment. Explain that the returned results preserve marketing ordering after enrichment, deduplication, and bounded filtering.
6. Switch to `steam_release_scout` for release-specific scouting, `steam_store_query` for broader authenticated catalog filtering, and `steam_store_search` for unauthenticated public-store lookup.
7. Use `steam_export` for JSON or Markdown handoff and `steam_link_generate` for direct store links when useful.

## Safety Rules

- This workflow is read-only by default.
- If `steam_status` reports that `STEAM_API_KEY` is unavailable, stop and tell the user that `steam_featured_scout` requires authenticated official marketing access.
- Keep reasoning explicit: featured/editorial intent, result limit, type filters, locale context, preserved marketing ordering, and the fact that this workflow is marketing-backed through `GetItemsToFeature` rather than release scouting.
- Do not improvise with charts, release-query substitutes, or collection mutation when the user specifically asked for featured/editorial discovery.

## Tool Order Reference

```text
steam_status
steam_featured_scout
steam_release_scout | steam_store_query | steam_store_search | steam_link_generate
steam_export
```

## Notes

- Use the prompt defaults unless the user explicitly wants to narrow the featured shortlist.
- Leave `language` and `countryCode` unset when the user wants the official client defaults to apply.
- Prefer `steam_release_scout` instead of `steam_featured_scout` when the user is really asking for upcoming or newly released titles rather than featured/editorial placements.
