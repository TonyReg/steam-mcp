import { z } from 'zod';
import { resolveSteamWebApiSteamId } from '@steam-mcp/steam-core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamWishlistInputShape = {
  limit: z.number().int().min(1).max(100).optional()
};

const steamWishlistArgsSchema = z.object(steamWishlistInputShape);
const steamWishlistInputSchema: Record<string, z.ZodTypeAny> = steamWishlistInputShape;

export function registerSteamWishlistTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_wishlist',
    {
      title: 'Steam wishlist',
      description: 'List wishlist items for the selected Steam user via the official Steam Web API. Read-only and Steam Web API key dependent.',
      inputSchema: steamWishlistInputSchema
    },
    async (rawArgs) => {
      const args = steamWishlistArgsSchema.parse(rawArgs);
      const discovery = await context.discoveryService.discover();
      const selectedUserId = discovery.selectedUserId;
      if (!selectedUserId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'No selected Steam user was found; steam_wishlist requires a discoverable selected user.'
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
              error: 'The selected Steam user could not be resolved to a SteamID64; steam_wishlist requires a valid SteamID64.'
            }, null, 2)
          }]
        };
      }

      try {
        const result = await context.wishlistService.list({ steamId });
        const items = args.limit === undefined ? result.items : result.items.slice(0, args.limit);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalCount: result.totalCount,
              items
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown steam_wishlist failure.'
            }, null, 2)
          }]
        };
      }
    }
  );
}
