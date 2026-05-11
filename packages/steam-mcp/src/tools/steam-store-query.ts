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
  language: z.string().min(1).optional(),
  countryCode: z.string().min(1).optional(),
  comingSoonOnly: z.boolean().optional(),
  freeToPlay: z.boolean().optional(),
  includeFacets: z.boolean().optional(),
  genres: z.array(z.string().min(1)).optional(),
  categories: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  genresExclude: z.array(z.string().min(1)).optional(),
  categoriesExclude: z.array(z.string().min(1)).optional(),
  tagsExclude: z.array(z.string().min(1)).optional()
};

const steamStoreQueryArgsSchema = z.object(steamStoreQueryInputShape);
const steamStoreQueryInputSchema: Record<string, z.ZodTypeAny> = steamStoreQueryInputShape;

type SteamStoreQueryArgs = z.infer<typeof steamStoreQueryArgsSchema>;

type SteamStoreQueryMetadata = {
  source: 'query';
  filtersApplied: string[];
  authoritativeFacetFiltering: boolean;
};

type SteamStoreQueryFacets = {
  genres: string[];
  categories: string[];
  tags: string[];
};

type SteamStoreQueryResultItem = OfficialStoreItemSummary & {
  metadata: SteamStoreQueryMetadata;
  facets?: SteamStoreQueryFacets;
  facetsAvailable?: boolean;
};

type SteamStoreQueryFacetMatch = {
  item: OfficialStoreItemSummary;
  details: StoreAppDetails;
};

function appendAppliedFilter(
  filtersApplied: string[],
  key: string,
  values: readonly string[] | undefined
): void {
  if (values && values.length > 0) {
    filtersApplied.push(`${key}:${values.join(',')}`);
  }
}

function getStoreQueryCandidateLimit(limit: number): number {
  return Math.min(100, Math.max(limit, limit * STORE_QUERY_OVERFETCH_MULTIPLIER));
}

function canonicalizeFacetValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeFacetFilter(values: string[] | undefined): string[] | undefined {
  const normalized = values
    ?.map(canonicalizeFacetValue)
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

  if (args.language !== undefined) {
    request.language = args.language;
  }

  if (args.countryCode !== undefined) {
    request.countryCode = args.countryCode;
  }

  if (args.comingSoonOnly !== undefined) {
    request.comingSoonOnly = args.comingSoonOnly;
  }

  if (args.freeToPlay !== undefined) {
    request.freeToPlay = args.freeToPlay;
  }

  return request;
}

function buildStoreQueryMetadata(
  args: SteamStoreQueryArgs,
  genres: string[] | undefined,
  categories: string[] | undefined,
  tags: string[] | undefined,
  genresExclude: string[] | undefined,
  categoriesExclude: string[] | undefined,
  tagsExclude: string[] | undefined,
  authoritativeFacetFiltering: boolean
): SteamStoreQueryMetadata {
  const filtersApplied: string[] = [];

  appendAppliedFilter(filtersApplied, 'types', args.types);
  if (args.language !== undefined) {
    filtersApplied.push(`language:${args.language}`);
  }

  if (args.countryCode !== undefined) {
    filtersApplied.push(`countryCode:${args.countryCode}`);
  }

  if (args.comingSoonOnly !== undefined) {
    filtersApplied.push(`comingSoonOnly:${args.comingSoonOnly}`);
  }

  if (args.freeToPlay !== undefined) {
    filtersApplied.push(`freeToPlay:${args.freeToPlay}`);
  }

  appendAppliedFilter(filtersApplied, 'genres', genres);
  appendAppliedFilter(filtersApplied, 'categories', categories);
  appendAppliedFilter(filtersApplied, 'tags', tags);
  appendAppliedFilter(filtersApplied, 'genresExclude', genresExclude);
  appendAppliedFilter(filtersApplied, 'categoriesExclude', categoriesExclude);
  appendAppliedFilter(filtersApplied, 'tagsExclude', tagsExclude);

  return {
    source: 'query',
    filtersApplied,
    authoritativeFacetFiltering
  };
}

function buildStoreQueryFacets(details: StoreAppDetails): SteamStoreQueryFacets {
  return {
    genres: [...details.genres],
    categories: [...details.categories],
    tags: [...details.tags]
  };
}

function attachStoreQueryMetadata(
  items: OfficialStoreItemSummary[],
  metadata: SteamStoreQueryMetadata
): SteamStoreQueryResultItem[] {
  return items.map((item) => ({
    ...item,
    metadata: {
      ...metadata,
      filtersApplied: [...metadata.filtersApplied]
    }
  }));
}

function attachStoreQueryFacets(
  items: SteamStoreQueryResultItem[],
  detailsByAppId: ReadonlyMap<number, StoreAppDetails>
): SteamStoreQueryResultItem[] {
  return items.map((item) => {
    const details = detailsByAppId.get(item.appId);
    if (!details) {
      return {
        ...item,
        facetsAvailable: false
      };
    }

    return {
      ...item,
      facets: buildStoreQueryFacets(details),
      facetsAvailable: true
    };
  });
}

function matchesFacetFamily(expected: string[] | undefined, actual: string[]): boolean {
  if (!expected || expected.length === 0) {
    return true;
  }

  const normalizedActual = new Set(actual.map(canonicalizeFacetValue).filter((value) => value.length > 0));
  return expected.some((value) => normalizedActual.has(value));
}

function matchesExcludedFacetFamily(excluded: string[] | undefined, actual: string[]): boolean {
  if (!excluded || excluded.length === 0) {
    return false;
  }

  const normalizedActual = new Set(actual.map(canonicalizeFacetValue).filter((value) => value.length > 0));
  return excluded.some((value) => normalizedActual.has(value));
}

function matchesFacetFilters(
  details: StoreAppDetails,
  genres: string[] | undefined,
  categories: string[] | undefined,
  tags: string[] | undefined,
  genresExclude: string[] | undefined,
  categoriesExclude: string[] | undefined,
  tagsExclude: string[] | undefined
): boolean {
  return matchesFacetFamily(genres, details.genres)
    && matchesFacetFamily(categories, details.categories)
    && matchesFacetFamily(tags, details.tags)
    && !matchesExcludedFacetFamily(genresExclude, details.genres)
    && !matchesExcludedFacetFamily(categoriesExclude, details.categories)
    && !matchesExcludedFacetFamily(tagsExclude, details.tags);
}

async function filterItemsByCacheableFacets(
  context: SteamMcpContext,
  items: OfficialStoreItemSummary[],
  limit: number | undefined,
  genres: string[] | undefined,
  categories: string[] | undefined,
  tags: string[] | undefined,
  genresExclude: string[] | undefined,
  categoriesExclude: string[] | undefined,
  tagsExclude: string[] | undefined
): Promise<SteamStoreQueryFacetMatch[]> {
  const matches: SteamStoreQueryFacetMatch[] = [];

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

    if (!matchesFacetFilters(details, genres, categories, tags, genresExclude, categoriesExclude, tagsExclude)) {
      continue;
    }

    matches.push({ item, details });
    if (limit !== undefined && matches.length >= limit) {
      break;
    }
  }

  return matches;
}

async function enrichItemsWithOptionalFacets(
  context: SteamMcpContext,
  items: SteamStoreQueryResultItem[]
): Promise<SteamStoreQueryResultItem[]> {
  const detailsByAppId = new Map<number, StoreAppDetails>();

  for (const item of items) {
    try {
      const details = await context.storeClient.getCacheableAppDetails(item.appId);
      if (details) {
        detailsByAppId.set(item.appId, details);
      }
    } catch {
      // Best-effort passthrough enrichment should not drop items.
    }
  }

  return attachStoreQueryFacets(items, detailsByAppId);
}

export function registerSteamStoreQueryTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_store_query',
    {
      title: 'Steam store query',
      description: 'Query the authenticated official Steam catalog with type, release-state, free-to-play, and human-readable genre/category/tag include and exclude filters, plus optional facet enrichment. Read-only and Steam Web API key dependent.',
      inputSchema: steamStoreQueryInputSchema
    },
    async (rawArgs) => {
      const args = steamStoreQueryArgsSchema.parse(rawArgs);
      const normalizedGenres = normalizeFacetFilter(args.genres);
      const normalizedCategories = normalizeFacetFilter(args.categories);
      const normalizedTags = normalizeFacetFilter(args.tags);
      const normalizedGenresExclude = normalizeFacetFilter(args.genresExclude);
      const normalizedCategoriesExclude = normalizeFacetFilter(args.categoriesExclude);
      const normalizedTagsExclude = normalizeFacetFilter(args.tagsExclude);
      const requiresFacetFiltering = Boolean(
        normalizedGenres
        || normalizedCategories
        || normalizedTags
        || normalizedGenresExclude
        || normalizedCategoriesExclude
        || normalizedTagsExclude
      );
      const metadata = buildStoreQueryMetadata(
        args,
        normalizedGenres,
        normalizedCategories,
        normalizedTags,
        normalizedGenresExclude,
        normalizedCategoriesExclude,
        normalizedTagsExclude,
        requiresFacetFiltering
      );

      try {
        if (!requiresFacetFiltering) {
          const result = await context.officialStoreClient.queryItems(buildOfficialStoreQueryArgs(args));
          const metadataItems = attachStoreQueryMetadata(result.items, metadata);
          const responseItems = args.includeFacets
            ? await enrichItemsWithOptionalFacets(context, metadataItems)
            : metadataItems;
          return {
            content: [{ type: 'text', text: JSON.stringify(responseItems, null, 2) }]
          };
        }

        const result = await context.officialStoreClient.queryItems(
          buildOfficialStoreQueryArgs(
            args,
            getStoreQueryCandidateLimit(args.limit ?? 20)
          )
        );
        const filteredMatches = await filterItemsByCacheableFacets(
          context,
          result.items,
          args.limit,
          normalizedGenres,
          normalizedCategories,
          normalizedTags,
          normalizedGenresExclude,
          normalizedCategoriesExclude,
          normalizedTagsExclude
        );
        const metadataItems = attachStoreQueryMetadata(
          filteredMatches.map(({ item }) => item),
          metadata
        );
        const responseItems = args.includeFacets
          ? attachStoreQueryFacets(
              metadataItems,
              new Map(filteredMatches.map(({ item, details }) => [item.appId, details]))
            )
          : metadataItems;

        return {
          content: [{ type: 'text', text: JSON.stringify(responseItems, null, 2) }]
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
