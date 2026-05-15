import { z } from 'zod';
import { resolveSteamWebApiSteamId } from '@steam-mcp/steam-core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamWishlistOnSaleArgsSchema = z.object({
  limit: z.number().int().positive().optional()
});

const steamWishlistOnSaleInputSchema = {
  limit: steamWishlistOnSaleArgsSchema.shape.limit
};

export const steamWishlistOnSaleInputShape = steamWishlistOnSaleInputSchema;

export function registerSteamWishlistOnSaleTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_wishlist_on_sale',
    {
      title: 'Steam wishlist on sale',
      description: 'Read-only wishlist sale view for the selected Steam user via official wishlist access plus live public appdetails price_overview metadata. Steam Web API key dependent. Does not use GetWishlistItemsOnSale. Items with missing price metadata are counted in unknownPriceCount and omitted from items.',
      inputSchema: steamWishlistOnSaleInputSchema
    },
    async (rawArgs) => {
      const args = steamWishlistOnSaleArgsSchema.parse(rawArgs);
      const discovery = await context.discoveryService.discover();
      const selectedUserId = discovery.selectedUserId;
      if (!selectedUserId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'No selected Steam user was found; steam_wishlist_on_sale requires a discoverable selected user.'
            }, null, 2)
          }]
        };
      }

      const steamId = resolveSteamWebApiSteamId(selectedUserId);
      if (!steamId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'The selected Steam user could not be resolved to a SteamID64; steam_wishlist_on_sale requires a valid SteamID64.'
            }, null, 2)
          }]
        };
      }

      try {
        const result = await context.wishlistSaleService.listOnSale({
          steamId,
          ...(args.limit === undefined ? {} : { limit: args.limit })
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown steam_wishlist_on_sale failure.'
            }, null, 2)
          }]
        };
      }
    }
  );
}
