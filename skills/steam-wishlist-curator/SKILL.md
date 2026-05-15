---
name: steam-wishlist-curator
description: "Use when the user wants read-only selected-user wishlist curation, sale/discount discovery, wishlist search, Deck shortlisting, exports, or link generation. Trigger phrases: 'curate my wishlist', 'wishlist on sale', 'search my wishlist', 'wishlist deck shortlist', 'wishlist discount summary'."
---

# Steam Wishlist Curator

Use this skill for read-only selected-user wishlist workflows built on top of the Steam MCP prompt `steam_wishlist_curator`.

## When to Use

- The user wants to inspect or curate the selected user's wishlist without mutating Steam-owned wishlist state.
- The user wants wishlist search, enriched wishlist details, sale/discount discovery, or discount summaries.
- The user wants a Steam Deck-friendly shortlist from wishlist items rather than from the owned backlog.
- The user wants export or direct store links after a wishlist-first analysis pass.

## Workflow

1. Start with the MCP prompt `steam_wishlist_curator` when your client supports prompts.
2. Call `steam_status` first and confirm the selected Steam user, whether `STEAM_API_KEY` is available, and whether the selected user can be resolved to a SteamID64.
3. Use `steam_wishlist` for a quick raw membership/count pass or `steam_wishlist_details` when enriched public appdetails metadata or optional Deck context is needed.
4. Use `steam_wishlist_search` for query-driven filtering, `steam_wishlist_on_sale` or `steam_wishlist_discount_summary` for sale/discount intent, and `steam_wishlist_deck_shortlist` for Deck-focused shortlist generation.
5. Use `steam_export` for JSON/Markdown handoff and `steam_link_generate` for store or launch links after the wishlist pass.

## Safety Rules

- This workflow is read-only by default.
- If `steam_status` reports that `STEAM_API_KEY` is unavailable, stop and tell the user the wishlist workflow cannot run until authenticated Steam Web API access is configured.
- If no selected Steam user is available or the selected user cannot be resolved to a SteamID64, stop and tell the user the wishlist workflow cannot run until selected-user resolution is fixed.
- Keep provenance explicit: official wishlist APIs provide membership/count data, while public appdetails enrichment adds details, optional Deck context, and live price metadata where applicable.
- Preserve existing caveats in your reasoning: `steam_wishlist_details` reports `missingDetailsCount` only for the scanned slice after any `limit`; `steam_wishlist_on_sale` may report `unknownPriceCount`; `steam_wishlist_discount_summary` counts ignore the returned-item limit; and `steam_wishlist_deck_shortlist` gives `query` precedence over `seedAppIds` when both are supplied.
- Do not switch to wishlist add/remove or undocumented wishlist sale/filter/category endpoints in this workflow.

## Tool Order Reference

```text
steam_status
steam_wishlist | steam_wishlist_details
steam_wishlist_search
steam_wishlist_on_sale | steam_wishlist_discount_summary
steam_wishlist_deck_shortlist
steam_export
steam_link_generate
```

## Notes

- Prefer `steam_wishlist_details` when the user needs enriched appdetails metadata or optional Deck context; prefer `steam_wishlist` when raw membership/count is enough.
- Prefer `steam_wishlist_discount_summary` when the user wants whole-wishlist sale totals or currency aggregates; prefer `steam_wishlist_on_sale` when the user mainly wants the current discounted item list.
- Keep this workflow separate from `steam-library-curator`; wishlist-first curation is not the same as owned-library analysis.
