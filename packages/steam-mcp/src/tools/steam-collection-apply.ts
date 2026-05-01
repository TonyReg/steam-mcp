import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';

type SteamCollectionApplyToolResult = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
};

type SteamCollectionApplyToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: z.ZodTypeAny;
};

type SteamCollectionApplyToolHandler = (
  rawArgs: unknown
) => SteamCollectionApplyToolResult | Promise<SteamCollectionApplyToolResult>;

function registerToolShallow(
  server: McpServer,
  name: string,
  config: SteamCollectionApplyToolConfig,
  cb: SteamCollectionApplyToolHandler
): void {
  const registerTool: unknown = Reflect.get(server, 'registerTool');
  if (typeof registerTool !== 'function') {
    throw new Error('McpServer.registerTool is unavailable.');
  }

  registerTool.call(server, name, config, cb);
}

const steamCollectionApplyInputShape = {
  planId: z.string().min(1),
  dryRun: z.boolean().optional(),
  requireSteamClosed: z.boolean().optional()
};

const steamCollectionApplyArgsSchema = z.object(steamCollectionApplyInputShape);

export function registerSteamCollectionApplyTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_collection_apply',
    {
      title: 'Steam collection apply',
      description: 'Apply a previously generated durable collection plan with backup-first, drift-checked, rollback-capable mutation safety.',
      inputSchema: steamCollectionApplyArgsSchema
    },
    async (rawArgs: unknown) => {
      const args = steamCollectionApplyArgsSchema.parse(rawArgs);
      const result = await context.collectionService.applyPlan(args.planId, {
        dryRun: args.dryRun,
        requireSteamClosed: args.requireSteamClosed
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
