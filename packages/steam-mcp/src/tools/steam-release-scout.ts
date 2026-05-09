import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamReleaseScoutResult } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamReleaseScoutTypeSchema = z.enum(['game', 'software', 'dlc']);

const steamReleaseScoutInputShape = {
  limit: z.number().int().min(1).max(100).optional(),
  types: z.array(steamReleaseScoutTypeSchema).optional(),
  comingSoonOnly: z.boolean().optional()
};

const steamReleaseScoutArgsSchema = z.object(steamReleaseScoutInputShape);
const steamReleaseScoutInputSchema: Record<string, z.ZodTypeAny> = steamReleaseScoutInputShape;

export function registerSteamReleaseScoutTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_release_scout',
    {
      title: 'Steam release scout',
      description: 'Scout official Steam catalog apps and enrich them with public release metadata. Read-only and Steam Web API key dependent.',
      inputSchema: steamReleaseScoutInputSchema
    },
    async (rawArgs) => {
      const args = steamReleaseScoutArgsSchema.parse(rawArgs);
      const limit = args.limit ?? 20;
      const types = new Set(args.types ?? ['game', 'software', 'dlc']);
      const comingSoonOnly = args.comingSoonOnly ?? true;
      const pageSize = Math.min(Math.max(limit, 50), 200);
      const maxPages = 5;
      const includeGames = types.has('game');
      const includeDlc = types.has('dlc');
      const includeSoftware = types.has('software');

      try {
        const results: SteamReleaseScoutResult[] = [];
        let lastAppId: number | undefined;

        for (let page = 0; page < maxPages && results.length < limit; page += 1) {
          const appListRequest = {
            limit: pageSize,
            includeGames,
            includeDlc,
            includeSoftware,
            ...(lastAppId === undefined ? {} : { lastAppId })
          };
          const appList = await context.officialStoreClient.getAppList(appListRequest);

          for (const app of appList.apps) {
            const details = await context.storeClient.getAppDetails(app.appId);
            if (!details?.type || !types.has(details.type)) {
              continue;
            }

            if (comingSoonOnly && details.comingSoon !== true) {
              continue;
            }

            results.push({
              appId: details.appId,
              name: details.name,
              type: details.type,
              releaseDate: details.releaseDate,
              comingSoon: details.comingSoon ?? false,
              storeUrl: details.storeUrl
            });

            if (results.length >= limit) {
              break;
            }
          }

          if (!appList.haveMoreResults || appList.lastAppId === undefined || appList.lastAppId === lastAppId || appList.apps.length === 0) {
            break;
          }

          lastAppId = appList.lastAppId;
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown steam_release_scout failure.'
            }, null, 2)
          }]
        };
      }
    }
  );
}
