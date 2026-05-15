import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { resolveSelectedSteamUserSteamId } from './selected-steam-user.js';

const steamWishlistDiscountSummaryInputShape = {
  limit: z.number().int().min(1).max(100).optional(),
  minimumDiscountPercent: z.number().int().min(1).max(100).optional()
};

const steamWishlistDiscountSummaryArgsSchema = z.object(steamWishlistDiscountSummaryInputShape);
const steamWishlistDiscountSummaryInputSchema: Record<string, z.ZodTypeAny> = steamWishlistDiscountSummaryInputShape;

export function registerSteamWishlistDiscountSummaryTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_wishlist_discount_summary',
    {
      title: 'Steam wishlist discount summary',
      description: 'Read-only selected-user wishlist discount summary from live public appdetails price metadata; counts scan all wishlist items before applying the item limit.',
      inputSchema: steamWishlistDiscountSummaryInputSchema
    },
    async (rawArgs) => {
      const args = steamWishlistDiscountSummaryArgsSchema.parse(rawArgs);
      const selectedUser = await resolveSelectedSteamUserSteamId(context, 'steam_wishlist_discount_summary');
      if (!selectedUser.ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: selectedUser.error }, null, 2) }] };
      }

      try {
        const result = await context.wishlistEnrichmentService.summarizeDiscounts({
          steamId: selectedUser.steamId,
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.minimumDiscountPercent === undefined ? {} : { minimumDiscountPercent: args.minimumDiscountPercent })
        });

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown steam_wishlist_discount_summary failure.' }, null, 2)
          }]
        };
      }
    }
  );
}
