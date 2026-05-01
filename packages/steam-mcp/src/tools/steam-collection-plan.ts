import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { planModeSchema } from '../schemas/index.js';

type SteamCollectionPlanToolResult = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
};

type SteamCollectionPlanToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: z.ZodTypeAny;
};

type SteamCollectionPlanToolHandler = (
  rawArgs: unknown
) => SteamCollectionPlanToolResult | Promise<SteamCollectionPlanToolResult>;

function registerToolShallow(
  server: McpServer,
  name: string,
  config: SteamCollectionPlanToolConfig,
  cb: SteamCollectionPlanToolHandler
): void {
  const registerTool: unknown = Reflect.get(server, 'registerTool');
  if (typeof registerTool !== 'function') {
    throw new Error('McpServer.registerTool is unavailable.');
  }

  registerTool.call(server, name, config, cb);
}

const steamCollectionRuleSchema = z.object({
  appIds: z.array(z.number().int().positive()).optional(),
  query: z.string().optional(),
  collection: z.string().optional(),
  addToCollections: z.array(z.string()).optional(),
  removeFromCollections: z.array(z.string()).optional(),
  setCollections: z.array(z.string()).optional(),
  favorite: z.boolean().optional(),
  hidden: z.boolean().optional()
});

const steamCollectionPlanInputShape = {
  mode: planModeSchema.optional(),
  request: z.string().optional(),
  rules: z.array(steamCollectionRuleSchema).optional()
};

const steamCollectionPlanArgsSchema = z.object(steamCollectionPlanInputShape);

export function registerSteamCollectionPlanTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_collection_plan',
    {
      title: 'Steam collection plan',
      description: 'Create a durable preview plan for favorites, hidden flags, and named collections without mutating Steam state.',
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
