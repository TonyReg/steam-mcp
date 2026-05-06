import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GameRecord, SearchMatch, StoreSearchCandidate } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamFindSimilarTool } from '../../packages/steam-mcp/src/tools/steam-find-similar.js';

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

function createLibraryListResult(games: GameRecord[]) {
  return {
    games,
    warnings: [],
    summary: {
      total: games.length,
      returned: games.length,
      installed: games.filter((game) => game.installed).length,
      favorites: games.filter((game) => game.favorite).length,
      hidden: games.filter((game) => game.hidden).length
    }
  };
}

function createToolHarness(options: {
  games: GameRecord[];
  defaultIgnoreCollections?: string[];
  libraryMatches?: SearchMatch<GameRecord>[];
  searchMatches?: SearchMatch<GameRecord>[];
  storeCandidates?: StoreSearchCandidate[];
  storeMatches?: SearchMatch<StoreSearchCandidate>[];
}) {
  const calls = {
    searchLibrary: [] as Array<unknown>,
    rankSimilarLibraryGames: [] as Array<unknown>,
    storeSearch: [] as Array<unknown>,
    rankSimilarStoreCandidates: [] as Array<{ seedAppIds: number[]; candidateAppIds: number[] }>
  };

  const context = {
    configService: {
      resolve: () => ({
        defaultIgnoreCollections: options.defaultIgnoreCollections ?? []
      })
    },
    libraryService: {
      list: async () => createLibraryListResult(options.games)
    },
    recommendService: {
      rankSimilarLibraryGames: (games: GameRecord[], request: unknown) => {
        calls.rankSimilarLibraryGames.push(request);
        return options.libraryMatches ?? [];
      },
      rankSimilarStoreCandidates: (seedGames: GameRecord[], candidates: StoreSearchCandidate[]) => {
        calls.rankSimilarStoreCandidates.push({
          seedAppIds: seedGames.map((game) => game.appId),
          candidateAppIds: candidates.map((candidate) => candidate.appId)
        });
        return options.storeMatches ?? [];
      }
    },
    searchService: {
      searchLibrary: (games: GameRecord[], request: unknown) => {
        calls.searchLibrary.push(request);
        return options.searchMatches ?? [];
      }
    },
    storeClient: {
      search: async (request: unknown) => {
        calls.storeSearch.push(request);
        return options.storeCandidates ?? [];
      }
    }
  } as unknown as SteamMcpContext;

  let handler: RegisteredToolHandler | undefined;
  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) {
      if (name === 'steam_find_similar') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamFindSimilarTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke: (rawArgs: unknown) => handler(rawArgs)
  };
}

test('steam find similar does not search store when query normalizes to empty and no seeds exist', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 620,
        name: 'Portal 2',
        collections: ['Backlog'],
        genres: ['Puzzle'],
        tags: ['Co-op']
      }
    ]
  });

  const result = await harness.invoke({
    query: '   ',
    scope: 'store',
    limit: 10
  });

  assert.deepEqual(parseFirstTextContent(result), []);
  assert.deepEqual(harness.calls.searchLibrary, []);
  assert.deepEqual(harness.calls.storeSearch, []);
  assert.deepEqual(harness.calls.rankSimilarStoreCandidates, []);
  assert.deepEqual(harness.calls.rankSimilarLibraryGames, [
    {
      query: undefined,
      scope: 'store',
      limit: 10,
      ignoreCollections: []
    }
  ]);
});

test('steam find similar ignores explicit seed collections case-insensitively for store scope', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 1,
        name: 'Portal 2',
        collections: ['Disliked'],
        genres: ['Puzzle'],
        tags: ['Co-op']
      },
      {
        appId: 2,
        name: 'Portal Stories: Mel',
        collections: ['Backlog'],
        genres: ['Puzzle'],
        tags: ['Story Rich']
      }
    ],
    storeCandidates: [
      {
        appId: 3,
        name: 'The Talos Principle',
        storeUrl: 'https://store.steampowered.com/app/257510'
      }
    ]
  });

  const result = await harness.invoke({
    seedAppIds: [1, 2],
    ignoreCollections: [' DISLIKED '],
    scope: 'store',
    limit: 10
  });

  assert.deepEqual(parseFirstTextContent(result), []);
  assert.deepEqual(harness.calls.searchLibrary, []);
  assert.deepEqual(harness.calls.storeSearch, [
    {
      query: 'Portal Stories: Mel',
      deckStatuses: undefined,
      limit: 10
    }
  ]);
  assert.deepEqual(harness.calls.rankSimilarStoreCandidates, [
    {
      seedAppIds: [2],
      candidateAppIds: [3]
    }
  ]);
});
