---
name: steam-curator-discovery
description: "Use when the user wants authenticated official Steam curator/list summary discovery, bounded limit or start paging over curator metadata, or a read-only curator shortlist without per-list app details yet. Trigger phrases: 'steam curator discovery', 'Steam curators', 'Steam curator lists', 'Steam themed picks', 'show curator lists', 'browse Steam curators'."
---

# Steam Curator Discovery

Use this skill for read-only authenticated curator/list summary discovery built on top of the Steam MCP prompt `steam_curator_discovery`.

## When to Use

- The user wants Steam curator lists, curator channels, or themed picks rather than featured/editorial placements or release scouting.
- The user wants authenticated official curator/list metadata through `GetLists`.
- The user wants to page through curator/list summaries with `limit` and `start`.
- The user wants a JSON or Markdown handoff of curator/list summaries before any later drill-down work.

## Workflow

1. Start with the MCP prompt `steam_curator_discovery` when your client supports prompts.
2. Call `steam_status` first and confirm whether `STEAM_API_KEY` is available for authenticated official curation access.
3. Use `steam_curator_discovery` for the primary read-only pass over curator/list metadata.
4. Use `limit` and `start` only to page the official curator/list summary feed while preserving upstream ordering.
5. Explain that the current bounded slice returns curator/list summaries only and does not expose per-list app details yet.
6. Switch to `steam_featured_scout` for featured/editorial placements and `steam_release_scout` for release-specific scouting.
7. Use `steam_export` for JSON or Markdown handoff, and use `steam_link_generate` only when enough identifiers already exist for useful follow-up links.

## Safety Rules

- This workflow is read-only by default.
- If `steam_status` reports that `STEAM_API_KEY` is unavailable, stop and tell the user that `steam_curator_discovery` requires authenticated official access.
- Keep reasoning explicit: curator identity, list title, description, app count, paging inputs, and the fact that the backing method is `GetLists` metadata-only mode.
- Do not improvise with featured, release, or collection-mutation workflows when the user specifically asked for curator/list discovery.

## Tool Order Reference

```text
steam_status
steam_curator_discovery
steam_featured_scout | steam_release_scout | steam_link_generate
steam_export
```

## Notes

- Use the prompt defaults unless the user explicitly wants a different page size or offset.
- This slice is intentionally metadata-only; per-list app detail expansion is future work and should not be implied.
- Prefer `steam_featured_scout` instead of `steam_curator_discovery` when the user is really asking for featured/editorial placements rather than curator/list channels.
