import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { deckStatusSchema } from '../schemas/index.js';

const steamLibraryListInputShape = {
  includeStoreMetadata: z.boolean().optional(),
  includeDeckStatus: z.boolean().optional(),
  installedOnly: z.boolean().optional(),
  hidden: z.boolean().optional(),
  favorite: z.boolean().optional(),
  collections: z.array(z.string()).optional(),
  played: z.boolean().optional(),
  deckStatuses: z.array(deckStatusSchema).optional(),
  sortBy: z.enum(['name', 'playtime', 'lastPlayed']).optional(),
  limit: z.number().int().min(1).max(500).optional()
};

const steamLibraryListArgsSchema = z.object(steamLibraryListInputShape);
const steamLibraryListInputSchema: Record<string, z.ZodTypeAny> = steamLibraryListInputShape;

export function registerSteamLibraryListTool(server: McpServer, context: SteamMcpContext): void {
  server.registerTool(
    'steam_library_list',
    {
      title: 'Steam library list',
      description: 'List local Steam games with optional store and deck enrichment.',
      inputSchema: steamLibraryListInputSchema
    },
    async (rawArgs) => {
      const args = steamLibraryListArgsSchema.parse(rawArgs);
      const result = await context.libraryService.list(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
