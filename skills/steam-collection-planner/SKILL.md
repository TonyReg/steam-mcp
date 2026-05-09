---
name: steam-collection-planner
description: "Use when the user wants to plan Steam collection or hidden-state changes safely before any apply step. Trigger phrases: 'create categories', 'plan Steam collections', 'hide games', 'prepare collection changes'."
---

# Steam Collection Planner

Use this skill for plan-first Steam collection workflows built on top of the Steam MCP prompt `steam_collection_planner`.

## When to Use

- The user wants to create or reorganize named collections.
- The user wants to adjust hidden flags or protect user-managed collections from MCP changes.
- The user wants a safe preview before any Steam-owned mutation happens.

## Workflow

1. Start with the MCP prompt `steam_collection_planner` when your client supports prompts.
2. Call `steam_status` first and confirm the selected Steam user, whether `STEAM_API_KEY` is available for actionable owned-library enumeration, the `cloudstorage-json` backend, and whether Steam-owned writes are enabled via the explicit write-unlock.
3. Use `steam_library_search` or `steam_library_list` to inspect the target games.
4. Call `steam_collection_plan` to create a durable preview artifact.
5. Review `matchedGames`, warnings, destructive status, and the plan identifier with the user.
6. Only call `steam_collection_apply` after explicit user confirmation and only when Steam-owned writes are enabled via `STEAM_ENABLE_COLLECTION_WRITES=1`.
7. Treat `STEAM_ENABLE_WINDOWS_ORCHESTRATION=1` as a separate Windows-only opt-in wrapper, not as a write-unlock; it closes Steam before each apply call but does NOT restart after a successful dirty-only apply (state is staged-only; sync is NOT complete until `finalize=true` succeeds); it restarts only after a finalize apply or after a failed apply if the wrapper stopped it.

## Safety Rules

- `steam_collection_plan` may write MCP-owned durable plan files; that is allowed.
- If `steam_status` reports that `STEAM_API_KEY` is unavailable, stop and tell the user collection planning cannot enumerate actionable owned games until API-authoritative access is configured.
- `steam_collection_apply` is the only tool that mutates Steam-owned state.
- Never call `steam_collection_apply` unless the user explicitly asks for the mutation.
- Remind the user that `STEAM_ENABLE_COLLECTION_WRITES=1` is the explicit write-unlock / operator kill switch.
- Remind the user that `STEAM_ENABLE_WINDOWS_ORCHESTRATION=1` is only an optional Windows wrapper around the existing staged flow; it does not add a new tool argument or relax `requireSteamClosed=false`.
- Remind the user that apply itself is backup-first, drift-checked, atomic, rollback-capable, requires Steam to be closed, uses a dirty-stage then `finalize=true` flow for cloudstorage changes; plain apply is dirty-only (staged; sync NOT complete), `finalize=true` is required to complete sync, orchestration may leave Steam closed after a dirty-only apply, and any restart after finalize is best-effort only and does not imply Steam cloud sync has completed.

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
