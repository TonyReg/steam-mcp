import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { planIdSchema } from '../schemas/index.js';

const steamCollectionApplyInputShape = {
  planId: planIdSchema,
  dryRun: z.boolean().optional(),
  requireSteamClosed: z.boolean().optional(),
  experimentalFinalize: z.boolean().optional()
};

const steamCollectionApplyArgsSchema = z.object(steamCollectionApplyInputShape);

export function registerSteamCollectionApplyTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_collection_apply',
    {
      title: 'Steam collection apply',
      description: 'Apply a previously generated durable collection plan. Experimental JSON-only two-stage cloudstorage sync is available with experimentalFinalize=false for dirty stage and experimentalFinalize=true for finalize; omitted keeps one-shot behavior. Experimental staged calls require pair-array cloudstorage format and reject requireSteamClosed=false.',
      inputSchema: steamCollectionApplyArgsSchema
    },
    async (rawArgs: unknown) => {
      const args = steamCollectionApplyArgsSchema.parse(rawArgs);
      const result = await context.collectionService.applyPlan(args.planId, {
        dryRun: args.dryRun,
        requireSteamClosed: args.requireSteamClosed,
        experimentalFinalize: args.experimentalFinalize
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
