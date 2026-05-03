import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { uniqueCollectionNames } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
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
  ignoreGroups: z.array(z.string()).optional(),
  sortBy: z.enum(['name', 'playtime', 'lastPlayed']).optional(),
  limit: z.number().int().min(1).max(500).optional()
};

const steamLibraryListArgsSchema = z.object(steamLibraryListInputShape);
const steamLibraryListInputSchema: Record<string, z.ZodTypeAny> = steamLibraryListInputShape;

export function registerSteamLibraryListTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_library_list',
    {
      title: 'Steam library list',
      description: 'List local Steam games with store metadata and optional deck enrichment.',
      inputSchema: steamLibraryListInputSchema
    },
    async (rawArgs) => {
      const args = steamLibraryListArgsSchema.parse(rawArgs);
      const config = context.configService.resolve();
      const effectiveIgnoreGroups = uniqueCollectionNames([...config.defaultIgnoreGroups, ...(args.ignoreGroups ?? [])]);
      const effectiveArgs = {
        ...args,
        includeStoreMetadata: true,
        ignoreGroups: effectiveIgnoreGroups
      };
      const result = await context.libraryService.list(effectiveArgs);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
