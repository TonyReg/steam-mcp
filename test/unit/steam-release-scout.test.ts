import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OfficialStoreAppListResult, StoreAppDetails } from '@steam-mcp/steam-core';
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
  appListResult?: OfficialStoreAppListResult;
  appListResults?: OfficialStoreAppListResult[];
  detailsByAppId?: Record<number, StoreAppDetails | undefined>;
  listError?: Error;
}) {
  const calls = {
    getAppList: [] as Array<unknown>,
    getAppDetails: [] as number[]
  };
  let appListCallIndex = 0;

  const context = {
    officialStoreClient: {
      getAppList: async (request: unknown) => {
        calls.getAppList.push(request);
        if (options.listError) {
          throw options.listError;
        }

        const nextResult = options.appListResults?.[appListCallIndex];
        appListCallIndex += 1;
        return nextResult ?? options.appListResult ?? { apps: [], haveMoreResults: false, lastAppId: undefined };
      }
    },
    storeClient: {
      getAppDetails: async (appId: number) => {
        calls.getAppDetails.push(appId);
        return options.detailsByAppId?.[appId];
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

test('steam release scout returns upcoming releases filtered by type and limit', async () => {
  const harness = createContext({
    appListResult: {
      apps: [
        { appId: 10, name: 'Future Game', lastModified: 1, priceChangeNumber: 2 },
        { appId: 11, name: 'Future DLC', lastModified: 3, priceChangeNumber: 4 },
        { appId: 12, name: 'Released Game', lastModified: 5, priceChangeNumber: 6 }
      ],
      haveMoreResults: false,
      lastAppId: 12
    },
    detailsByAppId: {
      10: {
        appId: 10,
        name: 'Future Game',
        type: 'game',
        releaseDate: 'Coming soon',
        comingSoon: true,
        developers: [],
        publishers: [],
        genres: [],
        categories: [],
        tags: [],
        storeUrl: 'https://store.steampowered.com/app/10/'
      },
      11: {
        appId: 11,
        name: 'Future DLC',
        type: 'dlc',
        releaseDate: 'Q4 2026',
        comingSoon: true,
        developers: [],
        publishers: [],
        genres: [],
        categories: [],
        tags: [],
        storeUrl: 'https://store.steampowered.com/app/11/'
      },
      12: {
        appId: 12,
        name: 'Released Game',
        type: 'game',
        releaseDate: 'Jan 1, 2024',
        comingSoon: false,
        developers: [],
        publishers: [],
        genres: [],
        categories: [],
        tags: [],
        storeUrl: 'https://store.steampowered.com/app/12/'
      }
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
      storeUrl: 'https://store.steampowered.com/app/10/'
    }
  ]);
  assert.deepEqual(harness.calls.getAppList, [{
    limit: 50,
    includeGames: true,
    includeDlc: true,
    includeSoftware: false
  }]);
  assert.deepEqual(harness.calls.getAppDetails, [10]);
});

test('steam release scout can include released apps when comingSoonOnly is false', async () => {
  const harness = createContext({
    appListResult: {
      apps: [
        { appId: 20, name: 'Shipping Tool', lastModified: undefined, priceChangeNumber: undefined }
      ],
      haveMoreResults: false,
      lastAppId: 20
    },
    detailsByAppId: {
      20: {
        appId: 20,
        name: 'Shipping Tool',
        type: 'software',
        releaseDate: 'May 1, 2026',
        comingSoon: false,
        developers: [],
        publishers: [],
        genres: [],
        categories: [],
        tags: [],
        storeUrl: 'https://store.steampowered.com/app/20/'
      }
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
      storeUrl: 'https://store.steampowered.com/app/20/'
    }
  ]);
  assert.deepEqual(harness.calls.getAppList, [{
    limit: 50,
    includeGames: false,
    includeDlc: false,
    includeSoftware: true
  }]);
});

test('steam release scout pages until it fills requested results', async () => {
  const harness = createContext({
    appListResults: [
      {
        apps: [
          { appId: 30, name: 'Already Released', lastModified: 1, priceChangeNumber: 1 }
        ],
        haveMoreResults: true,
        lastAppId: 30
      },
      {
        apps: [
          { appId: 31, name: 'Future Game', lastModified: 2, priceChangeNumber: 2 }
        ],
        haveMoreResults: false,
        lastAppId: 31
      }
    ],
    detailsByAppId: {
      30: {
        appId: 30,
        name: 'Already Released',
        type: 'game',
        releaseDate: 'Jan 1, 2024',
        comingSoon: false,
        developers: [],
        publishers: [],
        genres: [],
        categories: [],
        tags: [],
        storeUrl: 'https://store.steampowered.com/app/30/'
      },
      31: {
        appId: 31,
        name: 'Future Game',
        type: 'game',
        releaseDate: 'Coming soon',
        comingSoon: true,
        developers: [],
        publishers: [],
        genres: [],
        categories: [],
        tags: [],
        storeUrl: 'https://store.steampowered.com/app/31/'
      }
    }
  });

  const result = await harness.invoke({ limit: 1, types: ['game'] });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 31,
      name: 'Future Game',
      type: 'game',
      releaseDate: 'Coming soon',
      comingSoon: true,
      storeUrl: 'https://store.steampowered.com/app/31/'
    }
  ]);
  assert.deepEqual(harness.calls.getAppList, [
    {
      limit: 50,
      includeGames: true,
      includeDlc: false,
      includeSoftware: false
    },
    {
      limit: 50,
      lastAppId: 30,
      includeGames: true,
      includeDlc: false,
      includeSoftware: false
    }
  ]);
  assert.deepEqual(harness.calls.getAppDetails, [30, 31]);
});

test('steam release scout reports explicit missing-key failures', async () => {
  const harness = createContext({
    listError: new Error('Steam Web API key is required for official store catalog access. Set STEAM_API_KEY.')
  });

  const result = await harness.invoke({ limit: 5 });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official store catalog access. Set STEAM_API_KEY.'
  });
  assert.deepEqual(harness.calls.getAppDetails, []);
});