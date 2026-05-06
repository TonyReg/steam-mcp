import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { planModeSchema } from '../schemas/index.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamCollectionRuleSchema = z.object({
  appIds: z.array(z.number().int().positive()).optional(),
  query: z.string().optional(),
  collection: z.string().optional(),
  addToCollections: z.array(z.string()).optional(),
  removeFromCollections: z.array(z.string()).optional(),
  setCollections: z.array(z.string()).optional(),
  deleteCollections: z.array(z.string()).optional(),
  hidden: z.boolean().optional()
});

const steamCollectionPlanInputShape = {
  mode: planModeSchema.optional(),
  request: z.string().optional(),
  rules: z.array(steamCollectionRuleSchema).optional(),
  readOnlyCollections: z.array(z.string()).optional(),
  ignoreCollections: z.array(z.string()).optional()
};

const steamCollectionPlanArgsSchema = z.object(steamCollectionPlanInputShape);

export function registerSteamCollectionPlanTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_collection_plan',
    {
      title: 'Steam collection plan',
      description: 'Create a durable preview plan for hidden flags, named collection edits, and collection deletes, with request-scoped read-only or ignored collections, without mutating Steam state.',
      inputSchema: steamCollectionPlanArgsSchema
    },
    async (rawArgs: unknown) => {
      const args = steamCollectionPlanArgsSchema.parse(rawArgs);
      const result = await context.collectionService.createPlan(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
