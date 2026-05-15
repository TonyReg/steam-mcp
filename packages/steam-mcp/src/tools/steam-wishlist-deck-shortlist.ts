import { z } from 'zod';
import type { DeckStatus, GameRecord, SearchMatch, StoreSearchCandidate, WishlistEnrichedItem } from '@steam-mcp/steam-core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { deckStatusSchema } from '../schemas/index.js';
import { resolveSelectedSteamUserSteamId } from './selected-steam-user.js';
import { wishlistItemToGameRecord } from './steam-wishlist-search.js';

const steamWishlistDeckShortlistInputShape = {
  limit: z.number().int().min(1).max(100).optional(),
  deckStatuses: z.array(deckStatusSchema).optional(),
  query: z.string().min(1).optional(),
  seedAppIds: z.array(z.number().int().positive()).optional()
};

const steamWishlistDeckShortlistArgsSchema = z.object(steamWishlistDeckShortlistInputShape);
const steamWishlistDeckShortlistInputSchema: Record<string, z.ZodTypeAny> = steamWishlistDeckShortlistInputShape;

type WishlistDeckShortlistItem = WishlistEnrichedItem & {
  details: NonNullable<WishlistEnrichedItem['details']>;
  deckStatus: DeckStatus;
  score?: number;
  reasons?: string[];
};

export function registerSteamWishlistDeckShortlistTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_wishlist_deck_shortlist',
    {
      title: 'Steam wishlist Deck shortlist',
      description: 'Shortlist selected-user wishlist items for Steam Deck play using existing Deck status data and deterministic search/ranking only. If both query and seedAppIds are supplied, query takes precedence.',
      inputSchema: steamWishlistDeckShortlistInputSchema
    },
    async (rawArgs) => {
      const args = steamWishlistDeckShortlistArgsSchema.parse(rawArgs);
      const selectedUser = await resolveSelectedSteamUserSteamId(context, 'steam_wishlist_deck_shortlist');
      if (!selectedUser.ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: selectedUser.error }, null, 2) }] };
      }

      try {
        const limit = args.limit ?? 20;
        const deckStatuses = args.deckStatuses ?? ['verified', 'playable'] satisfies DeckStatus[];
        const details = await context.wishlistEnrichmentService.listDetails({
          steamId: selectedUser.steamId,
          includeDeckStatus: true
        });
        const eligibleItems = details.items.filter(isWishlistDeckShortlistItem)
          .filter((item) => deckStatuses.includes(item.deckStatus));
        const itemByAppId = new Map(eligibleItems.map((item) => [item.appId, item]));
        const games = eligibleItems.map(wishlistDeckItemToGameRecord);
        let items: WishlistDeckShortlistItem[];
        let matchedCount: number;

        if (args.query) {
          items = context.searchService.searchLibrary(games, {
            query: args.query,
            deckStatuses,
            limit
          }).map((match) => matchToWishlistItem(match, itemByAppId)).filter(isWishlistDeckShortlistItem);
          matchedCount = items.length;
        } else if (args.seedAppIds?.length) {
          const library = await context.libraryService.list({ includeStoreMetadata: true, includeDeckStatus: true, limit: 5000 });
          const seedGames = library.games.filter((game) => args.seedAppIds?.includes(game.appId));
          const candidates = eligibleItems.map(wishlistDeckItemToStoreCandidate);
          items = context.recommendService.rankSimilarStoreCandidates(seedGames, candidates)
            .slice(0, limit)
            .map((match) => matchToWishlistItem(match, itemByAppId))
            .filter(isWishlistDeckShortlistItem);
          matchedCount = items.length;
        } else {
          items = eligibleItems.slice(0, limit);
          matchedCount = eligibleItems.length;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ totalCount: details.totalCount, matchedCount, items }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown steam_wishlist_deck_shortlist failure.' }, null, 2)
          }]
        };
      }
    }
  );
}

function isWishlistDeckShortlistItem(item: WishlistEnrichedItem | undefined): item is WishlistDeckShortlistItem {
  return Boolean(item?.details && item.deckStatus);
}

function wishlistDeckItemToGameRecord(item: WishlistDeckShortlistItem): GameRecord {
  return wishlistItemToGameRecord(item) as GameRecord;
}

function wishlistDeckItemToStoreCandidate(item: WishlistDeckShortlistItem): StoreSearchCandidate {
  return {
    appId: item.appId,
    name: item.details.name,
    ...(item.details.type === undefined ? {} : { type: item.details.type }),
    ...(item.details.releaseDate === undefined ? {} : { releaseDate: item.details.releaseDate }),
    ...(item.details.comingSoon === undefined ? {} : { comingSoon: item.details.comingSoon }),
    ...(item.details.headerImage === undefined ? {} : { headerImage: item.details.headerImage }),
    developers: item.details.developers,
    publishers: item.details.publishers,
    genres: item.details.genres,
    categories: item.details.categories,
    tags: item.details.tags,
    ...(item.details.shortDescription === undefined ? {} : { shortDescription: item.details.shortDescription }),
    storeUrl: item.details.storeUrl,
    deckStatus: item.deckStatus
  };
}

function matchToWishlistItem(
  match: SearchMatch<GameRecord | StoreSearchCandidate>,
  itemByAppId: Map<number, WishlistDeckShortlistItem>
): WishlistDeckShortlistItem | undefined {
  const item = itemByAppId.get(match.item.appId);
  if (!item) {
    return undefined;
  }

  return {
    ...item,
    score: match.score,
    reasons: match.reasons
  };
}
