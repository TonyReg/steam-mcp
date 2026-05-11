import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamStoreQueryTypeSchema = z.enum(['game', 'software', 'dlc']);

const steamStoreQueryInputShape = {
  limit: z.number().int().min(1).max(100).optional(),
  types: z.array(steamStoreQueryTypeSchema).optional(),
  comingSoonOnly: z.boolean().optional(),
  freeToPlay: z.boolean().optional()
};

const steamStoreQueryArgsSchema = z.object(steamStoreQueryInputShape);
const steamStoreQueryInputSchema: Record<string, z.ZodTypeAny> = steamStoreQueryInputShape;

export function registerSteamStoreQueryTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_store_query',
    {
      title: 'Steam store query',
      description: 'Query the authenticated official Steam catalog with type, release-state, and free-to-play filters. Read-only and Steam Web API key dependent.',
      inputSchema: steamStoreQueryInputSchema
    },
    async (rawArgs) => {
      const args = steamStoreQueryArgsSchema.parse(rawArgs);

      try {
        const result = await context.officialStoreClient.queryItems(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result.items, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown steam_store_query failure.'
            }, null, 2)
          }]
        };
      }
    }
  );
}
