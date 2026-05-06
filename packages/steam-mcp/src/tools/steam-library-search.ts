import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { uniqueCollectionNames } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { deckStatusSchema } from '../schemas/index.js';

const steamLibrarySearchInputShape = {
  query: z.string().min(1),
  favorite: z.boolean().optional(),
  hidden: z.boolean().optional(),
  collections: z.array(z.string()).optional(),
  played: z.boolean().optional(),
  deckStatuses: z.array(deckStatusSchema).optional(),
  ignoreCollections: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(200).optional()
};

const steamLibrarySearchArgsSchema = z.object(steamLibrarySearchInputShape);
const steamLibrarySearchInputSchema: Record<string, z.ZodTypeAny> = steamLibrarySearchInputShape;

export function registerSteamLibrarySearchTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_library_search',
    {
      title: 'Steam library search',
      description: 'Search the local Steam library with deterministic ranking and explicit match reasons.',
      inputSchema: steamLibrarySearchInputSchema
    },
    async (rawArgs) => {
      const args = steamLibrarySearchArgsSchema.parse(rawArgs);
      const config = context.configService.resolve();
      const effectiveIgnoreCollections = uniqueCollectionNames([...config.defaultIgnoreCollections, ...(args.ignoreCollections ?? [])]);
      const effectiveArgs = {
        ...args,
        ignoreCollections: effectiveIgnoreCollections
      };
      const library = await context.libraryService.list({ includeStoreMetadata: true, includeDeckStatus: true, limit: 5000 });
      const result = context.searchService.searchLibrary(library.games, effectiveArgs);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
