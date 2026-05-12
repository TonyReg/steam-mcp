import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OfficialStoreListsOptions, OfficialStoreListsResult, SteamCuratorDiscoveryResult } from '../../../steam-core/src/types.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamCuratorDiscoveryInputShape = {
  limit: z.number().int().min(1).max(100).optional(),
  start: z.number().int().min(0).max(10000).optional()
};

const steamCuratorDiscoveryArgsSchema = z.object(steamCuratorDiscoveryInputShape);
const steamCuratorDiscoveryInputSchema: Record<string, z.ZodTypeAny> = steamCuratorDiscoveryInputShape;

function buildFiltersApplied(limit: number, start: number | undefined): string[] {
  return [
    `limit:${String(limit)}`,
    `start:${String(start ?? 0)}`,
    'metadataOnly:true'
  ];
}

function getOfficialCurationClient(context: SteamMcpContext): SteamMcpContext['officialStoreClient'] & {
  getLists(request?: OfficialStoreListsOptions): Promise<OfficialStoreListsResult>;
} {
  return context.officialStoreClient as SteamMcpContext['officialStoreClient'] & {
    getLists(request?: OfficialStoreListsOptions): Promise<OfficialStoreListsResult>;
  };
}

function buildCuratorDiscoveryResult(
  item: OfficialStoreListsResult['lists'][number],
  filtersApplied: string[]
): SteamCuratorDiscoveryResult {
  return {
    listId: item.listId,
    title: item.title,
    source: 'curation',
    ordering: 'curation',
    method: 'getLists',
    filtersApplied,
    ...(item.curatorName === undefined ? {} : { curatorName: item.curatorName }),
    ...(item.curatorSteamId === undefined ? {} : { curatorSteamId: item.curatorSteamId }),
    ...(item.description === undefined ? {} : { description: item.description }),
    ...(item.appCount === undefined ? {} : { appCount: item.appCount })
  };
}

export function registerSteamCuratorDiscoveryTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_curator_discovery',
    {
      title: 'Steam curator discovery',
      description: 'Browse authenticated official Steam curator/list metadata only. Read-only and Steam Web API key dependent.',
      inputSchema: steamCuratorDiscoveryInputSchema
    },
    async (rawArgs) => {
      const args = steamCuratorDiscoveryArgsSchema.parse(rawArgs);
      const limit = args.limit ?? 20;
      const start = args.start;
      const officialCurationClient = getOfficialCurationClient(context);

      try {
        const result = await officialCurationClient.getLists({
          count: limit,
          ...(start === undefined ? {} : { start }),
          returnMetadataOnly: true
        });
        const filtersApplied = buildFiltersApplied(limit, start);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result.lists.map((item) => buildCuratorDiscoveryResult(item, filtersApplied)), null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown steam_curator_discovery failure.'
            }, null, 2)
          }]
        };
      }
    }
  );
}
