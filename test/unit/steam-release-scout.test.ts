import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  OfficialStoreTopReleasesPagesResult,
  OfficialStoreItemsResult,
  OfficialStoreQueryItemsResult,
  StoreAppDetails
} from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamReleaseScoutTool } from '../../packages/steam-mcp/src/tools/steam-release-scout.js';

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
  return JSON.parse(firstContent.text);
}

function createContext(options: {
  topReleasesResult?: OfficialStoreTopReleasesPagesResult;
  itemsResult?: OfficialStoreItemsResult;
  queryItemsResult?: OfficialStoreQueryItemsResult;
  topReleasesError?: Error;
  itemsError?: Error;
  queryItemsError?: Error;
  appDetailsMap?: Map<number, StoreAppDetails | undefined>;
}) {
  const calls = {
    getTopReleasesPages: 0,
    getItems: [] as Array<unknown>,
    queryItems: [] as Array<unknown>,
    getAppList: 0,
    getAppDetails: [] as number[],
    getCacheableAppDetails: [] as number[]
  };

  const context = {
    officialStoreClient: {
      getTopReleasesPages: async () => {
        calls.getTopReleasesPages += 1;
        if (options.topReleasesError) {
          throw options.topReleasesError;
        }

        return options.topReleasesResult ?? { pages: [] };
      },
      getItems: async (request: unknown) => {
        calls.getItems.push(request);
        if (options.itemsError) {
          throw options.itemsError;
        }

        return options.itemsResult ?? { items: [] };
      },
      queryItems: async (request: unknown) => {
        calls.queryItems.push(request);
        if (options.queryItemsError) {
          throw options.queryItemsError;
        }

        const result = options.queryItemsResult ?? { items: [] };
        const limit = typeof request === 'object' && request !== null
          ? Reflect.get(request, 'limit')
          : undefined;

        if (typeof limit !== 'number') {
          return result;
        }

        return {
          items: result.items.slice(0, limit)
        };
      },
      getAppList: async () => {
        calls.getAppList += 1;
        throw new Error('getAppList should not be called');
      }
    },
    storeClient: {
      getAppDetails: async (appId: number) => {
        calls.getAppDetails.push(appId);
        if (options.appDetailsMap) {
          if (options.appDetailsMap.has(appId)) {
            return options.appDetailsMap.get(appId);
          }
          throw new Error(`getAppDetails: no mock configured for appId ${String(appId)}`);
        }
        throw new Error(`getAppDetails should not be called for ${String(appId)}`);
      },
      getCacheableAppDetails: async (appId: number) => {
        calls.getCacheableAppDetails.push(appId);
        if (options.appDetailsMap) {
          if (options.appDetailsMap.has(appId)) {
            return options.appDetailsMap.get(appId);
          }
          throw new Error(`getCacheableAppDetails: no mock configured for appId ${String(appId)}`);
        }
        throw new Error(`getCacheableAppDetails should not be called for ${String(appId)}`);
      }
    }
  } as unknown as SteamMcpContext;

  let handler: RegisteredToolHandler | undefined;
  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) {
      if (name === 'steam_release_scout') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamReleaseScoutTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke: (rawArgs: unknown) => handler(rawArgs)
  };
}

test('steam release scout returns upcoming releases from the query-backed official path', async () => {
  const harness = createContext({
    queryItemsResult: {
      items: [
        {
          appId: 10,
          name: 'Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: true,
          storeUrl: 'https://store.steampowered.com/app/10/'
        },
        {
          appId: 11,
          name: 'Future DLC',
          type: 'dlc',
          releaseDate: 'Q4 2026',
          comingSoon: true,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/11/'
        },
        {
          appId: 12,
          name: 'Released Game',
          type: 'game',
          releaseDate: 'Jan 1, 2024',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/12/'
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 1, types: ['game', 'dlc'] });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 10,
      name: 'Future Game',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: true,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game,dlc', 'comingSoonOnly:true'],
      storeUrl: 'https://store.steampowered.com/app/10/'
    }
  ]);
  assert.equal(harness.calls.getTopReleasesPages, 0);
  assert.deepEqual(harness.calls.getItems, []);
  assert.deepEqual(harness.calls.queryItems, [{ limit: 3, types: ['game', 'dlc'], comingSoonOnly: true }]);
  assert.equal(harness.calls.getAppList, 0);
  assert.deepEqual(harness.calls.getCacheableAppDetails, []);
});

test('steam release scout forwards freeToPlay on the query-backed upcoming path and preserves upstream-filtered results', async () => {
  const harness = createContext({
    queryItemsResult: {
      items: [
        {
          appId: 50,
          name: 'Free Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: true,
          storeUrl: 'https://store.steampowered.com/app/50/'
        },
        {
          appId: 51,
          name: 'Future Game With Unknown Pricing',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          storeUrl: 'https://store.steampowered.com/app/51/'
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 5, types: ['game'], freeToPlay: true });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 50,
      name: 'Free Future Game',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: true,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true', 'freeToPlay:true'],
      storeUrl: 'https://store.steampowered.com/app/50/'
    },
    {
      appId: 51,
      name: 'Future Game With Unknown Pricing',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true', 'freeToPlay:true'],
      storeUrl: 'https://store.steampowered.com/app/51/'
    }
  ]);
  assert.deepEqual(harness.calls.queryItems, [{ limit: 15, types: ['game'], comingSoonOnly: true, freeToPlay: true }]);
});

test('steam release scout keeps upstream-filtered upcoming paid results when pricing metadata is undefined', async () => {
  const harness = createContext({
    queryItemsResult: {
      items: [
        {
          appId: 52,
          name: 'Paid Future Game With Unknown Pricing',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          storeUrl: 'https://store.steampowered.com/app/52/'
        },
        {
          appId: 53,
          name: 'Explicitly Paid Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/53/'
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 5, types: ['game'], freeToPlay: false });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 52,
      name: 'Paid Future Game With Unknown Pricing',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true', 'freeToPlay:false'],
      storeUrl: 'https://store.steampowered.com/app/52/'
    },
    {
      appId: 53,
      name: 'Explicitly Paid Future Game',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: false,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true', 'freeToPlay:false'],
      storeUrl: 'https://store.steampowered.com/app/53/'
    }
  ]);
  assert.deepEqual(harness.calls.queryItems, [{ limit: 15, types: ['game'], comingSoonOnly: true, freeToPlay: false }]);
});

test('steam release scout overfetches upcoming query candidates before final trimming', async () => {
  const harness = createContext({
    queryItemsResult: {
      items: [
        {
          appId: 70,
          name: 'Released Noise',
          type: 'game',
          releaseDate: 'Jan 1, 2024',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/70/'
        },
        {
          appId: 71,
          name: 'First Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/71/'
        },
        {
          appId: 72,
          name: 'Second Future Game',
          type: 'game',
          releaseDate: 'Q4 2026',
          comingSoon: true,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/72/'
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 2, types: ['game'] });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 71,
      name: 'First Future Game',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: false,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true'],
      storeUrl: 'https://store.steampowered.com/app/71/'
    },
    {
      appId: 72,
      name: 'Second Future Game',
      type: 'game',
      releaseDate: 'Q4 2026',
      comingSoon: true,
      freeToPlay: false,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true'],
      storeUrl: 'https://store.steampowered.com/app/72/'
    }
  ]);
  assert.deepEqual(harness.calls.queryItems, [{ limit: 6, types: ['game'], comingSoonOnly: true }]);
});

test('steam release scout can still fill the requested upcoming limit after authoritative facet filtering removes early candidates', async () => {
  const appDetailsMap = new Map<number, StoreAppDetails | undefined>([
    [80, { appId: 80, name: 'Future Shooter', type: 'game', genres: ['Action'], categories: ['Single-player'], tags: ['Shooter'], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/80/' }],
    [81, { appId: 81, name: 'Future Puzzle', type: 'game', genres: ['Puzzle'], categories: ['Single-player'], tags: ['Puzzle'], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/81/' }],
    [82, { appId: 82, name: 'Future RPG One', type: 'game', genres: ['RPG'], categories: ['Single-player'], tags: ['RPG'], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/82/' }],
    [83, { appId: 83, name: 'Future RPG Two', type: 'game', genres: ['RPG'], categories: ['Co-op'], tags: ['RPG'], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/83/' }]
  ]);

  const harness = createContext({
    queryItemsResult: {
      items: [
        { appId: 80, name: 'Future Shooter', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/80/' },
        { appId: 81, name: 'Future Puzzle', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/81/' },
        { appId: 82, name: 'Future RPG One', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/82/' },
        { appId: 83, name: 'Future RPG Two', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/83/' }
      ]
    },
    appDetailsMap
  });

  const result = await harness.invoke({ limit: 2, types: ['game'], tags: ['RPG'] });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 82,
      name: 'Future RPG One',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: false,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true', 'tags:rpg'],
      storeUrl: 'https://store.steampowered.com/app/82/'
    },
    {
      appId: 83,
      name: 'Future RPG Two',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: false,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true', 'tags:rpg'],
      storeUrl: 'https://store.steampowered.com/app/83/'
    }
  ]);
  assert.deepEqual(harness.calls.queryItems, [{ limit: 6, types: ['game'], comingSoonOnly: true }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [80, 81, 82, 83]);
});

test('steam release scout preserves query ordering while using the larger upcoming candidate window', async () => {
  const harness = createContext({
    queryItemsResult: {
      items: [
        {
          appId: 90,
          name: 'Future Tool',
          type: 'software',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/90/'
        },
        {
          appId: 91,
          name: 'First Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/91/'
        },
        {
          appId: 92,
          name: 'Second Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/92/'
        },
        {
          appId: 93,
          name: 'Third Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/93/'
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 2, types: ['game'] });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 91,
      name: 'First Future Game',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: false,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true'],
      storeUrl: 'https://store.steampowered.com/app/91/'
    },
    {
      appId: 92,
      name: 'Second Future Game',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: false,
      source: 'query',
      ordering: 'query',
      filtersApplied: ['types:game', 'comingSoonOnly:true'],
      storeUrl: 'https://store.steampowered.com/app/92/'
    }
  ]);
  assert.deepEqual(harness.calls.queryItems, [{ limit: 6, types: ['game'], comingSoonOnly: true }]);
});

test('steam release scout can include released apps when comingSoonOnly is false', async () => {
  const harness = createContext({
    topReleasesResult: {
      pages: [
        {
          pageId: 1,
          pageName: 'Featured',
          appIds: [20]
        }
      ]
    },
    itemsResult: {
      items: [
        {
          appId: 20,
          name: 'Shipping Tool',
          type: 'software',
          releaseDate: 'May 1, 2026',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/20/'
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 5, types: ['software'], comingSoonOnly: false });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 20,
      name: 'Shipping Tool',
      type: 'software',
      releaseDate: 'May 1, 2026',
      comingSoon: false,
      freeToPlay: false,
      source: 'charts',
      ordering: 'charts',
      filtersApplied: ['types:software', 'comingSoonOnly:false'],
      storeUrl: 'https://store.steampowered.com/app/20/'
    }
  ]);
  assert.equal(harness.calls.getTopReleasesPages, 1);
  assert.deepEqual(harness.calls.getItems, [{ appIds: [20] }]);
  assert.deepEqual(harness.calls.queryItems, []);
});

test('steam release scout applies freeToPlay on the released charts path and reports provenance', async () => {
  const harness = createContext({
    topReleasesResult: {
      pages: [
        {
          pageId: 1,
          pageName: 'Featured',
          appIds: [60, 61]
        }
      ]
    },
    itemsResult: {
      items: [
        {
          appId: 60,
          name: 'Free Released Game',
          type: 'game',
          releaseDate: '2025-02-01T00:00:00.000Z',
          comingSoon: false,
          freeToPlay: true,
          storeUrl: 'https://store.steampowered.com/app/60/'
        },
        {
          appId: 61,
          name: 'Paid Released Game',
          type: 'game',
          releaseDate: '2025-02-02T00:00:00.000Z',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/61/'
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 5, types: ['game'], comingSoonOnly: false, freeToPlay: true });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 60,
      name: 'Free Released Game',
      type: 'game',
      releaseDate: '2025-02-01T00:00:00.000Z',
      comingSoon: false,
      freeToPlay: true,
      source: 'charts',
      ordering: 'charts',
      filtersApplied: ['types:game', 'comingSoonOnly:false', 'freeToPlay:true'],
      storeUrl: 'https://store.steampowered.com/app/60/'
    }
  ]);
  assert.equal(harness.calls.getTopReleasesPages, 1);
  assert.deepEqual(harness.calls.getItems, [{ appIds: [60, 61] }]);
  assert.deepEqual(harness.calls.queryItems, []);
});

test('steam release scout preserves chart ordering while enrichment decorates and filters', async () => {
  const harness = createContext({
    topReleasesResult: {
      pages: [
        {
          pageId: 1,
          pageName: 'Featured',
          appIds: [30, 31, 32]
        }
      ]
    },
    itemsResult: {
      items: [
        {
          appId: 32,
          name: 'Third Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: true,
          storeUrl: 'https://store.steampowered.com/app/32/'
        },
        {
          appId: 30,
          name: 'First Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/30/'
        },
        {
          appId: 31,
          name: 'Second Released Game',
          type: 'game',
          releaseDate: 'Jan 1, 2024',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/31/'
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 2, types: ['game'], comingSoonOnly: false });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 30,
      name: 'First Future Game',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: false,
      source: 'charts',
      ordering: 'charts',
      filtersApplied: ['types:game', 'comingSoonOnly:false'],
      storeUrl: 'https://store.steampowered.com/app/30/'
    },
    {
      appId: 31,
      name: 'Second Released Game',
      type: 'game',
      releaseDate: 'Jan 1, 2024',
      comingSoon: false,
      freeToPlay: false,
      source: 'charts',
      ordering: 'charts',
      filtersApplied: ['types:game', 'comingSoonOnly:false'],
      storeUrl: 'https://store.steampowered.com/app/31/'
    }
  ]);
  assert.deepEqual(harness.calls.getItems, [{ appIds: [30, 31, 32] }]);
  assert.deepEqual(harness.calls.queryItems, []);
});

test('steam release scout skips apps missing official batch enrichment on the released path', async () => {
  const harness = createContext({
    topReleasesResult: {
      pages: [
        {
          pageId: 1,
          pageName: 'Featured',
          appIds: [40, 41]
        }
      ]
    },
    itemsResult: {
      items: [
        {
          appId: 41,
          name: 'Present Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: true,
          storeUrl: 'https://store.steampowered.com/app/41/'
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 2, types: ['game'], comingSoonOnly: false });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 41,
      name: 'Present Game',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      freeToPlay: true,
      source: 'charts',
      ordering: 'charts',
      filtersApplied: ['types:game', 'comingSoonOnly:false'],
      storeUrl: 'https://store.steampowered.com/app/41/'
    }
  ]);
  assert.deepEqual(harness.calls.queryItems, []);
});

test('steam release scout reports explicit missing-key failures for the default upcoming path', async () => {
  const harness = createContext({
    queryItemsError: new Error('Steam Web API key is required for official store query access. Set STEAM_API_KEY.')
  });

  const result = await harness.invoke({ limit: 5 });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official store query access. Set STEAM_API_KEY.'
  });
  assert.deepEqual(harness.calls.getCacheableAppDetails, []);
  assert.equal(harness.calls.getAppList, 0);
  assert.equal(harness.calls.getTopReleasesPages, 0);
  assert.deepEqual(harness.calls.getItems, []);
  assert.deepEqual(harness.calls.queryItems, [{ limit: 15, types: ['game', 'software', 'dlc'], comingSoonOnly: true }]);
});

test('steam release scout reports explicit missing-key failures for the released path too', async () => {
  const harness = createContext({
    topReleasesError: new Error('Steam Web API key is required for official top releases access. Set STEAM_API_KEY.')
  });

  const result = await harness.invoke({ limit: 5, comingSoonOnly: false });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official top releases access. Set STEAM_API_KEY.'
  });
  assert.equal(harness.calls.getTopReleasesPages, 1);
  assert.deepEqual(harness.calls.getItems, []);
  assert.deepEqual(harness.calls.queryItems, []);
});

// Phase 1c: authoritative human-readable facet filtering tests

test('steam release scout filters upcoming path by human-readable tags via getCacheableAppDetails', async () => {
  const appDetailsMap = new Map<number, StoreAppDetails | undefined>([
    [10, { appId: 10, name: 'Future RPG', type: 'game', genres: ['RPG'], categories: ['Single-player'], tags: ['RPG', 'Fantasy'], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/10/' }],
    [11, { appId: 11, name: 'Future FPS', type: 'game', genres: ['Action'], categories: ['Single-player'], tags: ['FPS', 'Shooter'], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/11/' }]
  ]);

  const harness = createContext({
    queryItemsResult: {
      items: [
        { appId: 10, name: 'Future RPG', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/10/' },
        { appId: 11, name: 'Future FPS', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/11/' }
      ]
    },
    appDetailsMap
  });

  const result = await harness.invoke({ types: ['game'], tags: ['RPG'] });

  const parsed = parseFirstTextContent(result) as Array<{ appId: number; filtersApplied: string[] }>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].appId, 10);
  assert.ok(parsed[0].filtersApplied.includes('tags:rpg'));
  // Both apps fetched for authoritative filtering; only RPG passes
  assert.deepEqual(harness.calls.getCacheableAppDetails, [10, 11]);
});

test('steam release scout applies AND across genre and category facets via getCacheableAppDetails', async () => {
  const appDetailsMap = new Map<number, StoreAppDetails | undefined>([
    [10, { appId: 10, name: 'RPG with MP', type: 'game', genres: ['RPG'], categories: ['Multi-player'], tags: [], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/10/' }],
    [11, { appId: 11, name: 'RPG SP only', type: 'game', genres: ['RPG'], categories: ['Single-player'], tags: [], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/11/' }]
  ]);

  const harness = createContext({
    queryItemsResult: {
      items: [
        { appId: 10, name: 'RPG with MP', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/10/' },
        { appId: 11, name: 'RPG SP only', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/11/' }
      ]
    },
    appDetailsMap
  });

  // genres: ['RPG'] AND categories: ['Multi-player'] → only appId 10 satisfies both
  const result = await harness.invoke({ types: ['game'], genres: ['RPG'], categories: ['Multi-player'] });

  const parsed = parseFirstTextContent(result) as Array<{ appId: number; filtersApplied: string[] }>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].appId, 10);
  assert.ok(parsed[0].filtersApplied.includes('genres:rpg'));
  assert.ok(parsed[0].filtersApplied.includes('categories:multi-player'));
  assert.deepEqual(harness.calls.getCacheableAppDetails, [10, 11]);
});

test('steam release scout filters released charts path by human-readable genres via getCacheableAppDetails', async () => {
  const appDetailsMap = new Map<number, StoreAppDetails | undefined>([
    [20, { appId: 20, name: 'Action Game', type: 'game', genres: ['Action'], categories: ['Single-player'], tags: ['Action', 'Shooter'], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/20/' }],
    [21, { appId: 21, name: 'Puzzle Game', type: 'game', genres: ['Puzzle'], categories: ['Single-player'], tags: ['Puzzle', 'Relaxing'], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/21/' }]
  ]);

  const harness = createContext({
    topReleasesResult: { pages: [{ pageId: 1, pageName: 'Featured', appIds: [20, 21] }] },
    itemsResult: {
      items: [
        { appId: 20, name: 'Action Game', type: 'game', releaseDate: 'May 1, 2026', comingSoon: false, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/20/' },
        { appId: 21, name: 'Puzzle Game', type: 'game', releaseDate: 'May 2, 2026', comingSoon: false, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/21/' }
      ]
    },
    appDetailsMap
  });

  const result = await harness.invoke({ types: ['game'], comingSoonOnly: false, genres: ['Action'] });

  const parsed = parseFirstTextContent(result) as Array<{ appId: number }>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].appId, 20);
  // Chart ordering preserved: both fetched, only Action passes
  assert.deepEqual(harness.calls.getCacheableAppDetails, [20, 21]);
  assert.equal(harness.calls.getTopReleasesPages, 1);
  assert.deepEqual(harness.calls.getItems, [{ appIds: [20, 21] }]);
});

test('steam release scout excludes app when getCacheableAppDetails returns undefined and facet filters are requested', async () => {
  const appDetailsMap = new Map<number, StoreAppDetails | undefined>([
    [10, undefined], // missing details → must be excluded
    [11, { appId: 11, name: 'Future RPG', type: 'game', genres: ['RPG'], categories: ['Single-player'], tags: ['RPG'], developers: [], publishers: [], storeUrl: 'https://store.steampowered.com/app/11/' }]
  ]);

  const harness = createContext({
    queryItemsResult: {
      items: [
        { appId: 10, name: 'Future Game', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/10/' },
        { appId: 11, name: 'Future RPG', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/11/' }
      ]
    },
    appDetailsMap
  });

  const result = await harness.invoke({ types: ['game'], genres: ['RPG'] });

  const parsed = parseFirstTextContent(result) as Array<{ appId: number }>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].appId, 11);
  // Both apps attempted; appId 10 excluded due to missing details
  assert.deepEqual(harness.calls.getCacheableAppDetails, [10, 11]);
});

test('steam release scout does not call getCacheableAppDetails when no facet filters are supplied', async () => {
  const harness = createContext({
    queryItemsResult: {
      items: [
        { appId: 10, name: 'Future Game', type: 'game', releaseDate: 'Coming soon', comingSoon: true, freeToPlay: false, storeUrl: 'https://store.steampowered.com/app/10/' }
      ]
    }
    // No appDetailsMap provided — getCacheableAppDetails would throw if called
  });

  const result = await harness.invoke({ types: ['game'] });

  const parsed = parseFirstTextContent(result) as Array<{ appId: number }>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].appId, 10);
  // Verify getCacheableAppDetails was never invoked
  assert.deepEqual(harness.calls.getCacheableAppDetails, []);
});

