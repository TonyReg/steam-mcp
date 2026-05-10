import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreSearchCandidate } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { deckStatusSchema } from '../schemas/index.js';

const steamStoreSearchInputShape = {
  query: z.string().min(1),
  freeToPlay: z.boolean().optional(),
  deckStatuses: z.array(deckStatusSchema).optional(),
  limit: z.number().int().min(1).max(100).optional()
};

const steamStoreSearchArgsSchema = z.object(steamStoreSearchInputShape);
const steamStoreSearchInputSchema: Record<string, z.ZodTypeAny> = steamStoreSearchInputShape;

async function enrichStoreSearchCandidatesWithCacheableDetails(
  storeClient: SteamMcpContext['storeClient'],
  candidates: StoreSearchCandidate[]
): Promise<StoreSearchCandidate[]> {
  return Promise.all(candidates.map(async (candidate) => {
    const details = await storeClient.getCacheableAppDetails(candidate.appId);
    if (!details) {
      return candidate;
    }

    return {
      ...candidate,
      type: details.type ?? candidate.type,
      releaseDate: details.releaseDate ?? candidate.releaseDate,
      comingSoon: details.comingSoon ?? candidate.comingSoon,
      developers: details.developers,
      publishers: details.publishers,
      genres: details.genres,
      categories: details.categories,
      tags: details.tags,
      shortDescription: details.shortDescription ?? candidate.shortDescription,
      headerImage: details.headerImage ?? candidate.headerImage,
      storeUrl: details.storeUrl ?? candidate.storeUrl
    } satisfies StoreSearchCandidate;
  }));
}

export function registerSteamStoreSearchTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_store_search',
    {
      title: 'Steam store search',
      description: 'Search the public Steam store without authenticated session reuse.',
      inputSchema: steamStoreSearchInputSchema
    },
    async (rawArgs) => {
      const args = steamStoreSearchArgsSchema.parse(rawArgs);
      const result = await enrichStoreSearchCandidatesWithCacheableDetails(
        context.storeClient,
        await context.storeClient.search(args)
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
