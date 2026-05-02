---
name: steam-library-curator
description: "Use when the user wants safe read-only Steam library analysis, deterministic recommendations, optional store enrichment/comparison, exports, or steam:// link generation. Trigger phrases: 'organize my library', 'find similar games', 'recommend from my Steam library', 'export my Steam library', 'generate Steam links'."
---

# Steam Library Curator

Use this skill for library-first, read-heavy Steam workflows built on top of the Steam MCP prompt `steam_library_curator`.

## When to Use

- The user wants to analyze or organize their owned Steam library without mutating Steam-owned state.
- The user wants deterministic recommendations based on genres, tags, favorites, collections, hidden flags, playtime, or Steam Deck status.
- The user wants store enrichment or comparison after starting from the local library, plus JSON/Markdown export or `steam://` launch/store/library/community links.

## Workflow

1. Start with the MCP prompt `steam_library_curator` when your client supports prompts.
2. Call `steam_status` first and confirm the detected Steam user, collection backend, and whether collection writes are enabled.
3. Use `steam_library_list` or `steam_library_search` for the main analysis pass.
4. Add `steam_find_similar` or `steam_store_search` only when you need deterministic comparison or store enrichment beyond the owned library.
5. Use `steam_export` for JSON/Markdown handoff and `steam_link_generate` for actionable links.

## Safety Rules

- Stay read-only by default.
- Keep the workflow library-first; unowned store games may appear only when enrichment or comparison is explicitly useful.
- Do not switch to collection mutation unless the user explicitly asks to change Steam-owned state.
- Explain recommendations in deterministic terms only: tags, genres, collections, favorites, hidden flags, playtime, and Deck status.

## Tool Order Reference

```text
steam_status
steam_library_list | steam_library_search
steam_find_similar | steam_store_search
steam_export
steam_link_generate
```

## Escalation

If the user wants to reorganize named collections or hidden flags, stop this workflow and switch to the `steam-collection-planner` skill.
