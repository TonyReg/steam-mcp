---
name: steam-deck-backlog-triage
description: "Use when the user wants to triage their Steam backlog for Steam Deck play using verified/playable filters and deterministic ranking. Trigger phrases: 'Steam Deck backlog', 'what should I play on Deck', 'Deck verified backlog', 'find Deck playable games'."
---

# Steam Deck Backlog Triage

Use this skill for Steam Deck-focused backlog analysis of the owned library built on top of the Steam MCP prompt `steam_deck_backlog_triage`.

## When to Use

- The user wants to shortlist owned backlog games for Steam Deck.
- The user wants Verified/Playable filtering.
- The user wants deterministic ranking based on favorites, collections, genres, tags, and play patterns.

## Workflow

1. Start with the MCP prompt `steam_deck_backlog_triage` when your client supports prompts.
2. Call `steam_status` first to confirm the active Steam environment and backend state.
3. Use `steam_library_search` with `played=false` and the relevant `deckStatuses` filter.
4. Use `steam_find_similar` if you need deterministic ranking against known favorites or recent play patterns.
5. Use `steam_export` for a shortlist and `steam_link_generate` for store/library/launch links.

## Safety Rules

- This workflow is read-only by default.
- Keep the workflow focused on the owned backlog rather than general Steam store discovery.
- Keep reasoning explicit and deterministic: Deck status, genres, tags, collections, favorites, hidden flags, and playtime.
- Do not escalate to collection mutation unless the user separately asks for collection reorganization.

## Tool Order Reference

```text
steam_status
steam_library_search
steam_find_similar
steam_export
steam_link_generate
```

## Notes

- Use `verified` as the default Deck filter unless the user asks for broader `playable` results.
- If the user also wants category changes for the shortlist, switch to the `steam-collection-planner` skill after triage.
- If the user wants to browse the wider Steam store rather than triage the owned backlog, switch to the `steam-library-curator` workflow instead.
