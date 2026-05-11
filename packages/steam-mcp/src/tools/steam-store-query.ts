import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  OfficialStoreItemSummary,
  OfficialStoreQueryItemsOptions,
  StoreAppDetails
} from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const STORE_QUERY_OVERFETCH_MULTIPLIER = 3;

const steamStoreQueryTypeSchema = z.enum(['game', 'software', 'dlc']);

const steamStoreQueryInputShape = {
  limit: z.number().int().min(1).max(100).optional(),
  types: z.array(steamStoreQueryTypeSchema).optional(),
  comingSoonOnly: z.boolean().optional(),
  freeToPlay: z.boolean().optional(),
  genres: z.array(z.string().min(1)).optional(),
  categories: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional()
};

const steamStoreQueryArgsSchema = z.object(steamStoreQueryInputShape);
const steamStoreQueryInputSchema: Record<string, z.ZodTypeAny> = steamStoreQueryInputShape;

type SteamStoreQueryArgs = z.infer<typeof steamStoreQueryArgsSchema>;

function getStoreQueryCandidateLimit(limit: number): number {
  return Math.min(100, Math.max(limit, limit * STORE_QUERY_OVERFETCH_MULTIPLIER));
}

function normalizeFacetFilter(values: string[] | undefined): string[] | undefined {
  const normalized = values
    ?.map((value) => value.trim().toLowerCase())
    .filter((value): value is string => value.length > 0);

  return normalized && normalized.length > 0 ? normalized : undefined;
}

function buildOfficialStoreQueryArgs(args: SteamStoreQueryArgs, limitOverride?: number): OfficialStoreQueryItemsOptions {
  const request: OfficialStoreQueryItemsOptions = {};

  const limit = limitOverride ?? args.limit;
  if (limit !== undefined) {
    request.limit = limit;
  }

  if (args.types !== undefined) {
    request.types = args.types;
  }

  if (args.comingSoonOnly !== undefined) {
    request.comingSoonOnly = args.comingSoonOnly;
  }

  if (args.freeToPlay !== undefined) {
    request.freeToPlay = args.freeToPlay;
  }

  return request;
}

function matchesFacetFamily(expected: string[] | undefined, actual: string[]): boolean {
  if (!expected || expected.length === 0) {
    return true;
  }

  const normalizedActual = new Set(actual.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0));
  return expected.some((value) => normalizedActual.has(value));
}

function matchesFacetFilters(
  details: StoreAppDetails,
  genres: string[] | undefined,
  categories: string[] | undefined,
  tags: string[] | undefined
): boolean {
  return matchesFacetFamily(genres, details.genres)
    && matchesFacetFamily(categories, details.categories)
    && matchesFacetFamily(tags, details.tags);
}

async function filterItemsByCacheableFacets(
  context: SteamMcpContext,
  items: OfficialStoreItemSummary[],
  limit: number | undefined,
  genres: string[] | undefined,
  categories: string[] | undefined,
  tags: string[] | undefined
): Promise<OfficialStoreItemSummary[]> {
  const matches: OfficialStoreItemSummary[] = [];

  for (const item of items) {
    let details: StoreAppDetails | undefined;

    try {
      details = await context.storeClient.getCacheableAppDetails(item.appId);
    } catch {
      continue;
    }

    if (!details) {
      continue;
    }

    if (!matchesFacetFilters(details, genres, categories, tags)) {
      continue;
    }

    matches.push(item);
    if (limit !== undefined && matches.length >= limit) {
      break;
    }
  }

  return matches;
}

export function registerSteamStoreQueryTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_store_query',
    {
      title: 'Steam store query',
      description: 'Query the authenticated official Steam catalog with type, release-state, free-to-play, and human-readable genre/category/tag filters. Read-only and Steam Web API key dependent.',
      inputSchema: steamStoreQueryInputSchema
    },
    async (rawArgs) => {
      const args = steamStoreQueryArgsSchema.parse(rawArgs);
      const normalizedGenres = normalizeFacetFilter(args.genres);
      const normalizedCategories = normalizeFacetFilter(args.categories);
      const normalizedTags = normalizeFacetFilter(args.tags);
      const requiresFacetFiltering = Boolean(normalizedGenres || normalizedCategories || normalizedTags);

      try {
        if (!requiresFacetFiltering) {
          const result = await context.officialStoreClient.queryItems(buildOfficialStoreQueryArgs(args));
          return {
            content: [{ type: 'text', text: JSON.stringify(result.items, null, 2) }]
          };
        }

        const result = await context.officialStoreClient.queryItems(
          buildOfficialStoreQueryArgs(
            args,
            getStoreQueryCandidateLimit(args.limit ?? 20)
          )
        );
        const filteredItems = await filterItemsByCacheableFacets(
          context,
          result.items,
          args.limit,
          normalizedGenres,
          normalizedCategories,
          normalizedTags
        );

        return {
          content: [{ type: 'text', text: JSON.stringify(filteredItems, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown steam_store_query failure.'
            }, null, 2)
          }]
        };
      }
    }
  );
}
