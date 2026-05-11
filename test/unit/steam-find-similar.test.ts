import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GameRecord, SearchMatch, StoreAppDetails, StoreSearchCandidate } from '@steam-mcp/steam-core';
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
  cacheableAppDetailsById?: Map<number, StoreAppDetails | undefined>;
  selectedUserId?: string | undefined;
  prioritizedAppIds?: number[];
  officialPrioritizeError?: Error;
}) {
  const calls = {
    searchLibrary: [] as Array<unknown>,
    rankSimilarLibraryGames: [] as Array<unknown>,
    storeSearch: [] as Array<unknown>,
    getCacheableAppDetails: [] as number[],
    prioritizeAppsForUser: [] as Array<unknown>,
    discover: 0,
    rankSimilarStoreCandidates: [] as Array<{ seedAppIds: number[]; candidateAppIds: number[]; candidates: StoreSearchCandidate[] }>
  };

  const context = {
    configService: {
      resolve: () => ({
        defaultIgnoreCollections: options.defaultIgnoreCollections ?? []
      })
    },
    discoveryService: {
      discover: async () => {
        calls.discover += 1;
        return {
          selectedUserId: options.selectedUserId,
          warnings: []
        };
      }
    },
    officialStoreClient: {
      prioritizeAppsForUser: async (request: unknown) => {
        calls.prioritizeAppsForUser.push(request);
        if (options.officialPrioritizeError) {
          throw options.officialPrioritizeError;
        }

        return {
          apps: (options.prioritizedAppIds ?? []).map((appId) => ({ appId }))
        };
      }
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
          candidateAppIds: candidates.map((candidate) => candidate.appId),
          candidates
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

test('steam find similar enriches store candidates with strict cacheable appdetails before ranking', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 620,
        name: 'Portal 2',
        genres: ['Puzzle'],
        tags: ['Co-op'],
        developers: ['Valve'],
        publishers: ['Valve']
      }
    ],
    storeCandidates: [
      {
        appId: 3,
        name: 'The Talos Principle',
        storeUrl: 'https://store.steampowered.com/app/257510',
        developers: [],
        publishers: [],
        genres: [],
        tags: []
      },
      {
        appId: 4,
        name: 'Unenriched Candidate',
        storeUrl: 'https://store.steampowered.com/app/4/'
      }
    ],
    cacheableAppDetailsById: new Map<number, StoreAppDetails | undefined>([
      [3, {
        appId: 3,
        name: 'The Talos Principle',
        developers: ['Croteam'],
        publishers: ['Devolver Digital'],
        genres: ['Puzzle'],
        categories: ['Single-player'],
        tags: ['Puzzle', 'Philosophical'],
        headerImage: 'https://cdn.example/talos.jpg',
        storeUrl: 'https://store.steampowered.com/app/257510/'
      }],
      [4, undefined]
    ])
  });

  const result = await harness.invoke({
    seedAppIds: [620],
    query: 'Portal 2',
    scope: 'store',
    limit: 10
  });

  assert.deepEqual(parseFirstTextContent(result), []);
  assert.deepEqual(harness.calls.storeSearch, [
    {
      query: 'Portal 2',
      deckStatuses: undefined,
      limit: 10
    }
  ]);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [3, 4]);
  assert.deepEqual(harness.calls.rankSimilarStoreCandidates, [
    {
      seedAppIds: [620],
      candidateAppIds: [3, 4],
      candidates: [
        {
          appId: 3,
          name: 'The Talos Principle',
          storeUrl: 'https://store.steampowered.com/app/257510',
          developers: ['Croteam'],
          publishers: ['Devolver Digital'],
          genres: ['Puzzle'],
          tags: ['Puzzle', 'Philosophical'],
          headerImage: 'https://cdn.example/talos.jpg'
        },
        {
          appId: 4,
          name: 'Unenriched Candidate',
          storeUrl: 'https://store.steampowered.com/app/4/'
        }
      ]
    }
  ]);
});

test('steam find similar leaves store candidates unchanged when strict cacheable appdetails are unavailable', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 620,
        name: 'Portal 2',
        genres: ['Puzzle'],
        tags: ['Co-op']
      }
    ],
    storeCandidates: [
      {
        appId: 3,
        name: 'The Talos Principle',
        storeUrl: 'https://store.steampowered.com/app/257510',
        developers: ['Original Dev'],
        genres: ['Adventure']
      }
    ],
    cacheableAppDetailsById: new Map<number, StoreAppDetails | undefined>([[3, undefined]])
  });

  const result = await harness.invoke({
    seedAppIds: [620],
    query: 'Portal 2',
    scope: 'store',
    limit: 10
  });

  assert.deepEqual(parseFirstTextContent(result), []);
  assert.deepEqual(harness.calls.getCacheableAppDetails, [3]);
  assert.deepEqual(harness.calls.rankSimilarStoreCandidates, [
    {
      seedAppIds: [620],
      candidateAppIds: [3],
      candidates: [
        {
          appId: 3,
          name: 'The Talos Principle',
          storeUrl: 'https://store.steampowered.com/app/257510',
          developers: ['Original Dev'],
          genres: ['Adventure']
        }
      ]
    }
  ]);
});

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
      mode: 'deterministic',
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
      candidateAppIds: [3],
      candidates: [
        {
          appId: 3,
          name: 'The Talos Principle',
          storeUrl: 'https://store.steampowered.com/app/257510'
        }
      ]
    }
  ]);
});

test('steam find similar official mode reorders enriched store candidates by official prioritization and appends unmatched candidates', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 620,
        name: 'Portal 2',
        genres: ['Puzzle'],
        tags: ['Co-op']
      }
    ],
    selectedUserId: '76561198000000000',
    prioritizedAppIds: [4, 3],
    storeCandidates: [
      {
        appId: 3,
        name: 'The Talos Principle',
        storeUrl: 'https://store.steampowered.com/app/257510'
      },
      {
        appId: 4,
        name: 'Q.U.B.E. 2',
        storeUrl: 'https://store.steampowered.com/app/359100'
      },
      {
        appId: 5,
        name: 'Unranked Candidate',
        storeUrl: 'https://store.steampowered.com/app/5/'
      }
    ]
  });

  const result = await harness.invoke({
    seedAppIds: [620],
    query: 'Portal 2',
    scope: 'store',
    mode: 'official',
    limit: 10
  });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      item: {
        appId: 4,
        name: 'Q.U.B.E. 2',
        storeUrl: 'https://store.steampowered.com/app/359100'
      },
      score: 3,
      reasons: ['official store prioritization']
    },
    {
      item: {
        appId: 3,
        name: 'The Talos Principle',
        storeUrl: 'https://store.steampowered.com/app/257510'
      },
      score: 2,
      reasons: ['official store prioritization']
    },
    {
      item: {
        appId: 5,
        name: 'Unranked Candidate',
        storeUrl: 'https://store.steampowered.com/app/5/'
      },
      score: 0,
      reasons: ['official store prioritization unavailable for this candidate']
    }
  ]);
  assert.deepEqual(harness.calls.prioritizeAppsForUser, [
    {
      appIds: [3, 4, 5],
      steamId: '76561198000000000',
      includeOwnedGames: true
    }
  ]);
  assert.equal(harness.calls.discover, 1);
  assert.deepEqual(harness.calls.rankSimilarStoreCandidates, []);
});

test('steam find similar official mode keeps library deterministic and only changes store ordering for scope both', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 620,
        name: 'Portal 2',
        genres: ['Puzzle'],
        tags: ['Co-op']
      }
    ],
    selectedUserId: '76561198000000000',
    prioritizedAppIds: [4],
    libraryMatches: [
      {
        item: {
          appId: 620,
          name: 'Portal 2'
        },
        score: 10,
        reasons: ['deterministic overlap']
      }
    ],
    storeCandidates: [
      {
        appId: 4,
        name: 'Q.U.B.E. 2',
        storeUrl: 'https://store.steampowered.com/app/359100'
      }
    ]
  });

  const result = await harness.invoke({
    seedAppIds: [620],
    query: 'Portal 2',
    scope: 'both',
    mode: 'official',
    limit: 10
  });

  assert.deepEqual(parseFirstTextContent(result), {
    library: [
      {
        item: {
          appId: 620,
          name: 'Portal 2'
        },
        score: 10,
        reasons: ['deterministic overlap']
      }
    ],
    store: [
      {
        item: {
          appId: 4,
          name: 'Q.U.B.E. 2',
          storeUrl: 'https://store.steampowered.com/app/359100'
        },
        score: 1,
        reasons: ['official store prioritization']
      }
    ]
  });
  assert.deepEqual(harness.calls.rankSimilarLibraryGames, [
    {
      seedAppIds: [620],
      query: 'Portal 2',
      scope: 'both',
      mode: 'official',
      limit: 10,
      ignoreCollections: []
    }
  ]);
  assert.deepEqual(harness.calls.rankSimilarStoreCandidates, []);
});

test('steam find similar official mode rejects library-only scope', async () => {
  const harness = createToolHarness({
    games: []
  });

  const result = await harness.invoke({
    scope: 'library',
    mode: 'official'
  });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'steam_find_similar mode="official" requires scope="store" or scope="both".'
  });
});

test('steam find similar official mode returns explicit error when no selected user is discoverable', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 620,
        name: 'Portal 2'
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
    seedAppIds: [620],
    query: 'Portal 2',
    scope: 'store',
    mode: 'official'
  });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'No selected Steam user was found; steam_find_similar mode="official" requires a discoverable selected user.'
  });
  assert.deepEqual(harness.calls.prioritizeAppsForUser, []);
});

test('steam find similar official mode returns explicit error when selected user cannot resolve to SteamID64', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 620,
        name: 'Portal 2'
      }
    ],
    selectedUserId: 'not-a-steam-id',
    storeCandidates: [
      {
        appId: 3,
        name: 'The Talos Principle',
        storeUrl: 'https://store.steampowered.com/app/257510'
      }
    ]
  });

  const result = await harness.invoke({
    seedAppIds: [620],
    query: 'Portal 2',
    scope: 'store',
    mode: 'official'
  });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'The selected Steam user could not be resolved to a SteamID64; steam_find_similar mode="official" requires a valid SteamID64.'
  });
  assert.deepEqual(harness.calls.prioritizeAppsForUser, []);
});

test('steam find similar official mode surfaces official client failures as explicit errors', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 620,
        name: 'Portal 2'
      }
    ],
    selectedUserId: '76561198000000000',
    officialPrioritizeError: new Error('Steam Web API key is required for official store similarity access. Set STEAM_API_KEY.'),
    storeCandidates: [
      {
        appId: 3,
        name: 'The Talos Principle',
        storeUrl: 'https://store.steampowered.com/app/257510'
      }
    ]
  });

  const result = await harness.invoke({
    seedAppIds: [620],
    query: 'Portal 2',
    scope: 'store',
    mode: 'official'
  });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official store similarity access. Set STEAM_API_KEY.'
  });
});

test('steam find similar official mode skips official client when no store search query can be derived', async () => {
  const harness = createToolHarness({
    games: [
      {
        appId: 620,
        name: 'Portal 2'
      }
    ],
    selectedUserId: '76561198000000000'
  });

  const result = await harness.invoke({
    query: '   ',
    scope: 'store',
    mode: 'official'
  });

  assert.deepEqual(parseFirstTextContent(result), []);
  assert.deepEqual(harness.calls.searchLibrary, []);
  assert.deepEqual(harness.calls.storeSearch, []);
  assert.deepEqual(harness.calls.prioritizeAppsForUser, []);
});
