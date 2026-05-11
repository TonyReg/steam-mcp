---
name: steam-release-scout
description: "Use when the user wants to scout upcoming or newly released Steam catalog apps through authenticated official catalog access. Trigger phrases: 'upcoming Steam releases', 'new Steam releases', 'what is coming soon on Steam', 'steam release scout', 'recent Steam releases'."
---

# Steam Release Scout

Use this skill for read-only Steam release scouting built on top of the Steam MCP prompt `steam_release_scout`.

## When to Use

- The user wants to scout upcoming or newly released Steam apps through the official catalog path.
- The user wants to narrow the shortlist by app type such as games, software, or DLC.
- The user wants follow-up comparison, export, or store links after the scouting pass, using deterministic overlap by default and optional official store prioritization when explicitly useful.

## Workflow

1. Start with the MCP prompt `steam_release_scout` when your client supports prompts.
2. Call `steam_status` first and confirm the detected Steam user and whether `STEAM_API_KEY` is available for authenticated official catalog access.
3. Use `steam_release_scout` for the primary read-only scouting pass.
4. Add `steam_store_search` for deeper storefront context, `steam_find_similar` for owned-library overlap or optional official store prioritization only with `mode="official"`, `scope="store"` or `scope="both"`, and a resolvable selected user, and `steam_link_generate` for store links when useful.
5. Use `steam_export` for JSON or Markdown handoff when the user wants a durable shortlist.

## Safety Rules

- This workflow is read-only by default.
- If `steam_status` reports that `STEAM_API_KEY` is unavailable, stop and tell the user that `steam_release_scout` requires authenticated official catalog access.
- Keep reasoning explicit: release status, app type, store metadata, explicit filters such as `limit`, `types`, and `comingSoonOnly`, plus optional official prioritization when it was used.
- Do not switch to collection mutation unless the user separately asks to change Steam-owned state.

## Tool Order Reference

```text
steam_status
steam_release_scout
steam_store_search | steam_find_similar | steam_link_generate
steam_export
```

## Notes

- Use the prompt defaults unless the user asks to narrow or widen the release window.
- Prefer `comingSoonOnly=true` when the user asks for upcoming releases and `comingSoonOnly=false` when they want both upcoming and recent releases.
