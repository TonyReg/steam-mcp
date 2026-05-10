import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamReleaseScoutResult } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamReleaseScoutTypeSchema = z.enum(['game', 'software', 'dlc']);

const steamReleaseScoutInputShape = {
  limit: z.number().int().min(1).max(100).optional(),
  types: z.array(steamReleaseScoutTypeSchema).optional(),
  comingSoonOnly: z.boolean().optional(),
  freeToPlay: z.boolean().optional()
};

const steamReleaseScoutArgsSchema = z.object(steamReleaseScoutInputShape);
const steamReleaseScoutInputSchema: Record<string, z.ZodTypeAny> = steamReleaseScoutInputShape;

export function registerSteamReleaseScoutTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_release_scout',
    {
      title: 'Steam release scout',
      description: 'Scout official Steam release feeds and enrich them with official store metadata. Read-only and Steam Web API key dependent.',
      inputSchema: steamReleaseScoutInputSchema
    },
    async (rawArgs) => {
      const args = steamReleaseScoutArgsSchema.parse(rawArgs);
      const limit = args.limit ?? 20;
      const types = args.types ?? ['game', 'software', 'dlc'];
      const typeSet = new Set(types);
      const comingSoonOnly = args.comingSoonOnly ?? true;
      const freeToPlay = args.freeToPlay;

      try {
        let itemsResult;
        let orderedAppIds: number[];

        if (comingSoonOnly) {
          itemsResult = await context.officialStoreClient.queryItems({
            limit,
            types,
            comingSoonOnly: true,
            ...(freeToPlay === undefined ? {} : { freeToPlay })
          });
          orderedAppIds = itemsResult.items.map((item) => item.appId);
        } else {
          const topReleases = await context.officialStoreClient.getTopReleasesPages();
          orderedAppIds = [];
          const seenAppIds = new Set<number>();

          for (const page of topReleases.pages) {
            for (const appId of page.appIds) {
              if (seenAppIds.has(appId)) {
                continue;
              }

              seenAppIds.add(appId);
              orderedAppIds.push(appId);
            }
          }

          if (orderedAppIds.length === 0) {
            return {
              content: [{ type: 'text', text: JSON.stringify([], null, 2) }]
            };
          }

          itemsResult = await context.officialStoreClient.getItems({ appIds: orderedAppIds });
        }

        const itemsByAppId = new Map(itemsResult.items.map((item) => [item.appId, item]));
        const results: SteamReleaseScoutResult[] = [];
        const filtersApplied = [
          `types:${types.join(',')}`,
          `comingSoonOnly:${String(comingSoonOnly)}`,
          freeToPlay === undefined ? null : `freeToPlay:${String(freeToPlay)}`
        ].filter((value): value is string => value !== null);
        const source = comingSoonOnly ? 'query' : 'charts';

        for (const appId of orderedAppIds) {
          const item = itemsByAppId.get(appId);
          if (!item?.type || !typeSet.has(item.type)) {
            continue;
          }

          if (comingSoonOnly && item.comingSoon !== true) {
            continue;
          }

          if (freeToPlay !== undefined && item.freeToPlay !== freeToPlay) {
            continue;
          }

          results.push({
            appId: item.appId,
            name: item.name,
            type: item.type,
            releaseDate: item.releaseDate,
            comingSoon: item.comingSoon ?? false,
            ...(item.freeToPlay === undefined ? {} : { freeToPlay: item.freeToPlay }),
            source,
            ordering: source,
            filtersApplied,
            storeUrl: item.storeUrl
          });

          if (results.length >= limit) {
            break;
          }
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
