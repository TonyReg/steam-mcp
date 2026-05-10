import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreAppDetails, StoreSearchCandidate } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamStoreSearchTool } from '../../packages/steam-mcp/src/tools/steam-store-search.js';

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

function createToolHarness(options: {
  searchResults: StoreSearchCandidate[];
  cacheableAppDetailsById?: Map<number, StoreAppDetails | undefined>;
}) {
  const calls = {
    search: [] as Array<unknown>,
    getCacheableAppDetails: [] as number[]
  };

  const context = {
    storeClient: {
      search: async (request: unknown) => {
        calls.search.push(request);
        return options.searchResults;
      },
      getCacheableAppDetails: async (appId: number) => {
        calls.getCacheableAppDetails.push(appId);
        return options.cacheableAppDetailsById?.get(appId);
      }
    }
  } as unknown as SteamMcpContext;

  let handler: RegisteredToolHandler | undefined;
  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) {
      if (name === 'steam_store_search') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamStoreSearchTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke: (rawArgs: unknown) => handler!(rawArgs)
  };
}

test('steam store search enriches candidates with strict cacheable appdetails when available', async () => {
  const harness = createToolHarness({
    searchResults: [
      {
        appId: 620,
        name: 'Portal 2',
        genres: ['Puzzle'],
        tags: ['Co-op'],
        storeUrl: 'https://store.steampowered.com/app/620/'
      },
      {
        appId: 257510,
        name: 'The Talos Principle',
        storeUrl: 'https://store.steampowered.com/app/257510/'
      }
    ],
    cacheableAppDetailsById: new Map<number, StoreAppDetails | undefined>([
      [620, {
        appId: 620,
        name: 'Portal 2',
        type: 'game',
        releaseDate: 'Apr 18, 2011',
        comingSoon: false,
        developers: ['Valve'],
        publishers: ['Valve'],
        genres: ['Puzzle', 'Action'],
        categories: ['Single-player', 'Co-op'],
        tags: ['Co-op', 'First-Person'],
        shortDescription: 'A mind-bending co-op puzzle game.',
        headerImage: 'https://cdn.example/portal2.jpg',
        storeUrl: 'https://store.steampowered.com/app/620/'
      }],
      [257510, undefined]
    ])
  });

  const result = await harness.invoke({ query: 'portal', limit: 10 });

  assert.deepEqual(harness.calls.search, [{ query: 'portal', limit: 10 }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [620, 257510]);
  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 620,
      name: 'Portal 2',
      type: 'game',
      releaseDate: 'Apr 18, 2011',
      comingSoon: false,
      developers: ['Valve'],
      publishers: ['Valve'],
      genres: ['Puzzle', 'Action'],
      categories: ['Single-player', 'Co-op'],
      tags: ['Co-op', 'First-Person'],
      shortDescription: 'A mind-bending co-op puzzle game.',
      headerImage: 'https://cdn.example/portal2.jpg',
      storeUrl: 'https://store.steampowered.com/app/620/'
    },
    {
      appId: 257510,
      name: 'The Talos Principle',
      storeUrl: 'https://store.steampowered.com/app/257510/'
    }
  ]);
});

test('steam store search leaves candidates unchanged when strict cacheable appdetails are unavailable', async () => {
  const originalCandidate: StoreSearchCandidate = {
    appId: 257510,
    name: 'The Talos Principle',
    developers: ['Original Dev'],
    genres: ['Adventure'],
    storeUrl: 'https://store.steampowered.com/app/257510/'
  };
  const harness = createToolHarness({
    searchResults: [originalCandidate],
    cacheableAppDetailsById: new Map<number, StoreAppDetails | undefined>([[257510, undefined]])
  });

  const result = await harness.invoke({ query: 'talos', limit: 5 });

  assert.deepEqual(harness.calls.search, [{ query: 'talos', limit: 5 }]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [257510]);
  assert.deepEqual(parseFirstTextContent(result), [originalCandidate]);
});

test('steam store search preserves raw search ordering after strict enrichment', async () => {
  const harness = createToolHarness({
    searchResults: [
      {
        appId: 3,
        name: 'First Candidate',
        storeUrl: 'https://store.steampowered.com/app/3/'
      },
      {
        appId: 4,
        name: 'Second Candidate',
        storeUrl: 'https://store.steampowered.com/app/4/'
      }
    ],
    cacheableAppDetailsById: new Map<number, StoreAppDetails | undefined>([
      [3, {
        appId: 3,
        name: 'First Candidate',
        developers: ['Dev One'],
        publishers: ['Pub One'],
        genres: ['Puzzle'],
        categories: ['Single-player'],
        tags: ['Puzzle'],
        storeUrl: 'https://store.steampowered.com/app/3/'
      }],
      [4, {
        appId: 4,
        name: 'Second Candidate',
        developers: ['Dev Two'],
        publishers: ['Pub Two'],
        genres: ['Action'],
        categories: ['Multi-player'],
        tags: ['Action'],
        storeUrl: 'https://store.steampowered.com/app/4/'
      }]
    ])
  });

  const result = await harness.invoke({ query: 'candidate', limit: 2 });
  const parsed = parseFirstTextContent(result) as Array<{ appId: number }>;

  assert.deepEqual(harness.calls.getCacheableAppDetails, [3, 4]);
  assert.deepEqual(parsed.map((candidate) => candidate.appId), [3, 4]);
});
