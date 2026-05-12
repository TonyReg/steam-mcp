import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { deckStatusSchema, planModeSchema } from '../schemas/index.js';
import { registerPromptShallow } from '../mcp/register-tool-shallow.js';

const steamLibraryCuratorPromptArgs = {
  goal: z.string().min(1),
  deckStatus: deckStatusSchema.optional()
};
const steamLibraryCuratorPromptSchema = z.object(steamLibraryCuratorPromptArgs);

const steamCollectionPlannerPromptArgs = {
  request: z.string().min(1),
  mode: planModeSchema.optional()
};
const steamCollectionPlannerPromptSchema = z.object(steamCollectionPlannerPromptArgs);

const steamDeckBacklogPromptArgs = {
  focus: z.string().optional(),
  deckStatus: deckStatusSchema.optional()
};
const steamDeckBacklogPromptSchema = z.object(steamDeckBacklogPromptArgs);

const steamRecentlyPlayedPromptArgs = {
  limit: z.string().optional().describe('Optional integer result limit as a string, for example "10".')
};
const steamRecentlyPlayedPromptSchema = z.object(steamRecentlyPlayedPromptArgs);

const steamStoreQueryPromptArgs = {
  limit: z.string().optional().describe('Optional integer result limit as a string, for example "20".'),
  types: z.string().optional().describe('Optional comma-separated store item types string, for example "game,dlc".'),
  language: z.string().optional().describe('Optional Steam language string, for example "schinese" or "japanese".'),
  countryCode: z.string().optional().describe('Optional Steam country code string, for example "US" or "JP".'),
  comingSoonOnly: z.string().optional().describe('Optional boolean string: "true" or "false".'),
  freeToPlay: z.string().optional().describe('Optional boolean string: "true" or "false" to require free-to-play or paid results.'),
  includeFacets: z.string().optional().describe('Optional boolean string: "true" or "false" to request per-item human-readable facets.'),
  genres: z.string().optional().describe('Optional comma-separated genre filters string, for example "puzzle,adventure".'),
  categories: z.string().optional().describe('Optional comma-separated category filters string, for example "single-player,co-op".'),
  tags: z.string().optional().describe('Optional comma-separated tag filters string, for example "story rich,co-op".'),
  genresExclude: z.string().optional().describe('Optional comma-separated excluded genre filters string, for example "horror,anime".'),
  categoriesExclude: z.string().optional().describe('Optional comma-separated excluded category filters string, for example "multi-player,vr".'),
  tagsExclude: z.string().optional().describe('Optional comma-separated excluded tag filters string, for example "survival,roguelike".')
};
const steamStoreQueryPromptSchema = z.object(steamStoreQueryPromptArgs);

const steamReleaseScoutPromptTypeSchema = z.enum(['game', 'software', 'dlc']);
type SteamReleaseScoutPromptType = z.infer<typeof steamReleaseScoutPromptTypeSchema>;

const steamReleaseScoutPromptArgs = {
  limit: z.string().optional().describe('Optional integer result limit as a string, for example "20".'),
  types: z.string().optional().describe('Optional comma-separated release types string, for example "game,dlc".'),
  language: z.string().optional().describe('Optional Steam language string, for example "schinese" or "japanese".'),
  countryCode: z.string().optional().describe('Optional Steam country code string, for example "US" or "JP".'),
  comingSoonOnly: z.string().optional().describe('Optional boolean string: "true" or "false".'),
  freeToPlay: z.string().optional().describe('Optional boolean string: "true" or "false" to require free-to-play or paid results.'),
  genres: z.string().optional().describe('Optional comma-separated genre filters string, for example "puzzle,adventure".'),
  categories: z.string().optional().describe('Optional comma-separated category filters string, for example "single-player,co-op".'),
  tags: z.string().optional().describe('Optional comma-separated tag filters string, for example "story rich,co-op".')
};
const steamReleaseScoutPromptSchema = z.object(steamReleaseScoutPromptArgs);

function parseSteamReleaseScoutPromptLimit(rawLimit: string | undefined): number | undefined {
  const trimmed = rawLimit?.trim();
  if (!trimmed) {
    return undefined;
  }

  return z.coerce.number().int().min(1).max(100).parse(trimmed);
}

function parseSteamRecentlyPlayedPromptLimit(rawLimit: string | undefined): number | undefined {
  const trimmed = rawLimit?.trim();
  if (!trimmed) {
    return undefined;
  }

  return z.coerce.number().int().min(1).max(100).parse(trimmed);
}

function parseSteamStoreQueryPromptLimit(rawLimit: string | undefined): number | undefined {
  const trimmed = rawLimit?.trim();
  if (!trimmed) {
    return undefined;
  }

  return z.coerce.number().int().min(1).max(100).parse(trimmed);
}

function parseSteamReleaseScoutPromptTypes(rawTypes: string | undefined): SteamReleaseScoutPromptType[] | undefined {
  const trimmed = rawTypes?.trim();
  if (!trimmed) {
    return undefined;
  }

  const values = trimmed.split(',').map((value) => value.trim()).filter((value): value is string => value.length > 0);
  if (values.length === 0) {
    return undefined;
  }

  return z.array(steamReleaseScoutPromptTypeSchema).parse(values);
}

function parseSteamReleaseScoutPromptText(rawValue: string | undefined): string | undefined {
  const trimmed = rawValue?.trim();
  return trimmed ? trimmed : undefined;
}

function parseSteamReleaseScoutPromptComingSoonOnly(rawComingSoonOnly: string | undefined): boolean | undefined {
  const trimmed = rawComingSoonOnly?.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  return z.enum(['true', 'false']).transform((value) => value === 'true').parse(trimmed);
}

function parseSteamStoreQueryPromptBoolean(rawValue: string | undefined): boolean | undefined {
  const trimmed = rawValue?.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  return z.enum(['true', 'false']).transform((value) => value === 'true').parse(trimmed);
}

function parseSteamReleaseScoutPromptFreeToPlay(rawFreeToPlay: string | undefined): boolean | undefined {
  const trimmed = rawFreeToPlay?.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  return z.enum(['true', 'false']).transform((value) => value === 'true').parse(trimmed);
}

function parseSteamReleaseScoutPromptFacetValues(rawValue: string | undefined): string[] | undefined {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return undefined;
  }

  const values = trimmed
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is string => value.length > 0);

  return values.length > 0 ? values : undefined;
}

function parseSteamStoreQueryPromptTypes(rawTypes: string | undefined): SteamReleaseScoutPromptType[] | undefined {
  const trimmed = rawTypes?.trim();
  if (!trimmed) {
    return undefined;
  }

  const values = trimmed.split(',').map((value) => value.trim()).filter((value): value is string => value.length > 0);
  if (values.length === 0) {
    return undefined;
  }

  return z.array(steamReleaseScoutPromptTypeSchema).parse(values);
}

function parseSteamStoreQueryPromptFacetValues(rawValue: string | undefined): string[] | undefined {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return undefined;
  }

  const values = trimmed
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is string => value.length > 0);

  return values.length > 0 ? values : undefined;
}

export function registerSteamPrompts(server: McpServer, context: SteamMcpContext): void {
  registerPromptShallow(
    server,
    'steam_library_curator',
    {
      title: 'Steam library curator',
      description: 'Guide an agent through safe library analysis, search, recommendation, export, and deep-link flows.',
      argsSchema: steamLibraryCuratorPromptArgs
    },
    (rawArgs: unknown) => {
      const { goal, deckStatus } = steamLibraryCuratorPromptSchema.parse(rawArgs);
      return {
        description: 'Safe workflow for analyzing and organizing a Steam library without mutating Steam-owned state.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the Steam MCP to analyze an owned Steam library safely.',
              `Goal: ${goal}`,
              deckStatus ? `Prefer this Steam Deck status when useful: ${deckStatus}.` : 'Use Deck filters only when they improve the answer.',
              'Workflow:',
              '1. Call steam_status first and confirm the detected Steam user, whether Steam Web API access is available for owned-library enumeration, the collection backend, and whether collection writes are enabled.',
              '2. If steam_status reports that STEAM_API_KEY is unavailable, stop and tell the user the owned library cannot be enumerated until API-authoritative access is configured.',
              '3. Use steam_library_list or steam_library_search to inspect the owned library. Add steam_store_query for authenticated official catalog filtering, steam_store_search for unauthenticated public-store lookup, or steam_find_similar when you need comparison; keep steam_find_similar deterministic by default and use mode="official" only for store or both-scope ranking when authenticated official prioritization is explicitly useful.',
              '4. Use steam_export for JSON/Markdown handoff and steam_link_generate for store, community, library, or launch links.',
              '5. Stay read-only by default. If the user asks to reorganize categories, switch to the steam_collection_planner prompt before considering any write path.',
              '6. Explain the reasoning for recommendations or filters in explicit terms such as shared tags, genres, playtime, favorites, Deck status, or official store prioritization when mode="official" was used.'
            ].join('\n')
          }
        }]
      };
    }
  );

  registerPromptShallow(
    server,
    'steam_collection_planner',
    {
      title: 'Steam collection planner',
      description: 'Guide an agent through the safe, plan-first workflow for hidden flags, named collections, and request-scoped read-only or ignored collections.',
      argsSchema: steamCollectionPlannerPromptArgs
    },
    (rawArgs: unknown) => {
      const { request, mode } = steamCollectionPlannerPromptSchema.parse(rawArgs);
      const config = context.configService.resolve();

      return {
        description: 'Plan-first workflow for collection changes without directly mutating Steam-owned state.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the Steam MCP to plan collection changes safely.',
              `Collection request: ${request}`,
              `Requested plan mode: ${mode ?? 'add-only'}.`,
              `Durable preview plans live under: ${config.stateDirectories.plansDir}`,
              'Workflow:',
              '1. Call steam_status first and confirm the selected Steam user, whether Steam Web API access is available for actionable owned-library enumeration, the cloudstorage-json backend, whether Steam-owned writes are enabled via the explicit write-unlock, and whether Windows orchestration is enabled/supported.',
              '2. If steam_status reports that STEAM_API_KEY is unavailable, stop and tell the user collection planning cannot enumerate actionable owned games until API-authoritative access is configured.',
              '3. Use steam_library_search or steam_library_list to inspect the candidate owned games that match the request.',
              '4. Call steam_collection_plan to create a durable preview artifact. Review matchedGames, warnings, destructive status, and the durable plan identifier before proposing any apply step.',
              '5. Do not call steam_collection_apply unless the user explicitly asks to mutate Steam-owned state and the write gate (`STEAM_ENABLE_COLLECTION_WRITES=1`) is enabled.',
              '6. Remind the user that `STEAM_ENABLE_COLLECTION_WRITES=1` remains the write-unlock / operator kill switch. `STEAM_ENABLE_WINDOWS_ORCHESTRATION=1` is only an optional Windows wrapper that closes Steam before each apply call but does NOT relaunch after a dirty-only apply (staged-only; not sync-complete); it relaunches only after a finalize apply or after a failed apply if the wrapper stopped it.',
              '7. Remind the user that apply is backup-first, drift-checked, atomic, rollback-capable, rejects `requireSteamClosed=false`, uses a dirty-stage then `finalize=true` flow, plain apply is dirty-only (staged; sync NOT complete), and any restart after finalize is best-effort only and does not mean Steam cloud sync has completed.'
            ].join('\n')
          }
        }]
      };
    }
  );

  registerPromptShallow(
    server,
    'steam_deck_backlog_triage',
    {
      title: 'Steam Deck backlog triage',
      description: 'Guide an agent through Deck-friendly backlog filtering, ranking, export, and launch-link generation.',
      argsSchema: steamDeckBacklogPromptArgs
    },
    (rawArgs: unknown) => {
      const { focus, deckStatus } = steamDeckBacklogPromptSchema.parse(rawArgs);
      return {
        description: 'Workflow for finding the best owned backlog candidates for Steam Deck play.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the Steam MCP to triage the backlog for Steam Deck play.',
              focus ? `User focus: ${focus}` : 'User focus: find the best near-term Deck-friendly backlog choices.',
              `Primary Deck filter: ${deckStatus ?? 'verified'}.`,
              'Workflow:',
              '1. Call steam_status to confirm the environment, backend state, and whether Steam Web API access is available for owned-library enumeration.',
              '2. If steam_status reports that STEAM_API_KEY is unavailable, stop and tell the user the owned backlog cannot be enumerated until API-authoritative access is configured.',
              '3. Use steam_library_search with played=false and the requested deckStatuses filter to narrow the backlog.',
              '4. Use steam_find_similar when you need to rank candidates by overlap with the user’s known favorites or recent play patterns; keep the default deterministic mode for backlog-first triage and use mode="official" only when store or both-scope ranking is explicitly needed and authenticated official prioritization is available.',
              '5. Use steam_export to produce a Markdown shortlist or JSON payload, and steam_link_generate to provide store/library/launch links for the finalists.',
              '6. Keep the reasoning explicit: Deck status, genres, tags, collections, favorites, hidden flags, playtime, and official store prioritization only when mode="official" was used.'
            ].join('\n')
          }
        }]
      };
    }
  );

  registerPromptShallow(
    server,
    'steam_recently_played',
    {
      title: 'Steam recently played',
      description: 'Guide an agent through read-only recently played retrieval for the selected Steam user via the official Steam Web API.',
      argsSchema: steamRecentlyPlayedPromptArgs
    },
    (rawArgs: unknown) => {
      const parsedArgs = steamRecentlyPlayedPromptSchema.parse(rawArgs);
      const limit = parseSteamRecentlyPlayedPromptLimit(parsedArgs.limit);

      return {
        description: 'Read-only workflow for inspecting recently played games for the selected Steam user via the official Steam Web API.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the Steam MCP to inspect recently played Steam games safely.',
              `Requested result limit: ${limit ?? 'all available recently played games'}.`,
              'Workflow:',
              '1. Call steam_status first and confirm the detected selected Steam user, whether Steam Web API access is available, and whether the selected user can be resolved to a SteamID64.',
              '2. If steam_status reports that STEAM_API_KEY is unavailable, stop and tell the user that steam_recently_played requires authenticated Steam Web API access.',
              '3. If there is no selected Steam user or the selected user cannot be resolved to a SteamID64, stop and tell the user that steam_recently_played cannot run until the user-selection issue is fixed.',
              '4. Use steam_recently_played for the primary read-only pass over the selected user\'s recent play history.',
              '5. Use limit only when the user wants a shorter slice of the recent-play list; otherwise inspect the full returned set.',
              '6. If the user wants more context on recent titles, use steam_find_similar for overlap or follow-up recommendations, steam_store_search for storefront context, and steam_link_generate for direct store or launch links.',
              '7. Use steam_export when the user wants a JSON or Markdown handoff of the recent-play list.',
              '8. Explain results in explicit terms such as playtime over the last two weeks, lifetime playtime, app identity, and the selected-user context.'
            ].join('\n')
          }
        }]
      };
    }
  );

  registerPromptShallow(
    server,
    'steam_store_query',
    {
      title: 'Steam store query',
      description: 'Guide an agent through read-only authenticated official catalog discovery with bounded filters, optional human-readable facet filtering, and optional facet enrichment.',
      argsSchema: steamStoreQueryPromptArgs
    },
    (rawArgs: unknown) => {
      const parsedArgs = steamStoreQueryPromptSchema.parse(rawArgs);
      const limit = parseSteamStoreQueryPromptLimit(parsedArgs.limit);
      const types = parseSteamStoreQueryPromptTypes(parsedArgs.types);
      const language = parseSteamReleaseScoutPromptText(parsedArgs.language);
      const countryCode = parseSteamReleaseScoutPromptText(parsedArgs.countryCode);
      const comingSoonOnly = parseSteamStoreQueryPromptBoolean(parsedArgs.comingSoonOnly);
      const freeToPlay = parseSteamStoreQueryPromptBoolean(parsedArgs.freeToPlay);
      const includeFacets = parseSteamStoreQueryPromptBoolean(parsedArgs.includeFacets);
      const genres = parseSteamStoreQueryPromptFacetValues(parsedArgs.genres);
      const categories = parseSteamStoreQueryPromptFacetValues(parsedArgs.categories);
      const tags = parseSteamStoreQueryPromptFacetValues(parsedArgs.tags);
      const genresExclude = parseSteamStoreQueryPromptFacetValues(parsedArgs.genresExclude);
      const categoriesExclude = parseSteamStoreQueryPromptFacetValues(parsedArgs.categoriesExclude);
      const tagsExclude = parseSteamStoreQueryPromptFacetValues(parsedArgs.tagsExclude);
      const selectedTypes = types?.length ? types.join(', ') : undefined;

      return {
        description: 'Read-only workflow for querying the authenticated official Steam catalog with bounded filters and optional human-readable facet enrichment.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the Steam MCP to query the authenticated official Steam catalog safely.',
              limit === undefined ? 'Requested result limit: leave unset so official client defaults apply.' : `Requested result limit: ${limit}.`,
              selectedTypes ? `Requested store item types: ${selectedTypes}.` : 'Requested store item types: no explicit type filter.',
              language ? `Requested language: ${language}.` : 'Requested language: leave unset so the official client locale default applies.',
              countryCode ? `Requested country code: ${countryCode}.` : 'Requested country code: leave unset so the official client country default applies.',
              comingSoonOnly === undefined ? 'Coming soon only filter: leave unset so official client defaults apply.' : `Coming soon only filter: ${comingSoonOnly}.`,
              freeToPlay === undefined ? 'Free to play filter: no explicit filter.' : `Free to play filter: ${freeToPlay}.`,
              includeFacets === undefined ? 'Include human-readable facets: false unless explicitly requested.' : `Include human-readable facets: ${includeFacets}.`,
              genres === undefined ? 'Requested genre filters: none.' : `Requested genre filters: ${genres.join(', ')}.`,
              categories === undefined ? 'Requested category filters: none.' : `Requested category filters: ${categories.join(', ')}.`,
              tags === undefined ? 'Requested tag filters: none.' : `Requested tag filters: ${tags.join(', ')}.`,
              genresExclude === undefined ? 'Excluded genre filters: none.' : `Excluded genre filters: ${genresExclude.join(', ')}.`,
              categoriesExclude === undefined ? 'Excluded category filters: none.' : `Excluded category filters: ${categoriesExclude.join(', ')}.`,
              tagsExclude === undefined ? 'Excluded tag filters: none.' : `Excluded tag filters: ${tagsExclude.join(', ')}.`,
              'Workflow:',
              '1. Call steam_status first and confirm the detected Steam user and whether `STEAM_API_KEY` is available for authenticated official catalog access.',
              '2. If steam_status reports that STEAM_API_KEY is unavailable, stop and tell the user that steam_store_query requires authenticated official catalog access.',
              '3. Use steam_store_query for the primary read-only discovery pass when the user needs authenticated official filtering rather than unauthenticated public store lookup.',
              '4. Use language and countryCode only when the user wants locale-scoped official catalog results; otherwise keep the official client defaults.',
              '5. Use genres, categories, tags, genresExclude, categoriesExclude, and tagsExclude only when the user wants human-readable facet filtering. Treat includes as OR within one facet family and AND across different facet families; any matching exclude facet removes the candidate after authoritative comparison.',
              '6. Explain that facet filtering is bounded post-filtering over the candidate window, so fewer than the requested limit may still be returned.',
              '7. Use includeFacets=true only when the user wants per-item human-readable genres, categories, and tags attached to the returned results. Explain that facetsAvailable=false means enrichment was attempted but no facet payload was attached for that item.',
              '8. If the user wants simpler unauthenticated lookup, switch to steam_store_search. If they want release-specific scouting, switch to steam_release_scout. If they want comparison or follow-up recommendations on returned titles, use steam_find_similar or steam_link_generate as needed.',
              '9. Use steam_export when the user wants a JSON or Markdown handoff of the filtered catalog results.',
              '10. Keep the reasoning explicit: release state, type filters, locale context, pricing model, include/exclude facet filters, additive metadata, and optional facet enrichment.'
            ].join('\n')
          }
        }]
      };
    }
  );

  registerPromptShallow(
    server,
    'steam_release_scout',
    {
      title: 'Steam release scout',
      description: 'Guide an agent through read-only official catalog scouting for upcoming or newly released Steam apps.',
      argsSchema: steamReleaseScoutPromptArgs
    },
    (rawArgs: unknown) => {
      const parsedArgs = steamReleaseScoutPromptSchema.parse(rawArgs);
      const limit = parseSteamReleaseScoutPromptLimit(parsedArgs.limit);
      const types = parseSteamReleaseScoutPromptTypes(parsedArgs.types);
      const language = parseSteamReleaseScoutPromptText(parsedArgs.language);
      const countryCode = parseSteamReleaseScoutPromptText(parsedArgs.countryCode);
      const comingSoonOnly = parseSteamReleaseScoutPromptComingSoonOnly(parsedArgs.comingSoonOnly);
      const freeToPlay = parseSteamReleaseScoutPromptFreeToPlay(parsedArgs.freeToPlay);
      const genres = parseSteamReleaseScoutPromptFacetValues(parsedArgs.genres);
      const categories = parseSteamReleaseScoutPromptFacetValues(parsedArgs.categories);
      const tags = parseSteamReleaseScoutPromptFacetValues(parsedArgs.tags);
      const selectedTypes = types?.length ? types.join(', ') : 'game, software, dlc';
      return {
        description: 'Read-only workflow for scouting official Steam releases using authenticated official feeds plus official store metadata.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the Steam MCP to scout Steam releases safely.',
              `Requested result limit: ${limit ?? 20}.`,
              `Requested release types: ${selectedTypes}.`,
              language ? `Requested language: ${language}.` : 'Requested language: default official client locale.',
              countryCode ? `Requested country code: ${countryCode}.` : 'Requested country code: default official client locale.',
              `Coming soon only: ${comingSoonOnly ?? true}.`,
              freeToPlay === undefined ? 'Free to play filter: none.' : `Free to play filter: ${freeToPlay}.`,
              genres === undefined ? 'Requested genre filters: none.' : `Requested genre filters: ${genres.join(', ')}.`,
              categories === undefined ? 'Requested category filters: none.' : `Requested category filters: ${categories.join(', ')}.`,
              tags === undefined ? 'Requested tag filters: none.' : `Requested tag filters: ${tags.join(', ')}.`,
              'Workflow:',
              '1. Call steam_status first and confirm the detected Steam user and whether the Steam Web API key is available in MCP runtime.',
              '2. Use steam_release_scout for the primary scouting pass. Keep the workflow read-only and do not fall back to any write path.',
              '3. When useful, pass language and countryCode to scope the official scout to a specific locale context without changing the result shape.',
              '4. When useful, pass freeToPlay=true or freeToPlay=false to narrow the official scout with the same boolean semantics used elsewhere in the MCP.',
              '5. When useful, pass genres, categories, and tags to use the tool\'s existing human-readable facet filters; treat them as OR within one facet family and AND across different facet families.',
              '6. If the user wants deeper context on matches, use steam_store_search for comparison, steam_find_similar for owned-library overlap or optional official store prioritization (only with mode="official", scope="store" or "both", and a resolvable selected user), and steam_link_generate for store links.',
              '7. Use steam_export when the user wants a JSON or Markdown handoff of the shortlisted releases.',
              '8. Explain results in explicit terms such as release status, app type, locale context, free-to-play state, store metadata, and how the shortlist was filtered by limit, types, language, countryCode, comingSoonOnly, freeToPlay, genres, categories, tags, or optional official prioritization.',
              '9. If steam_status or steam_release_scout reports that the Steam Web API key is unavailable, tell the user that steam_release_scout requires `STEAM_API_KEY` and stop instead of improvising with unofficial substitutes.'
            ].join('\n')
          }
        }]
      };
    }
  );
}
