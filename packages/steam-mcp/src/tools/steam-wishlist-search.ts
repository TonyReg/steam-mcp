import { z } from 'zod';
import type { GameRecord, SearchMatch, WishlistEnrichedItem } from '@steam-mcp/steam-core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { deckStatusSchema } from '../schemas/index.js';
import { resolveSelectedSteamUserSteamId } from './selected-steam-user.js';

const steamWishlistSearchInputShape = {
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  deckStatuses: z.array(deckStatusSchema).optional()
};

const steamWishlistSearchArgsSchema = z.object(steamWishlistSearchInputShape);
const steamWishlistSearchInputSchema: Record<string, z.ZodTypeAny> = steamWishlistSearchInputShape;

export function registerSteamWishlistSearchTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_wishlist_search',
    {
      title: 'Steam wishlist search',
      description: 'Search selected-user wishlist items with existing deterministic library search semantics over public appdetails metadata.',
      inputSchema: steamWishlistSearchInputSchema
    },
    async (rawArgs) => {
      const args = steamWishlistSearchArgsSchema.parse(rawArgs);
      const selectedUser = await resolveSelectedSteamUserSteamId(context, 'steam_wishlist_search');
      if (!selectedUser.ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: selectedUser.error }, null, 2) }] };
      }

      try {
        const details = await context.wishlistEnrichmentService.listDetails({
          steamId: selectedUser.steamId,
          includeDeckStatus: Boolean(args.deckStatuses?.length)
        });
        const itemByAppId = new Map(details.items.map((item) => [item.appId, item]));
        const games = details.items.map(wishlistItemToGameRecord).filter((game): game is GameRecord => Boolean(game));
        const matches = context.searchService.searchLibrary(games, {
          query: args.query,
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.deckStatuses === undefined ? {} : { deckStatuses: args.deckStatuses })
        });
        const result = matches.map((match) => ({
          item: itemByAppId.get(match.item.appId),
          score: match.score,
          reasons: match.reasons
        })).filter((match): match is SearchMatch<WishlistEnrichedItem & { details: NonNullable<WishlistEnrichedItem['details']> }> => Boolean(match.item));

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown steam_wishlist_search failure.' }, null, 2)
          }]
        };
      }
    }
  );
}

export function wishlistItemToGameRecord(item: WishlistEnrichedItem): GameRecord | undefined {
  if (!item.details) {
    return undefined;
  }

  return {
    appId: item.appId,
    name: item.details.name,
    ...(item.deckStatus === undefined ? {} : { deckStatus: item.deckStatus }),
    genres: item.details.genres,
    categories: item.details.categories,
    tags: item.details.tags,
    developers: item.details.developers,
    publishers: item.details.publishers,
    ...(item.details.shortDescription === undefined ? {} : { shortDescription: item.details.shortDescription }),
    ...(item.details.headerImage === undefined ? {} : { headerImage: item.details.headerImage }),
    storeUrl: item.details.storeUrl
  };
}
