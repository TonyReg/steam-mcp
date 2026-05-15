import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { resolveSelectedSteamUserSteamId } from './selected-steam-user.js';

const steamWishlistDetailsInputShape = {
  limit: z.number().int().min(1).max(500).optional(),
  includeDeckStatus: z.boolean().optional(),
  priceFreshness: z.enum(['cacheable', 'fresh']).optional()
};

const steamWishlistDetailsArgsSchema = z.object(steamWishlistDetailsInputShape);
const steamWishlistDetailsInputSchema: Record<string, z.ZodTypeAny> = steamWishlistDetailsInputShape;

export function registerSteamWishlistDetailsTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_wishlist_details',
    {
      title: 'Steam wishlist details',
      description: 'Read-only selected-user wishlist details enriched with public Steam appdetails metadata and optional existing Deck status heuristics. missingDetailsCount covers only the scanned wishlist items after any limit is applied.',
      inputSchema: steamWishlistDetailsInputSchema
    },
    async (rawArgs) => {
      const args = steamWishlistDetailsArgsSchema.parse(rawArgs);
      const selectedUser = await resolveSelectedSteamUserSteamId(context, 'steam_wishlist_details');
      if (!selectedUser.ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: selectedUser.error }, null, 2) }] };
      }

      try {
        const result = await context.wishlistEnrichmentService.listDetails({
          steamId: selectedUser.steamId,
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.includeDeckStatus === undefined ? {} : { includeDeckStatus: args.includeDeckStatus }),
          ...(args.priceFreshness === undefined ? {} : { priceFreshness: args.priceFreshness })
        });

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown steam_wishlist_details failure.' }, null, 2)
          }]
        };
      }
    }
  );
}
