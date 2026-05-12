---
name: steam-recently-played
description: "Use when the user wants to inspect recently played Steam games for the selected account through the official Steam Web API path. Trigger phrases: 'recently played on Steam', 'what have I been playing', 'steam recently played'."
---

# Steam Recently Played

Use this skill for read-only recently played inspection built on top of the Steam MCP prompt `steam_recently_played`.

## When to Use

- The user wants to inspect recently played games for the selected Steam user.
- The user wants a quick recent-play snapshot before deeper comparison or export.
- The user wants store links, overlap analysis, or a durable handoff after the recent-play pass.

## Workflow

1. Start with the MCP prompt `steam_recently_played` when your client supports prompts.
2. Call `steam_status` first and confirm the detected selected Steam user, whether `STEAM_API_KEY` is available, and whether the selected user can be resolved to a SteamID64.
3. Use `steam_recently_played` for the primary read-only pass.
4. Add `limit` only when the user wants a shorter slice of the recent-play list.
5. Add `steam_find_similar` for overlap or follow-up recommendations, `steam_store_search` for storefront context, and `steam_link_generate` for direct links when useful.
6. Use `steam_export` for JSON or Markdown handoff when the user wants a durable recent-play summary.

## Safety Rules

- This workflow is read-only by default.
- If `steam_status` reports that `STEAM_API_KEY` is unavailable, stop and tell the user that `steam_recently_played` requires authenticated Steam Web API access.
- If there is no selected Steam user or the selected user cannot be resolved to a SteamID64, stop and ask the user to fix the selected-user context before continuing.
- Keep reasoning explicit: recent-play ordering, playtime over the last two weeks, lifetime playtime, app identity, and the selected-user context.
- Do not switch to collection mutation unless the user separately asks to change Steam-owned state.

## Tool Order Reference

```text
steam_status
steam_recently_played
steam_find_similar | steam_store_search | steam_link_generate
steam_export
```

## Notes

- Use the full recent-play list unless the user explicitly asks for a shorter slice.
- This workflow depends on the currently selected Steam user; it is not a general-purpose multi-user history query.
