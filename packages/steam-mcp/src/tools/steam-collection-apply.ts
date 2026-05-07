import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';
import { planIdSchema } from '../schemas/index.js';

const steamCollectionApplyInputShape = {
  planId: planIdSchema,
  dryRun: z.boolean().optional(),
  requireSteamClosed: z.boolean().optional(),
  finalize: z.literal(true).optional()
};

const steamCollectionApplyArgsSchema = z.object(steamCollectionApplyInputShape);

export function registerSteamCollectionApplyTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_collection_apply',
    {
      title: 'Steam collection apply',
      description: 'Apply a previously generated durable collection plan. STEAM_ENABLE_COLLECTION_WRITES=1 remains required. By default this performs the dirty stage of the staged cloudstorage apply flow (staged-only; Steam cloud sync is NOT complete until finalize succeeds); call again with finalize=true to complete finalize. dryRun=true validates the staged plan without stopping or relaunching Steam. When STEAM_ENABLE_WINDOWS_ORCHESTRATION=1 is enabled on Windows, steam-mcp closes Steam before non-dry-run apply but does NOT relaunch after a successful dirty-only apply (to avoid making staged-only state look sync-complete); restart occurs only after a finalize apply or after a failed apply if the wrapper stopped Steam. Staged apply requires pair-array cloudstorage format and rejects requireSteamClosed=false.',
      inputSchema: steamCollectionApplyArgsSchema
    },
    async (rawArgs: unknown) => {
      const args = steamCollectionApplyArgsSchema.parse(rawArgs);
      const result = await context.collectionService.applyPlan(args.planId, {
        dryRun: args.dryRun,
        requireSteamClosed: args.requireSteamClosed,
        finalize: args.finalize
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
