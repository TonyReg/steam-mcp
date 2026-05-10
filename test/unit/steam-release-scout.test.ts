import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  OfficialStoreTopReleasesPagesResult,
  OfficialStoreItemsResult,
  OfficialStoreQueryItemsResult
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
}) {
  const calls = {
    getTopReleasesPages: 0,
    getItems: [] as Array<unknown>,
    queryItems: [] as Array<unknown>,
    getAppList: 0,
    getAppDetails: [] as number[]
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

        return options.queryItemsResult ?? { items: [] };
      },
      getAppList: async () => {
        calls.getAppList += 1;
        throw new Error('getAppList should not be called');
      }
    },
    storeClient: {
      getAppDetails: async (appId: number) => {
        calls.getAppDetails.push(appId);
        throw new Error(`getAppDetails should not be called for ${String(appId)}`);
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
  assert.deepEqual(harness.calls.queryItems, [{ limit: 1, types: ['game', 'dlc'], comingSoonOnly: true }]);
  assert.equal(harness.calls.getAppList, 0);
  assert.deepEqual(harness.calls.getAppDetails, []);
});

test('steam release scout applies freeToPlay on the query-backed upcoming path and reports provenance', async () => {
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
          name: 'Paid Future Game',
          type: 'game',
          releaseDate: 'Coming soon',
          comingSoon: true,
          freeToPlay: false,
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
    }
  ]);
  assert.deepEqual(harness.calls.queryItems, [{ limit: 5, types: ['game'], comingSoonOnly: true, freeToPlay: true }]);
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
  assert.deepEqual(harness.calls.getAppDetails, []);
  assert.equal(harness.calls.getAppList, 0);
  assert.equal(harness.calls.getTopReleasesPages, 0);
  assert.deepEqual(harness.calls.getItems, []);
  assert.deepEqual(harness.calls.queryItems, [{ limit: 5, types: ['game', 'software', 'dlc'], comingSoonOnly: true }]);
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