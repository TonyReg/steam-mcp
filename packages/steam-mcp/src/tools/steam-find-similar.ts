import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeCollectionName, normalizeWhitespace, resolveSteamWebApiSteamId, uniqueCollectionNames } from '@steam-mcp/steam-core';
import type { SearchMatch, StoreSearchCandidate } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { deckStatusSchema } from '../schemas/index.js';
import {
  enrichStoreCandidatesWithCacheableDetails,
  mergeSimilarStoreCandidateWithCacheableDetails
} from './store-cacheable-details-batch.js';

const steamFindSimilarInputShape = {
  seedAppIds: z.array(z.number().int().positive()).optional(),
  query: z.string().min(1).optional(),
  scope: z.enum(['library', 'store', 'both']).optional(),
  mode: z.enum(['deterministic', 'official']).optional(),
  deckStatuses: z.array(deckStatusSchema).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  ignoreCollections: z.array(z.string()).optional()
};

const steamFindSimilarArgsSchema = z.object(steamFindSimilarInputShape);
const steamFindSimilarInputSchema: Record<string, z.ZodTypeAny> = steamFindSimilarInputShape;

export function registerSteamFindSimilarTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_find_similar',
    {
      title: 'Steam similar games',
      description: 'Find similar games using deterministic metadata overlap from the library and optional official or store-backed candidates.',
      inputSchema: steamFindSimilarInputSchema
    },
    async (rawArgs) => {
      const args = steamFindSimilarArgsSchema.parse(rawArgs);
      const config = context.configService.resolve();
      const effectiveIgnoreCollections = uniqueCollectionNames([...config.defaultIgnoreCollections, ...(args.ignoreCollections ?? [])]);
      const normalizedIgnoreCollections = new Set(effectiveIgnoreCollections.map((collection) => normalizeCollectionName(collection)));
      const normalizedQuery = normalizeWhitespace(args.query ?? '');
      const effectiveArgs = {
        ...args,
        mode: args.mode ?? 'deterministic',
        query: normalizedQuery === '' ? undefined : normalizedQuery,
        ignoreCollections: effectiveIgnoreCollections
      };
      const scope = args.scope ?? 'library';
      const library = await context.libraryService.list({ includeStoreMetadata: true, includeDeckStatus: true, limit: 5000 });
      const libraryMatches = context.recommendService.rankSimilarLibraryGames(library.games, effectiveArgs);

      if (effectiveArgs.mode === 'official' && scope === 'library') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'steam_find_similar mode="official" requires scope="store" or scope="both".'
            }, null, 2)
          }]
        };
      }

      if (scope === 'library') {
        return {
          content: [{ type: 'text', text: JSON.stringify(libraryMatches, null, 2) }]
        };
      }

      const seedGames = args.seedAppIds?.length
        ? library.games
          .filter((game) => args.seedAppIds?.includes(game.appId))
          .filter((game) => !(game.collections ?? []).some((gameCollection) => normalizedIgnoreCollections.has(normalizeCollectionName(gameCollection))))
        : normalizedQuery === ''
          ? []
          : context.searchService.searchLibrary(library.games, {
            query: normalizedQuery,
            ignoreCollections: effectiveIgnoreCollections,
            deckStatuses: args.deckStatuses,
            limit: 3
          }).map((match) => match.item);
      const storeSearchQuery = normalizedQuery || seedGames[0]?.name;
      const storeCandidates = storeSearchQuery
        ? await enrichStoreCandidatesWithCacheableDetails(
          context.storeClient,
          await context.storeClient.search({ query: storeSearchQuery, deckStatuses: args.deckStatuses, limit: args.limit ?? 20 }),
          mergeSimilarStoreCandidateWithCacheableDetails
        )
        : [];
      let storeMatches: SearchMatch<StoreSearchCandidate>[];
      if (effectiveArgs.mode === 'official') {
        try {
          storeMatches = await rankOfficialStoreCandidates(context, storeCandidates);
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown steam_find_similar official-mode failure.'
              }, null, 2)
            }]
          };
        }
      } else {
        storeMatches = storeCandidates.length === 0
          ? []
          : context.recommendService.rankSimilarStoreCandidates(seedGames, storeCandidates);
      }
      const result = scope === 'store'
        ? storeMatches
        : { library: libraryMatches, store: storeMatches };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

async function rankOfficialStoreCandidates(
  context: SteamMcpContext,
  candidates: StoreSearchCandidate[]
): Promise<SearchMatch<StoreSearchCandidate>[]> {
  if (candidates.length === 0) {
    return [];
  }

  const discovery = await context.discoveryService.discover();
  const selectedUserId = discovery.selectedUserId;
  if (!selectedUserId) {
    throw new Error('No selected Steam user was found; steam_find_similar mode="official" requires a discoverable selected user.');
  }

  const steamId = resolveSteamWebApiSteamId(selectedUserId);
  if (!steamId) {
    throw new Error('The selected Steam user could not be resolved to a SteamID64; steam_find_similar mode="official" requires a valid SteamID64.');
  }

  const prioritized = await context.officialStoreClient.prioritizeAppsForUser({
    appIds: candidates.map((candidate) => candidate.appId),
    steamId,
    includeOwnedGames: true
  });
  const candidateById = new Map(candidates.map((candidate) => [candidate.appId, candidate]));
  const prioritizedMatches = prioritized.apps
    .map((app, index) => {
      const candidate = candidateById.get(app.appId);
      if (!candidate) {
        return undefined;
      }

      return {
        item: candidate,
        score: Math.max(candidates.length - index, 1),
        reasons: ['official store prioritization']
      } satisfies SearchMatch<StoreSearchCandidate>;
    })
    .filter((match): match is SearchMatch<StoreSearchCandidate> => Boolean(match));
  const prioritizedIds = new Set(prioritizedMatches.map((match) => match.item.appId));
  const trailingMatches = candidates
    .filter((candidate) => !prioritizedIds.has(candidate.appId))
    .map((candidate) => ({
      item: candidate,
      score: 0,
      reasons: ['official store prioritization unavailable for this candidate']
    }) satisfies SearchMatch<StoreSearchCandidate>);

  return [...prioritizedMatches, ...trailingMatches];
}
