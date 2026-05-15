import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  OfficialStoreItemSummary,
  OfficialStoreQueryItemsResult,
  StoreAppDetails
} from '@steam-mcp/steam-core';
import type { WishlistListResult } from '../../packages/steam-core/src/types.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamStoreQueryTool } from '../../packages/steam-mcp/src/tools/steam-store-query.js';

type ToolResult = {
  content?: Array<{
    type: string;
    text?: string;
  }>;
};

type RegisteredToolHandler = (rawArgs: unknown) => ToolResult | Promise<ToolResult>;

type StoreQueryResultMetadata = {
  source: 'query';
  filtersApplied: string[];
  authoritativeFacetFiltering: boolean;
};

type StoreQueryResultFacets = {
  genres: string[];
  categories: string[];
  tags: string[];
};

type StoreQueryResultItem = OfficialStoreItemSummary & {
  metadata?: StoreQueryResultMetadata;
  facets?: StoreQueryResultFacets;
  facetsAvailable?: boolean;
  wishlist?: { listed: true; priority?: number; dateAdded?: number };
};

function parseFirstTextContent(result: ToolResult): unknown {
  const firstContent = result.content?.[0];
  assert.ok(firstContent);
  assert.equal(firstContent.type, 'text');
  assert.equal(typeof firstContent.text, 'string');
  return JSON.parse(firstContent.text ?? 'null');
}

function parseStoreQueryItems(result: ToolResult): StoreQueryResultItem[] {
  const parsed = parseFirstTextContent(result);
  assert.ok(Array.isArray(parsed));
  return parsed as StoreQueryResultItem[];
}

function stripStoreQueryMetadata(items: StoreQueryResultItem[]): OfficialStoreItemSummary[] {
  return items.map(({ metadata: _metadata, facets: _facets, facetsAvailable: _facetsAvailable, ...item }) => item);
}

function createOfficialItem({
  appId,
  name,
  storeUrl,
  ...rest
}: Partial<OfficialStoreItemSummary> & Pick<OfficialStoreItemSummary, 'appId' | 'name' | 'storeUrl'>): OfficialStoreItemSummary {
  return {
    appId,
    name,
    storeUrl,
    ...rest
  };
}

function createCacheableDetails({
  appId,
  name,
  storeUrl,
  developers,
  publishers,
  genres,
  categories,
  tags,
  ...rest
}: Partial<StoreAppDetails> & Pick<StoreAppDetails, 'appId' | 'name' | 'storeUrl'>): StoreAppDetails {
  return {
    appId,
    name,
    developers: developers ?? [],
    publishers: publishers ?? [],
    genres: genres ?? [],
    categories: categories ?? [],
    tags: tags ?? [],
    storeUrl,
    ...rest
  };
}

function createToolHarness(options: {
  queryItemsResult?: OfficialStoreQueryItemsResult;
  queryItemsError?: Error;
  cacheableDetailsByAppId?: Record<number, StoreAppDetails | undefined>;
  cacheableDetailsErrorByAppId?: Record<number, Error>;
  selectedUserId?: string;
  wishlistResult?: WishlistListResult;
  wishlistError?: Error;
}) {
  const calls = {
    queryItems: [] as Array<unknown>,
    getCacheableAppDetails: [] as number[],
    discover: 0,
    wishlistList: [] as Array<unknown>
  };

  const context = {
    officialStoreClient: {
      queryItems: async (request: { limit?: number } & Record<string, unknown>) => {
        calls.queryItems.push(request);
        if (options.queryItemsError) {
          throw options.queryItemsError;
        }

        const items = options.queryItemsResult?.items ?? [];
        return {
          items: typeof request.limit === 'number' ? items.slice(0, request.limit) : items
        };
      }
    },
    storeClient: {
      getCacheableAppDetails: async (appId: number) => {
        calls.getCacheableAppDetails.push(appId);
        const error = options.cacheableDetailsErrorByAppId?.[appId];
        if (error) {
          throw error;
        }

        return options.cacheableDetailsByAppId?.[appId];
      }
    },
    discoveryService: {
      discover: async () => {
        calls.discover += 1;
        return {
          userIds: options.selectedUserId ? [options.selectedUserId] : [],
          selectedUserId: options.selectedUserId,
          warnings: [],
          libraryFolders: []
        };
      }
    },
    wishlistService: {
      list: async (request: unknown) => {
        calls.wishlistList.push(request);
        if (options.wishlistError) {
          throw options.wishlistError;
        }

        return options.wishlistResult ?? { totalCount: 0, items: [] };
      }
    }
  } as unknown as SteamMcpContext;

  let handler: RegisteredToolHandler | undefined;
  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) {
      if (name === 'steam_store_query') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamStoreQueryTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke: (rawArgs: unknown) => handler!(rawArgs)
  };
}

test('steam store query preserves the passthrough path when no facet filters are provided', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({
          appId: 730,
          name: 'Counter-Strike 2',
          type: 'game',
          releaseDate: 'Aug 21, 2012',
          comingSoon: false,
          freeToPlay: true,
          developers: ['Valve'],
          publishers: ['Valve'],
          shortDescription: 'Competitive FPS.',
          headerImage: 'https://cdn.example/cs2.jpg',
          storeUrl: 'https://store.steampowered.com/app/730/'
        }),
        createOfficialItem({
          appId: 2051120,
          name: 'Portal with RTX',
          type: 'dlc',
          releaseDate: 'Dec 8, 2022',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/2051120/'
        })
      ]
    }
  });

  const result = await harness.invoke({
    limit: 5,
    types: ['game', 'dlc'],
    language: 'german',
    countryCode: 'DE',
    comingSoonOnly: false,
    freeToPlay: true
  });

  assert.deepEqual(harness.calls.queryItems, [{
    limit: 5,
    types: ['game', 'dlc'],
    language: 'german',
    countryCode: 'DE',
    comingSoonOnly: false,
    freeToPlay: true
  }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, []);
  const items = parseStoreQueryItems(result);
  assert.deepEqual(items[0]?.metadata, {
    source: 'query',
    filtersApplied: [
      'types:game,dlc',
      'language:german',
      'countryCode:DE',
      'comingSoonOnly:false',
      'freeToPlay:true'
    ],
    authoritativeFacetFiltering: false
  });
  assert.deepEqual(stripStoreQueryMetadata(items), [
    {
      appId: 730,
      name: 'Counter-Strike 2',
      type: 'game',
      releaseDate: 'Aug 21, 2012',
      comingSoon: false,
      freeToPlay: true,
      developers: ['Valve'],
      publishers: ['Valve'],
      shortDescription: 'Competitive FPS.',
      headerImage: 'https://cdn.example/cs2.jpg',
      storeUrl: 'https://store.steampowered.com/app/730/'
    },
    {
      appId: 2051120,
      name: 'Portal with RTX',
      type: 'dlc',
      releaseDate: 'Dec 8, 2022',
      comingSoon: false,
      freeToPlay: false,
      storeUrl: 'https://store.steampowered.com/app/2051120/'
    }
  ]);
});

test('steam store query preserves omitted args so official client defaults apply', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({
          appId: 620,
          name: 'Portal 2',
          type: 'game',
          releaseDate: 'Apr 18, 2011',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/620/'
        })
      ]
    }
  });

  const result = await harness.invoke({});

  assert.deepEqual(harness.calls.queryItems, [{}]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, []);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    {
      appId: 620,
      name: 'Portal 2',
      type: 'game',
      releaseDate: 'Apr 18, 2011',
      comingSoon: false,
      freeToPlay: false,
      storeUrl: 'https://store.steampowered.com/app/620/'
    }
  ]);
});

test('steam store query enriches passthrough results with opt-in facets without dropping lookup misses', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 620, name: 'Portal 2', storeUrl: 'https://store.steampowered.com/app/620/' }),
        createOfficialItem({ appId: 621, name: 'Missed Details', storeUrl: 'https://store.steampowered.com/app/621/' }),
        createOfficialItem({ appId: 622, name: 'Lookup Error', storeUrl: 'https://store.steampowered.com/app/622/' })
      ]
    },
    cacheableDetailsByAppId: {
      620: createCacheableDetails({
        appId: 620,
        name: 'Portal 2',
        genres: ['Puzzle'],
        categories: ['Single-player'],
        tags: ['Story Rich'],
        storeUrl: 'https://store.steampowered.com/app/620/'
      }),
      621: undefined
    },
    cacheableDetailsErrorByAppId: {
      622: new Error('details failed')
    }
  });

  const result = await harness.invoke({
    types: ['game'],
    includeFacets: true
  });

  assert.deepEqual(harness.calls.queryItems, [{
    types: ['game']
  }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [620, 621, 622]);
  const items = parseStoreQueryItems(result);
  assert.deepEqual(items[0]?.metadata, {
    source: 'query',
    filtersApplied: ['types:game'],
    authoritativeFacetFiltering: false
  });
  assert.deepEqual(items[0]?.facets, {
    genres: ['Puzzle'],
    categories: ['Single-player'],
    tags: ['Story Rich']
  });
  assert.equal(items[0]?.facetsAvailable, true);
  assert.equal(items[1]?.facets, undefined);
  assert.equal(items[1]?.facetsAvailable, false);
  assert.equal(items[2]?.facets, undefined);
  assert.equal(items[2]?.facetsAvailable, false);
  assert.deepEqual(stripStoreQueryMetadata(items), [
    { appId: 620, name: 'Portal 2', storeUrl: 'https://store.steampowered.com/app/620/' },
    { appId: 621, name: 'Missed Details', storeUrl: 'https://store.steampowered.com/app/621/' },
    { appId: 622, name: 'Lookup Error', storeUrl: 'https://store.steampowered.com/app/622/' }
  ]);
});

test('steam store query overfetches before authoritative genre filtering', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 1, name: 'Alpha', storeUrl: 'https://store.steampowered.com/app/1/' }),
        createOfficialItem({ appId: 2, name: 'Beta', storeUrl: 'https://store.steampowered.com/app/2/' }),
        createOfficialItem({ appId: 3, name: 'Gamma', storeUrl: 'https://store.steampowered.com/app/3/' }),
        createOfficialItem({ appId: 4, name: 'Delta', storeUrl: 'https://store.steampowered.com/app/4/' }),
        createOfficialItem({ appId: 5, name: 'Epsilon', storeUrl: 'https://store.steampowered.com/app/5/' }),
        createOfficialItem({ appId: 6, name: 'Zeta', storeUrl: 'https://store.steampowered.com/app/6/' })
      ]
    },
    cacheableDetailsByAppId: {
      1: createCacheableDetails({ appId: 1, name: 'Alpha', genres: ['Puzzle'], storeUrl: 'https://store.steampowered.com/app/1/' }),
      2: createCacheableDetails({ appId: 2, name: 'Beta', genres: ['Action'], storeUrl: 'https://store.steampowered.com/app/2/' }),
      3: createCacheableDetails({ appId: 3, name: 'Gamma', genres: ['Puzzle'], storeUrl: 'https://store.steampowered.com/app/3/' }),
      4: createCacheableDetails({ appId: 4, name: 'Delta', genres: ['Strategy'], storeUrl: 'https://store.steampowered.com/app/4/' }),
      5: createCacheableDetails({ appId: 5, name: 'Epsilon', genres: ['Puzzle'], storeUrl: 'https://store.steampowered.com/app/5/' }),
      6: createCacheableDetails({ appId: 6, name: 'Zeta', genres: ['Racing'], storeUrl: 'https://store.steampowered.com/app/6/' })
    }
  });

  const result = await harness.invoke({
    limit: 2,
    language: 'schinese',
    countryCode: 'CN',
    genres: [' Puzzle ']
  });

  assert.deepEqual(harness.calls.queryItems, [{
    limit: 6,
    language: 'schinese',
    countryCode: 'CN'
  }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [1, 2, 3]);
  const items = parseStoreQueryItems(result);
  assert.deepEqual(items[0]?.metadata, {
    source: 'query',
    filtersApplied: [
      'language:schinese',
      'countryCode:CN',
      'genres:puzzle'
    ],
    authoritativeFacetFiltering: true
  });
  assert.deepEqual(stripStoreQueryMetadata(items), [
    { appId: 1, name: 'Alpha', storeUrl: 'https://store.steampowered.com/app/1/' },
    { appId: 3, name: 'Gamma', storeUrl: 'https://store.steampowered.com/app/3/' }
  ]);
});

test('steam store query reuses authoritative detail lookups for opt-in facets', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 1, name: 'Alpha', storeUrl: 'https://store.steampowered.com/app/1/' }),
        createOfficialItem({ appId: 2, name: 'Beta', storeUrl: 'https://store.steampowered.com/app/2/' }),
        createOfficialItem({ appId: 3, name: 'Gamma', storeUrl: 'https://store.steampowered.com/app/3/' })
      ]
    },
    cacheableDetailsByAppId: {
      1: createCacheableDetails({
        appId: 1,
        name: 'Alpha',
        genres: ['Puzzle'],
        categories: ['Single-player'],
        tags: ['Story Rich'],
        storeUrl: 'https://store.steampowered.com/app/1/'
      }),
      2: createCacheableDetails({
        appId: 2,
        name: 'Beta',
        genres: ['Action'],
        categories: ['Co-op'],
        tags: ['Action'],
        storeUrl: 'https://store.steampowered.com/app/2/'
      }),
      3: createCacheableDetails({
        appId: 3,
        name: 'Gamma',
        genres: ['Puzzle'],
        categories: ['Local Co-op'],
        tags: ['Co-op'],
        storeUrl: 'https://store.steampowered.com/app/3/'
      })
    }
  });

  const result = await harness.invoke({
    limit: 2,
    genres: ['puzzle'],
    includeFacets: true
  });

  assert.deepEqual(harness.calls.queryItems, [{
    limit: 6
  }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [1, 2, 3]);
  const items = parseStoreQueryItems(result);
  assert.deepEqual(items.map((item) => item.facets), [
    {
      genres: ['Puzzle'],
      categories: ['Single-player'],
      tags: ['Story Rich']
    },
    {
      genres: ['Puzzle'],
      categories: ['Local Co-op'],
      tags: ['Co-op']
    }
  ]);
  assert.deepEqual(items.map((item) => item.facetsAvailable), [true, true]);
  assert.deepEqual(stripStoreQueryMetadata(items), [
    { appId: 1, name: 'Alpha', storeUrl: 'https://store.steampowered.com/app/1/' },
    { appId: 3, name: 'Gamma', storeUrl: 'https://store.steampowered.com/app/3/' }
  ]);
});


test('steam store query forwards locale passthrough through authoritative facet filtering', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 81, name: 'Locale Match', storeUrl: 'https://store.steampowered.com/app/81/' }),
        createOfficialItem({ appId: 82, name: 'Locale Skip', storeUrl: 'https://store.steampowered.com/app/82/' }),
        createOfficialItem({ appId: 83, name: 'Locale Unused', storeUrl: 'https://store.steampowered.com/app/83/' })
      ]
    },
    cacheableDetailsByAppId: {
      81: createCacheableDetails({ appId: 81, name: 'Locale Match', genres: ['Puzzle'], storeUrl: 'https://store.steampowered.com/app/81/' }),
      82: createCacheableDetails({ appId: 82, name: 'Locale Skip', genres: ['Action'], storeUrl: 'https://store.steampowered.com/app/82/' }),
      83: createCacheableDetails({ appId: 83, name: 'Locale Unused', genres: ['Puzzle'], storeUrl: 'https://store.steampowered.com/app/83/' })
    }
  });

  const result = await harness.invoke({
    limit: 1,
    language: 'japanese',
    countryCode: 'JP',
    genres: ['Puzzle']
  });

  assert.deepEqual(harness.calls.queryItems, [{
    limit: 3,
    language: 'japanese',
    countryCode: 'JP'
  }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [81]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 81, name: 'Locale Match', storeUrl: 'https://store.steampowered.com/app/81/' }
  ]);
});

test('steam store query matches include facet variants after canonicalization', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 90, name: 'Canonical Match', storeUrl: 'https://store.steampowered.com/app/90/' }),
        createOfficialItem({ appId: 92, name: 'Filtered Out', storeUrl: 'https://store.steampowered.com/app/92/' })
      ]
    },
    cacheableDetailsByAppId: {
      90: createCacheableDetails({
        appId: 90,
        name: 'Canonical Match',
        tags: ['Single-player'],
        categories: ['Local Co-op'],
        storeUrl: 'https://store.steampowered.com/app/90/'
      }),
      92: createCacheableDetails({
        appId: 92,
        name: 'Filtered Out',
        tags: ['Roguelike'],
        categories: ['Online Co-op'],
        storeUrl: 'https://store.steampowered.com/app/92/'
      })
    }
  });

  const result = await harness.invoke({
    tags: ['single player'],
    categories: ['local co op']
  });

  assert.deepEqual(harness.calls.queryItems, [{ limit: 60 }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [90, 92]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 90, name: 'Canonical Match', storeUrl: 'https://store.steampowered.com/app/90/' }
  ]);
});

test('steam store query applies OR within families and AND across categories and tags', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 10, name: 'Match A', storeUrl: 'https://store.steampowered.com/app/10/' }),
        createOfficialItem({ appId: 11, name: 'Match B', storeUrl: 'https://store.steampowered.com/app/11/' }),
        createOfficialItem({ appId: 12, name: 'Miss Category', storeUrl: 'https://store.steampowered.com/app/12/' }),
        createOfficialItem({ appId: 13, name: 'Miss Tag', storeUrl: 'https://store.steampowered.com/app/13/' })
      ]
    },
    cacheableDetailsByAppId: {
      10: createCacheableDetails({
        appId: 10,
        name: 'Match A',
        categories: ['Single-player'],
        tags: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/10/'
      }),
      11: createCacheableDetails({
        appId: 11,
        name: 'Match B',
        categories: ['Co-op'],
        tags: ['Story Rich'],
        storeUrl: 'https://store.steampowered.com/app/11/'
      }),
      12: createCacheableDetails({
        appId: 12,
        name: 'Miss Category',
        categories: ['Controller Support'],
        tags: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/12/'
      }),
      13: createCacheableDetails({
        appId: 13,
        name: 'Miss Tag',
        categories: ['Co-op'],
        tags: ['Action'],
        storeUrl: 'https://store.steampowered.com/app/13/'
      })
    }
  });

  const result = await harness.invoke({
    categories: ['co-op', 'single-player'],
    tags: ['story rich', 'puzzle']
  });

  assert.deepEqual(harness.calls.queryItems, [{
    limit: 60
  }]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 10, name: 'Match A', storeUrl: 'https://store.steampowered.com/app/10/' },
    { appId: 11, name: 'Match B', storeUrl: 'https://store.steampowered.com/app/11/' }
  ]);
});

test('steam store query excludes candidates with missing cacheable details when facets are requested', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 20, name: 'Missing Details', storeUrl: 'https://store.steampowered.com/app/20/' }),
        createOfficialItem({ appId: 21, name: 'Present Details', storeUrl: 'https://store.steampowered.com/app/21/' })
      ]
    },
    cacheableDetailsByAppId: {
      20: undefined,
      21: createCacheableDetails({
        appId: 21,
        name: 'Present Details',
        genres: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/21/'
      })
    }
  });

  const result = await harness.invoke({ genres: ['puzzle'] });

  assert.deepEqual(harness.calls.getCacheableAppDetails, [20, 21]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 21, name: 'Present Details', storeUrl: 'https://store.steampowered.com/app/21/' }
  ]);
});

test('steam store query excludes candidates when cacheable details lookup throws during facet filtering', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 30, name: 'Lookup Failure', storeUrl: 'https://store.steampowered.com/app/30/' }),
        createOfficialItem({ appId: 31, name: 'Recovered Match', storeUrl: 'https://store.steampowered.com/app/31/' })
      ]
    },
    cacheableDetailsByAppId: {
      31: createCacheableDetails({
        appId: 31,
        name: 'Recovered Match',
        genres: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/31/'
      })
    },
    cacheableDetailsErrorByAppId: {
      30: new Error('cache miss')
    }
  });

  const result = await harness.invoke({ genres: ['puzzle'] });

  assert.deepEqual(harness.calls.getCacheableAppDetails, [30, 31]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 31, name: 'Recovered Match', storeUrl: 'https://store.steampowered.com/app/31/' }
  ]);
});

test('steam store query excludes candidates whose authoritative tags match tagsExclude', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 40, name: 'Early Access Match', storeUrl: 'https://store.steampowered.com/app/40/' }),
        createOfficialItem({ appId: 41, name: 'Allowed Match', storeUrl: 'https://store.steampowered.com/app/41/' }),
        createOfficialItem({ appId: 42, name: 'Case Folded Match', storeUrl: 'https://store.steampowered.com/app/42/' })
      ]
    },
    cacheableDetailsByAppId: {
      40: createCacheableDetails({
        appId: 40,
        name: 'Early Access Match',
        tags: ['Early Access'],
        storeUrl: 'https://store.steampowered.com/app/40/'
      }),
      41: createCacheableDetails({
        appId: 41,
        name: 'Allowed Match',
        tags: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/41/'
      }),
      42: createCacheableDetails({
        appId: 42,
        name: 'Case Folded Match',
        tags: ['EARLY ACCESS', 'Action'],
        storeUrl: 'https://store.steampowered.com/app/42/'
      })
    }
  });

  const result = await harness.invoke({ tagsExclude: [' Early Access '] });

  assert.deepEqual(harness.calls.queryItems, [{ limit: 60 }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [40, 41, 42]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 41, name: 'Allowed Match', storeUrl: 'https://store.steampowered.com/app/41/' }
  ]);
});

test('steam store query matches exclude facet variants after canonicalization', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 93, name: 'Early Access Match', storeUrl: 'https://store.steampowered.com/app/93/' }),
        createOfficialItem({ appId: 94, name: 'Allowed Result', storeUrl: 'https://store.steampowered.com/app/94/' })
      ]
    },
    cacheableDetailsByAppId: {
      93: createCacheableDetails({
        appId: 93,
        name: 'Early Access Match',
        tags: ['Early Access'],
        storeUrl: 'https://store.steampowered.com/app/93/'
      }),
      94: createCacheableDetails({
        appId: 94,
        name: 'Allowed Result',
        tags: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/94/'
      })
    }
  });

  const result = await harness.invoke({ tagsExclude: ['early-access'] });

  assert.deepEqual(harness.calls.queryItems, [{ limit: 60 }]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 94, name: 'Allowed Result', storeUrl: 'https://store.steampowered.com/app/94/' }
  ]);
});

test('steam store query composes include and exclude facet filters', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 50, name: 'Allowed Co-op', storeUrl: 'https://store.steampowered.com/app/50/' }),
        createOfficialItem({ appId: 51, name: 'Excluded Co-op', storeUrl: 'https://store.steampowered.com/app/51/' }),
        createOfficialItem({ appId: 52, name: 'Wrong Category', storeUrl: 'https://store.steampowered.com/app/52/' })
      ]
    },
    cacheableDetailsByAppId: {
      50: createCacheableDetails({
        appId: 50,
        name: 'Allowed Co-op',
        categories: ['Co-op'],
        tags: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/50/'
      }),
      51: createCacheableDetails({
        appId: 51,
        name: 'Excluded Co-op',
        categories: ['Co-op'],
        tags: ['Early Access'],
        storeUrl: 'https://store.steampowered.com/app/51/'
      }),
      52: createCacheableDetails({
        appId: 52,
        name: 'Wrong Category',
        categories: ['Single-player'],
        tags: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/52/'
      })
    }
  });

  const result = await harness.invoke({
    categories: ['Co-op'],
    tagsExclude: ['Early Access']
  });

  assert.deepEqual(harness.calls.queryItems, [{ limit: 60 }]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 50, name: 'Allowed Co-op', storeUrl: 'https://store.steampowered.com/app/50/' }
  ]);
});

test('steam store query preserves OR semantics within a facet family after canonicalization', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 95, name: 'Single-player Match', storeUrl: 'https://store.steampowered.com/app/95/' }),
        createOfficialItem({ appId: 96, name: 'Local Co-op Match', storeUrl: 'https://store.steampowered.com/app/96/' }),
        createOfficialItem({ appId: 97, name: 'No Match', storeUrl: 'https://store.steampowered.com/app/97/' })
      ]
    },
    cacheableDetailsByAppId: {
      95: createCacheableDetails({
        appId: 95,
        name: 'Single-player Match',
        categories: ['Single-player'],
        storeUrl: 'https://store.steampowered.com/app/95/'
      }),
      96: createCacheableDetails({
        appId: 96,
        name: 'Local Co-op Match',
        categories: ['Local Co-op'],
        storeUrl: 'https://store.steampowered.com/app/96/'
      }),
      97: createCacheableDetails({
        appId: 97,
        name: 'No Match',
        categories: ['Controller Support'],
        storeUrl: 'https://store.steampowered.com/app/97/'
      })
    }
  });

  const result = await harness.invoke({ categories: ['single player', 'local co op'] });

  assert.deepEqual(harness.calls.queryItems, [{ limit: 60 }]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 95, name: 'Single-player Match', storeUrl: 'https://store.steampowered.com/app/95/' },
    { appId: 96, name: 'Local Co-op Match', storeUrl: 'https://store.steampowered.com/app/96/' }
  ]);
});

test('steam store query preserves the passthrough path when exclude arrays normalize to empty', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({
          appId: 60,
          name: 'Portal 2',
          type: 'game',
          releaseDate: 'Apr 18, 2011',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/60/'
        })
      ]
    }
  });

  const result = await harness.invoke({
    genresExclude: ['   '],
    categoriesExclude: ['\t'],
    tagsExclude: ['  ']
  });

  assert.deepEqual(harness.calls.queryItems, [{}]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, []);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    {
      appId: 60,
      name: 'Portal 2',
      type: 'game',
      releaseDate: 'Apr 18, 2011',
      comingSoon: false,
      freeToPlay: false,
      storeUrl: 'https://store.steampowered.com/app/60/'
    }
  ]);
});

test('steam store query overfetches when exclude filters are active', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 70, name: 'Excluded First', storeUrl: 'https://store.steampowered.com/app/70/' }),
        createOfficialItem({ appId: 71, name: 'Allowed First', storeUrl: 'https://store.steampowered.com/app/71/' }),
        createOfficialItem({ appId: 72, name: 'Allowed Second', storeUrl: 'https://store.steampowered.com/app/72/' }),
        createOfficialItem({ appId: 73, name: 'Unused Third', storeUrl: 'https://store.steampowered.com/app/73/' }),
        createOfficialItem({ appId: 74, name: 'Unused Fourth', storeUrl: 'https://store.steampowered.com/app/74/' }),
        createOfficialItem({ appId: 75, name: 'Unused Fifth', storeUrl: 'https://store.steampowered.com/app/75/' })
      ]
    },
    cacheableDetailsByAppId: {
      70: createCacheableDetails({
        appId: 70,
        name: 'Excluded First',
        tags: ['Early Access'],
        storeUrl: 'https://store.steampowered.com/app/70/'
      }),
      71: createCacheableDetails({
        appId: 71,
        name: 'Allowed First',
        tags: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/71/'
      }),
      72: createCacheableDetails({
        appId: 72,
        name: 'Allowed Second',
        tags: ['Adventure'],
        storeUrl: 'https://store.steampowered.com/app/72/'
      }),
      73: createCacheableDetails({
        appId: 73,
        name: 'Unused Third',
        tags: ['Action'],
        storeUrl: 'https://store.steampowered.com/app/73/'
      }),
      74: createCacheableDetails({
        appId: 74,
        name: 'Unused Fourth',
        tags: ['Action'],
        storeUrl: 'https://store.steampowered.com/app/74/'
      }),
      75: createCacheableDetails({
        appId: 75,
        name: 'Unused Fifth',
        tags: ['Action'],
        storeUrl: 'https://store.steampowered.com/app/75/'
      })
    }
  });

  const result = await harness.invoke({
    limit: 2,
    tagsExclude: ['Early Access']
  });

  assert.deepEqual(harness.calls.queryItems, [{ limit: 6 }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [70, 71, 72]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 71, name: 'Allowed First', storeUrl: 'https://store.steampowered.com/app/71/' },
    { appId: 72, name: 'Allowed Second', storeUrl: 'https://store.steampowered.com/app/72/' }
  ]);
});

test('steam store query still skips missing and failing detail lookups when exclude filters are active', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 80, name: 'Missing Details', storeUrl: 'https://store.steampowered.com/app/80/' }),
        createOfficialItem({ appId: 81, name: 'Lookup Failure', storeUrl: 'https://store.steampowered.com/app/81/' }),
        createOfficialItem({ appId: 82, name: 'Allowed Match', storeUrl: 'https://store.steampowered.com/app/82/' })
      ]
    },
    cacheableDetailsByAppId: {
      80: undefined,
      82: createCacheableDetails({
        appId: 82,
        name: 'Allowed Match',
        tags: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/82/'
      })
    },
    cacheableDetailsErrorByAppId: {
      81: new Error('cache miss')
    }
  });

  const result = await harness.invoke({ tagsExclude: ['Early Access'] });

  assert.deepEqual(harness.calls.queryItems, [{ limit: 60 }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [80, 81, 82]);
  assert.deepEqual(stripStoreQueryMetadata(parseStoreQueryItems(result)), [
    { appId: 82, name: 'Allowed Match', storeUrl: 'https://store.steampowered.com/app/82/' }
  ]);
});

test('steam store query surfaces official query failures as an explicit error payload', async () => {
  const harness = createToolHarness({
    queryItemsError: new Error('Steam Web API key is required for official store query access. Set STEAM_API_KEY.')
  });

  const result = await harness.invoke({ comingSoonOnly: true, genres: ['puzzle'] });

  assert.deepEqual(harness.calls.queryItems, [{
    limit: 60,
    comingSoonOnly: true
  }]);
  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official store query access. Set STEAM_API_KEY.'
  });
});

test('steam store query annotates only matching wishlist items when requested', async () => {
  const harness = createToolHarness({
    selectedUserId: '12345',
    queryItemsResult: {
      items: [
        createOfficialItem({ appId: 620, name: 'Portal 2', type: 'game', storeUrl: 'https://store.steampowered.com/app/620/' }),
        createOfficialItem({ appId: 730, name: 'Counter-Strike 2', type: 'game', storeUrl: 'https://store.steampowered.com/app/730/' })
      ]
    },
    wishlistResult: {
      totalCount: 1,
      items: [{ appId: 620, priority: 2, dateAdded: 1710000000 }]
    }
  });

  const result = await harness.invoke({ includeWishlist: true });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 620,
      name: 'Portal 2',
      type: 'game',
      storeUrl: 'https://store.steampowered.com/app/620/',
      metadata: { source: 'query', filtersApplied: [], authoritativeFacetFiltering: false },
      wishlist: { listed: true, priority: 2, dateAdded: 1710000000 }
    },
    {
      appId: 730,
      name: 'Counter-Strike 2',
      type: 'game',
      storeUrl: 'https://store.steampowered.com/app/730/',
      metadata: { source: 'query', filtersApplied: [], authoritativeFacetFiltering: false }
    }
  ]);
  assert.equal(harness.calls.discover, 1);
  assert.deepEqual(harness.calls.wishlistList, [{ steamId: '76561197960278073' }]);
});

test('steam store query does not resolve wishlist when includeWishlist is omitted', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [createOfficialItem({ appId: 620, name: 'Portal 2', type: 'game', storeUrl: 'https://store.steampowered.com/app/620/' })]
    }
  });

  await harness.invoke({});

  assert.equal(harness.calls.discover, 0);
  assert.deepEqual(harness.calls.wishlistList, []);
});

test('steam store query returns explicit wishlist errors when annotation lookup fails', async () => {
  const harness = createToolHarness({
    selectedUserId: '76561198000000000',
    wishlistError: new Error('Official wishlist request failed with status 503.')
  });

  const result = await harness.invoke({ includeWishlist: true });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Official wishlist request failed with status 503.'
  });
  assert.deepEqual(harness.calls.queryItems, []);
});
