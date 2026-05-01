import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { exportFormatSchema } from '../schemas/index.js';

const steamExportInputShape = {
  source: z.enum(['library', 'plan']),
  format: exportFormatSchema,
  planId: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional()
};

const steamExportArgsSchema = z.object(steamExportInputShape);
const steamExportInputSchema: Record<string, z.ZodTypeAny> = steamExportInputShape;

export function registerSteamExportTool(server: McpServer, context: SteamMcpContext): void {
  server.registerTool(
    'steam_export',
    {
      title: 'Steam export',
      description: 'Render library or plan data to JSON or Markdown without writing export files to disk.',
      inputSchema: steamExportInputSchema
    },
    async (rawArgs) => {
      const args = steamExportArgsSchema.parse(rawArgs);
      if (args.source === 'plan') {
        if (!args.planId) {
          throw new Error('planId is required when exporting a plan.');
        }

        const plan = await context.collectionService.readPlan(args.planId);
        const result = context.exportService.render('plan', args.format, plan);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }

      const library = await context.libraryService.list({ includeStoreMetadata: true, includeDeckStatus: false, limit: args.limit ?? 100 });
      const result = context.exportService.render('library', args.format, library.games);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
