# Steam MCP Skills

This folder contains portable skill definitions for this repository.

Each skill lives in its own folder and uses the standard `SKILL.md` layout:

```text
skills/
  steam-library-curator/
    SKILL.md
  steam-collection-planner/
    SKILL.md
  steam-deck-backlog-triage/
    SKILL.md
```

## What these skills do

- **`steam-library-curator`**
  - read-heavy library analysis
  - deterministic recommendations
  - store enrichment, export, and `steam://` link workflows

- **`steam-collection-planner`**
  - plan-first collection, favorites, and hidden-state workflows
  - explicitly separates preview planning from Steam-owned mutation

- **`steam-deck-backlog-triage`**
  - Steam Deck backlog filtering and deterministic shortlist generation

These skills are designed to sit on top of the MCP prompts already implemented in this repo:

- `steam_library_curator`
- `steam_collection_planner`
- `steam_deck_backlog_triage`

## Why they are stored here

These files are stored under `./skills` inside the repository first so they can be reviewed, versioned, and copied manually later.

This directory is a portable source location, not an auto-loaded runtime location.

## How to reuse them later

When you want to use these skill definitions elsewhere, copy each skill folder as-is into the target tool's expected skill directory.

Keep the one-folder-per-skill structure unchanged when copying or packaging them.

## Safety notes

- These skills are guidance layers, not runtime bypasses.
- `steam_collection_apply` remains the only tool that mutates Steam-owned state.
- `steam_collection_plan` may persist MCP-owned durable plan files under the local state directory.
- Collection changes should remain plan-first and require explicit user confirmation before apply.
