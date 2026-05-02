import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
      const result = await context.storeClient.search(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
