import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { deckStatusSchema } from '../schemas/index.js';

const steamFindSimilarInputShape = {
  seedAppIds: z.array(z.number().int().positive()).optional(),
  query: z.string().min(1).optional(),
  scope: z.enum(['library', 'store', 'both']).optional(),
  deckStatuses: z.array(deckStatusSchema).optional(),
  limit: z.number().int().min(1).max(100).optional()
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
      const scope = args.scope ?? 'library';
      const library = await context.libraryService.list({ includeStoreMetadata: true, includeDeckStatus: true, limit: 5000 });
      const libraryMatches = context.recommendService.rankSimilarLibraryGames(library.games, args);

      if (scope === 'library') {
        return {
          content: [{ type: 'text', text: JSON.stringify(libraryMatches, null, 2) }]
        };
      }

      const seedGames = args.seedAppIds?.length
        ? library.games.filter((game) => args.seedAppIds?.includes(game.appId))
        : library.games.filter((game) => args.query ? game.name.toLowerCase().includes(args.query.toLowerCase()) : false).slice(0, 3);
      const storeCandidates = await context.storeClient.search({ query: args.query ?? seedGames[0]?.name ?? '', deckStatuses: args.deckStatuses, limit: args.limit ?? 20 });
      const storeMatches = context.recommendService.rankSimilarStoreCandidates(seedGames, storeCandidates);
      const result = scope === 'store'
        ? storeMatches
        : { library: libraryMatches, store: storeMatches };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
