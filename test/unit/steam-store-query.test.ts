import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  OfficialStoreItemSummary,
  OfficialStoreQueryItemsResult,
  StoreAppDetails
} from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamStoreQueryTool } from '../../packages/steam-mcp/src/tools/steam-store-query.js';

type ToolResult = {
  content?: Array<{
    type: string;
    text?: string;
  }>;
};

type RegisteredToolHandler = (rawArgs: unknown) => ToolResult | Promise<ToolResult>;

function parseFirstTextContent(result: ToolResult): unknown {
  const firstContent = result.content?.[0];
  assert.ok(firstContent);
  assert.equal(firstContent.type, 'text');
  assert.equal(typeof firstContent.text, 'string');
  return JSON.parse(firstContent.text ?? 'null');
}

function createOfficialItem(overrides: Partial<OfficialStoreItemSummary> & Pick<OfficialStoreItemSummary, 'appId' | 'name' | 'storeUrl'>): OfficialStoreItemSummary {
  return {
    appId: overrides.appId,
    name: overrides.name,
    storeUrl: overrides.storeUrl,
    ...overrides
  };
}

function createCacheableDetails(overrides: Partial<StoreAppDetails> & Pick<StoreAppDetails, 'appId' | 'name' | 'storeUrl'>): StoreAppDetails {
  return {
    appId: overrides.appId,
    name: overrides.name,
    developers: overrides.developers ?? [],
    publishers: overrides.publishers ?? [],
    genres: overrides.genres ?? [],
    categories: overrides.categories ?? [],
    tags: overrides.tags ?? [],
    storeUrl: overrides.storeUrl,
    ...overrides
  };
}

function createToolHarness(options: {
  queryItemsResult?: OfficialStoreQueryItemsResult;
  queryItemsError?: Error;
  cacheableDetailsByAppId?: Record<number, StoreAppDetails | undefined>;
  cacheableDetailsErrorByAppId?: Record<number, Error>;
}) {
  const calls = {
    queryItems: [] as Array<unknown>,
    getCacheableAppDetails: [] as number[]
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
    comingSoonOnly: false,
    freeToPlay: true
  });

  assert.deepEqual(harness.calls.queryItems, [{
    limit: 5,
    types: ['game', 'dlc'],
    comingSoonOnly: false,
    freeToPlay: true
  }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, []);
  assert.deepEqual(parseFirstTextContent(result), [
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
  assert.deepEqual(parseFirstTextContent(result), [
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
    genres: [' Puzzle ']
  });

  assert.deepEqual(harness.calls.queryItems, [{
    limit: 6
  }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [1, 2, 3]);
  assert.deepEqual(parseFirstTextContent(result), [
    { appId: 1, name: 'Alpha', storeUrl: 'https://store.steampowered.com/app/1/' },
    { appId: 3, name: 'Gamma', storeUrl: 'https://store.steampowered.com/app/3/' }
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
  assert.deepEqual(parseFirstTextContent(result), [
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
  assert.deepEqual(parseFirstTextContent(result), [
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
  assert.deepEqual(parseFirstTextContent(result), [
    { appId: 31, name: 'Recovered Match', storeUrl: 'https://store.steampowered.com/app/31/' }
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
