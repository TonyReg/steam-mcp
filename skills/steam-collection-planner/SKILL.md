---
name: steam-collection-planner
description: "Use when the user wants to plan Steam collection or hidden-state changes safely before any apply step. Trigger phrases: 'create categories', 'plan Steam collections', 'hide games', 'prepare collection changes'."
---

# Steam Collection Planner

Use this skill for plan-first Steam collection workflows built on top of the Steam MCP prompt `steam_collection_planner`.

## When to Use

- The user wants to create or reorganize named collections.
- The user wants to adjust hidden flags or protect user-managed groups from MCP changes.
- The user wants a safe preview before any Steam-owned mutation happens.

## Workflow

1. Start with the MCP prompt `steam_collection_planner` when your client supports prompts.
2. Call `steam_status` first and confirm the selected Steam user, the `cloudstorage-json` backend, and whether Steam-owned writes are enabled.
3. Use `steam_library_search` or `steam_library_list` to inspect the target games.
4. Call `steam_collection_plan` to create a durable preview artifact.
5. Review `matchedGames`, warnings, destructive status, and the plan identifier with the user.
6. Only call `steam_collection_apply` after explicit user confirmation and only when Steam-owned writes are enabled.

## Safety Rules

- `steam_collection_plan` may write MCP-owned durable plan files; that is allowed.
- `steam_collection_apply` is the only tool that mutates Steam-owned state.
- Never call `steam_collection_apply` unless the user explicitly asks for the mutation.
- Remind the user that apply is backup-first, drift-checked, atomic, rollback-capable, and Steam-closed by default.

## Tool Order Reference

```text
steam_status
steam_library_search | steam_library_list
steam_collection_plan
review with user
steam_collection_apply (only with explicit confirmation)
```

## Notes

- Prefer `add-only` mode unless the user clearly wants destructive replacement behavior.
- If the plan includes warnings or destructive changes, surface them before proposing apply.
