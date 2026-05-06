import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeCollectionName, normalizeWhitespace, uniqueCollectionNames } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { deckStatusSchema } from '../schemas/index.js';

const steamFindSimilarInputShape = {
  seedAppIds: z.array(z.number().int().positive()).optional(),
  query: z.string().min(1).optional(),
  scope: z.enum(['library', 'store', 'both']).optional(),
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
      description: 'Find similar games using deterministic metadata overlap from the library and optional store candidates.',
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
        query: normalizedQuery === '' ? undefined : normalizedQuery,
        ignoreCollections: effectiveIgnoreCollections
      };
      const scope = args.scope ?? 'library';
      const library = await context.libraryService.list({ includeStoreMetadata: true, includeDeckStatus: true, limit: 5000 });
      const libraryMatches = context.recommendService.rankSimilarLibraryGames(library.games, effectiveArgs);

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
      const storeMatches = storeSearchQuery
        ? context.recommendService.rankSimilarStoreCandidates(
          seedGames,
          await context.storeClient.search({ query: storeSearchQuery, deckStatuses: args.deckStatuses, limit: args.limit ?? 20 })
        )
        : [];
      const result = scope === 'store'
        ? storeMatches
        : { library: libraryMatches, store: storeMatches };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
