import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  OfficialStoreItemsToFeatureFamily,
  OfficialStoreItemsToFeatureOptions,
  OfficialStoreItemsToFeatureResult,
  OfficialStoreItemSummary,
  SteamFeaturedScoutResult
} from '../../../steam-core/src/types.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamFeaturedScoutTypeSchema = z.enum(['game', 'software', 'dlc']);

const steamFeaturedScoutInputShape = {
  limit: z.number().int().min(1).max(100).optional(),
  types: z.array(steamFeaturedScoutTypeSchema).optional(),
  language: z.string().min(1).optional(),
  countryCode: z.string().min(1).optional()
};

const steamFeaturedScoutArgsSchema = z.object(steamFeaturedScoutInputShape);
const steamFeaturedScoutInputSchema: Record<string, z.ZodTypeAny> = steamFeaturedScoutInputShape;

const FEATURED_FAMILIES: OfficialStoreItemsToFeatureFamily[] = [
  'spotlights',
  'daily_deals',
  'specials',
  'purchase_recommendations'
];

const FEATURED_OVERFETCH_MULTIPLIER = 3;

function getFeaturedCandidateLimit(limit: number): number {
  return Math.min(100, Math.max(limit, limit * FEATURED_OVERFETCH_MULTIPLIER));
}

function collectFeaturedCandidates(
  payload: OfficialStoreItemsToFeatureResult,
  limit: number
): Array<{ appId: number; marketingBucket: OfficialStoreItemsToFeatureFamily }> {
  const candidateLimit = getFeaturedCandidateLimit(limit);
  const candidates: Array<{ appId: number; marketingBucket: OfficialStoreItemsToFeatureFamily }> = [];
  const seenAppIds = new Set<number>();

  for (const family of FEATURED_FAMILIES) {
    for (const appId of payload[family]) {
      if (seenAppIds.has(appId)) {
        continue;
      }

      seenAppIds.add(appId);
      candidates.push({ appId, marketingBucket: family });
      if (candidates.length >= candidateLimit) {
        return candidates;
      }
    }
  }

  return candidates;
}

function buildFiltersApplied(types: Array<'game' | 'software' | 'dlc'>): string[] {
  return [`types:${types.join(',')}`];
}

function getOfficialMarketingClient(context: SteamMcpContext): SteamMcpContext['officialStoreClient'] & {
  getItemsToFeature(request?: OfficialStoreItemsToFeatureOptions): Promise<OfficialStoreItemsToFeatureResult>;
} {
  return context.officialStoreClient as SteamMcpContext['officialStoreClient'] & {
    getItemsToFeature(request?: OfficialStoreItemsToFeatureOptions): Promise<OfficialStoreItemsToFeatureResult>;
  };
}

function buildFeaturedResult(
  item: OfficialStoreItemSummary,
  marketingBucket: OfficialStoreItemsToFeatureFamily,
  filtersApplied: string[]
): SteamFeaturedScoutResult | undefined {
  if (!item.type) {
    return undefined;
  }

  return {
    appId: item.appId,
    name: item.name,
    type: item.type,
    releaseDate: item.releaseDate,
    comingSoon: item.comingSoon ?? false,
    ...(item.freeToPlay === undefined ? {} : { freeToPlay: item.freeToPlay }),
    source: 'marketing',
    ordering: 'marketing',
    method: 'itemsToFeature',
    marketingBucket,
    filtersApplied,
    storeUrl: item.storeUrl
  };
}

export function registerSteamFeaturedScoutTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_featured_scout',
    {
      title: 'Steam featured scout',
      description: 'Scout authenticated official Steam marketing placements for featured/editorial apps, then enrich them with official store metadata. Read-only and Steam Web API key dependent.',
      inputSchema: steamFeaturedScoutInputSchema
    },
    async (rawArgs) => {
      const args = steamFeaturedScoutArgsSchema.parse(rawArgs);
      const limit = args.limit ?? 20;
      const types = args.types ?? ['game', 'software', 'dlc'];
      const requestedTypes = new Set(types);
      const language = args.language;
      const countryCode = args.countryCode;
      const officialMarketingClient = getOfficialMarketingClient(context);

      try {
        const featuredResult = await officialMarketingClient.getItemsToFeature({
          ...(language === undefined ? {} : { language }),
          ...(countryCode === undefined ? {} : { countryCode })
        });

        const candidates = collectFeaturedCandidates(featuredResult, limit);
        if (candidates.length === 0) {
          return {
            content: [{ type: 'text', text: JSON.stringify([], null, 2) }]
          };
        }

        const itemsResult = await context.officialStoreClient.getItems({
          appIds: candidates.map((candidate) => candidate.appId),
          ...(language === undefined ? {} : { language }),
          ...(countryCode === undefined ? {} : { countryCode })
        });

        const itemsByAppId = new Map(itemsResult.items.map((item) => [item.appId, item]));
        const filtersApplied = buildFiltersApplied(types);
        const results: SteamFeaturedScoutResult[] = [];

        for (const candidate of candidates) {
          const item = itemsByAppId.get(candidate.appId);
          if (!item?.type || !requestedTypes.has(item.type)) {
            continue;
          }

          const result = buildFeaturedResult(item, candidate.marketingBucket, filtersApplied);
          if (!result) {
            continue;
          }

          results.push(result);
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
              error: error instanceof Error ? error.message : 'Unknown steam_featured_scout failure.'
            }, null, 2)
          }]
        };
      }
    }
  );
}
