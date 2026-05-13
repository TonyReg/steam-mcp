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
  steam-discovery-router/
    SKILL.md
  steam-recently-played/
    SKILL.md
  steam-featured-scout/
    SKILL.md
  steam-store-query/
    SKILL.md
  steam-release-scout/
    SKILL.md
```

## What these skills do

- **`steam-library-curator`**
  - library-first analysis of the owned Steam library
  - deterministic recommendations from owned games, with optional store enrichment/comparison when useful
  - export and `steam://` link workflows

- **`steam-collection-planner`**
  - plan-first collection and hidden-state workflows with read-only or ignored collection protection
  - explicitly separates preview planning from Steam-owned mutation

- **`steam-deck-backlog-triage`**
  - Steam Deck backlog filtering and deterministic shortlist generation from the owned library

- **`steam-discovery-router`**
  - prompt-first guidance for broad Steam discovery asks that need one primary path plus at most one adjacent fallback
  - keeps provenance explicit while routing only across the current validated discovery surface

- **`steam-recently-played`**
  - read-only inspection of recently played games for the selected Steam user through the official Steam Web API path
  - deterministic follow-up comparison, export, and link workflows after the recent-play pass

- **`steam-featured-scout`**
  - read-only authenticated official marketing-backed featured/editorial discovery via `GetItemsToFeature`
  - preserves marketing ordering after official enrichment, deduplication, and bounded filtering, with export/link follow-up workflows after the featured pass

- **`steam-store-query`**
  - read-only authenticated official catalog discovery that preserves official defaults when optional filters are omitted and supports bounded type, locale, release-state, free-to-play, and human-readable include/exclude facet filters
  - `includeFacets` is opt-in enrichment only; bounded post-filtering may return fewer than the requested limit, `facetsAvailable=false` means no facet payload could be attached for that item, and export/comparison/link follow-up workflows stay available

- **`steam-release-scout`**
  - read-only scouting for upcoming or newly released Steam catalog apps through authenticated official catalog access
  - deterministic export/link/comparison follow-up after the release shortlist

These skills are designed to sit on top of the MCP prompts already implemented in this repo:

- `steam_library_curator`
- `steam_collection_planner`
- `steam_deck_backlog_triage`
- `steam_discovery_router`
- `steam_recently_played`
- `steam_featured_scout`
- `steam_store_query`
- `steam_release_scout`

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
