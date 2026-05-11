import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { materializeSteamFixture } from '../support/fixture-steam.js';

function parseFirstTextContent(result: { content?: Array<{ type: string; text?: string }> }): unknown {
  const firstContent = result.content?.[0];
  assert.ok(firstContent);
  assert.equal(firstContent.type, 'text');
  assert.equal(typeof firstContent.text, 'string');
  return JSON.parse(firstContent.text);
}

function createPreloadPath(fixtureRoot: string): string {
  return path.join(fixtureRoot, 'fetch-preload.mjs');
}

async function writeOwnedGamesFetchPreload(
  fixtureRoot: string,
  appIds: number[],
  appDetailsPayloadById: Record<number, string> = {},
  recentlyPlayedGames: Array<Record<string, unknown>> = [],
  storeSearchItems: Array<Record<string, unknown>> = [],
  prioritizedAppIds: number[] = []
): Promise<string> {
  const preloadPath = createPreloadPath(fixtureRoot);
  const script = `const ownedGames = ${JSON.stringify(appIds)};
const appDetailsPayloadById = ${JSON.stringify(appDetailsPayloadById)};
const recentlyPlayedGames = ${JSON.stringify(recentlyPlayedGames)};
const storeSearchItems = ${JSON.stringify(storeSearchItems)};
const prioritizedAppIds = ${JSON.stringify(prioritizedAppIds)};
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));

  if (url.hostname === 'api.steampowered.com' && url.pathname === '/IPlayerService/GetOwnedGames/v1/') {
    return new Response(JSON.stringify({
      response: {
        game_count: ownedGames.length,
        games: ownedGames.map((appId) => ({ appid: appId, name: appId === 620 ? 'Portal 2' : \`Owned App \${appId}\`, playtime_forever: appId === 620 ? 240 : 0 }))
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (url.hostname === 'api.steampowered.com' && url.pathname === '/IPlayerService/GetRecentlyPlayedGames/v1/') {
    return new Response(JSON.stringify({
      response: {
        total_count: recentlyPlayedGames.length,
        games: recentlyPlayedGames
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (url.hostname === 'api.steampowered.com' && url.pathname === '/IStoreAppSimilarityService/PrioritizeAppsForUser/v1/') {
    return new Response(JSON.stringify({
      response: {
        ids: prioritizedAppIds.map((appId) => ({ appid: appId }))
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (url.hostname === 'store.steampowered.com' && url.pathname === '/api/storesearch/') {
    return new Response(JSON.stringify({
      items: storeSearchItems
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (url.hostname === 'store.steampowered.com' && url.pathname === '/api/appdetails') {
    const appId = Number(url.searchParams.get('appids'));
    const payload = appDetailsPayloadById[appId];
    if (payload) {
      return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } });
    }
  }

  return originalFetch(input, init);
};
`;

  await writeFile(preloadPath, script, 'utf8');
  return preloadPath;
}

test('stdio server registers exact tools and answers basic calls', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const stderrChunks: string[] = [];
  const client = new Client({ name: 'steam-mcp-test-client', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'packages', 'steam-mcp', 'dist', 'index.js')],
    cwd: repoRoot,
    env: fixture.env,
    stderr: 'pipe'
  });

  transport.stderr?.on('data', (chunk) => {
    stderrChunks.push(String(chunk));
  });

  await client.connect(transport);

  try {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort((left, right) => left.localeCompare(right));
    assert.deepEqual(toolNames, [
      'steam_collection_apply',
      'steam_collection_plan',
      'steam_export',
      'steam_find_similar',
      'steam_library_list',
      'steam_library_search',
      'steam_link_generate',
      'steam_recently_played',
      'steam_release_scout',
      'steam_status',
      'steam_store_query',
      'steam_store_search'
    ]);
    const collectionApplyTool = tools.tools.find((tool) => tool.name === 'steam_collection_apply');
    assert.ok(collectionApplyTool);
    assert.match(JSON.stringify(collectionApplyTool), /"finalize"/);
    assert.doesNotMatch(JSON.stringify(collectionApplyTool), /experimentalFinalize/);
    assert.match(JSON.stringify(collectionApplyTool), /STEAM_ENABLE_COLLECTION_WRITES=1/);
    assert.match(JSON.stringify(collectionApplyTool), /STEAM_ENABLE_WINDOWS_ORCHESTRATION=1/);

    const prompts = await client.listPrompts();
    const promptNames = prompts.prompts.map((prompt) => prompt.name).sort((left, right) => left.localeCompare(right));
    assert.deepEqual(promptNames, [
      'steam_collection_planner',
      'steam_deck_backlog_triage',
      'steam_library_curator',
      'steam_release_scout'
    ]);

    const collectionPlannerPrompt = await client.getPrompt({
      name: 'steam_collection_planner',
      arguments: {
        request: 'Group co-op hidden backlog',
        mode: 'merge'
      }
    });
    assert.match(JSON.stringify(collectionPlannerPrompt), /steam_collection_plan/);
    assert.match(JSON.stringify(collectionPlannerPrompt), /Group co-op hidden backlog/);
    assert.match(JSON.stringify(collectionPlannerPrompt), /STEAM_ENABLE_WINDOWS_ORCHESTRATION=1/);
    assert.match(JSON.stringify(collectionPlannerPrompt), /does not mean Steam cloud sync has completed/);

    const releaseScoutPrompt = await client.getPrompt({
      name: 'steam_release_scout',
      arguments: {
        limit: '12',
        types: 'game,dlc',
        comingSoonOnly: 'false'
      }
    });
    assert.match(JSON.stringify(releaseScoutPrompt), /steam_release_scout/);
    assert.match(JSON.stringify(releaseScoutPrompt), /Requested result limit: 12/);
    assert.match(JSON.stringify(releaseScoutPrompt), /Requested release types: game, dlc/);
    assert.match(JSON.stringify(releaseScoutPrompt), /Coming soon only: false/);
    assert.match(JSON.stringify(releaseScoutPrompt), /STEAM_API_KEY/);

    const libraryCuratorPrompt = await client.getPrompt({
      name: 'steam_library_curator',
      arguments: {
        goal: 'Find co-op puzzle recommendations'
      }
    });
    assert.match(JSON.stringify(libraryCuratorPrompt), /steam_store_query/);
    assert.match(JSON.stringify(libraryCuratorPrompt), /steam_store_search/);

    const status = await client.callTool({ name: 'steam_status', arguments: {} });
    const statusPayload = parseFirstTextContent(status) as {
      collectionBackendId?: string;
      collectionApplyEnabled?: boolean;
      windowsOrchestrationEnabled?: boolean;
      collectionApplySafe?: boolean;
      steamWebApiKeyAvailable?: boolean;
      warnings?: string[];
    };
    assert.equal(statusPayload.collectionBackendId, 'cloudstorage-json');
    assert.equal(statusPayload.collectionApplyEnabled, false);
    assert.equal(statusPayload.windowsOrchestrationEnabled, false);
    assert.equal(statusPayload.collectionApplySafe, false);
    assert.equal(statusPayload.steamWebApiKeyAvailable, false);
    assert.ok(Array.isArray(statusPayload.warnings));
  } finally {
    await client.close();
  }

  assert.equal(stderrChunks.some((chunk) => /Error/i.test(chunk)), false, stderrChunks.join('\n'));
});

test('stdio server reports missing Steam Web API key in status', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  delete fixture.env.STEAM_API_KEY;

  const client = new Client({ name: 'steam-mcp-test-client-status-missing-key', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'packages', 'steam-mcp', 'dist', 'index.js')],
    cwd: repoRoot,
    env: fixture.env,
    stderr: 'pipe'
  });

  await client.connect(transport);

  try {
    const statusResult = await client.callTool({ name: 'steam_status', arguments: {} });
    const statusPayload = parseFirstTextContent(statusResult) as {
      steamWebApiKeyAvailable: boolean;
      warnings: string[];
    };

    assert.equal(statusPayload.steamWebApiKeyAvailable, false);
    assert.ok(statusPayload.warnings.some((warning) => warning.includes('GetOwnedGames is the authoritative source for owned-game membership')));
  } finally {
    await client.close();
  }
});

test('stdio server reports Steam Web API key availability when configured', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  fixture.env.STEAM_API_KEY = 'test-key';

  const client = new Client({ name: 'steam-mcp-test-client-status-key-present', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'packages', 'steam-mcp', 'dist', 'index.js')],
    cwd: repoRoot,
    env: fixture.env,
    stderr: 'pipe'
  });

  await client.connect(transport);

  try {
    const statusResult = await client.callTool({ name: 'steam_status', arguments: {} });
    const statusPayload = parseFirstTextContent(statusResult) as {
      steamWebApiKeyAvailable: boolean;
      warnings: string[];
    };

    assert.equal(statusPayload.steamWebApiKeyAvailable, true);
    assert.equal(statusPayload.warnings.some((warning) => warning.includes('GetOwnedGames is the authoritative source for owned-game membership')), false);
  } finally {
    await client.close();
  }
});

test('stdio server applies env-configured default protected collections', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  fixture.env.STEAM_DEFAULT_READ_ONLY_COLLECTIONS = '["Puzzle"]';
  fixture.env.STEAM_DEFAULT_IGNORE_COLLECTIONS = '["Puzzle"]';

  const client = new Client({ name: 'steam-mcp-test-client-default-collections', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'packages', 'steam-mcp', 'dist', 'index.js')],
    cwd: repoRoot,
    env: fixture.env,
    stderr: 'pipe'
  });

  await client.connect(transport);

  try {
    const planResult = await client.callTool({
      name: 'steam_collection_plan',
      arguments: {
        mode: 'merge',
        rules: [
          {
            appIds: [620],
            setCollections: ['Co-op']
          }
        ]
      }
    });
    const planPayload = parseFirstTextContent(planResult) as {
      plan: {
        policies: {
          readOnlyCollections: string[];
          ignoreCollections: string[];
        };
      };
    };
    assert.deepEqual(planPayload.plan.policies, {
      readOnlyCollections: ['Puzzle'],
      ignoreCollections: ['Puzzle']
    });

    const similarResult = await client.callTool({
      name: 'steam_find_similar',
      arguments: {
        query: 'portal 2',
        scope: 'library',
        limit: 10
      }
    });
    const similarPayload = parseFirstTextContent(similarResult) as unknown[];
    assert.deepEqual(similarPayload, []);

    const searchResult = await client.callTool({
      name: 'steam_library_search',
      arguments: {
        query: 'portal',
        limit: 10
      }
    });
    const searchPayload = parseFirstTextContent(searchResult) as unknown[];
    assert.deepEqual(searchPayload, []);

    const listResult = await client.callTool({
      name: 'steam_library_list',
      arguments: {
        limit: 10
      }
    });
    const listPayload = parseFirstTextContent(listResult) as {
      games: Array<{ appId: number }>;
      summary: { total: number; returned: number };
    };
    assert.deepEqual(listPayload.games, []);
    assert.equal(listPayload.summary.total, 0);
    assert.equal(listPayload.summary.returned, 0);
  } finally {
    await client.close();
  }
});


test('stdio server lists API-owned games through preload-patched GetOwnedGames', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  fixture.env.STEAM_API_KEY = 'test-key';
  const appDetails620 = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  const preloadPath = await writeOwnedGamesFetchPreload(fixture.rootDir, [620], { 620: appDetails620 });
  fixture.env.NODE_OPTIONS = [fixture.env.NODE_OPTIONS, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(' ');

  const client = new Client({ name: 'steam-mcp-test-client-owned-games', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'packages', 'steam-mcp', 'dist', 'index.js')],
    cwd: repoRoot,
    env: fixture.env,
    stderr: 'pipe'
  });

  await client.connect(transport);

  try {
    const listResult = await client.callTool({
      name: 'steam_library_list',
      arguments: {
        limit: 10
      }
    });
    const listPayload = parseFirstTextContent(listResult) as {
      games: Array<{ appId: number; name: string; tags?: string[]; storeUrl?: string }>;
      summary: { total: number; returned: number };
      warnings?: string[];
    };

    assert.deepEqual(listPayload.games.map((game) => game.appId), [620]);
    assert.equal(listPayload.games[0]?.name, 'Portal 2');
    assert.deepEqual((listPayload.games[0]?.tags ?? []).slice().sort((left, right) => left.localeCompare(right)), ['Co-op', 'Puzzle']);
    assert.equal(listPayload.games[0]?.storeUrl, 'https://store.steampowered.com/app/620/');
    assert.equal(listPayload.summary.total, 1);
    assert.equal(listPayload.summary.returned, 1);
    assert.equal(listPayload.warnings?.some((warning) => warning.includes('GetOwnedGames is the authoritative source for owned-game membership')), false);
  } finally {
    await client.close();
  }
});

test('stdio server returns recently played games through preload-patched GetRecentlyPlayedGames', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  fixture.env.STEAM_API_KEY = 'test-key';
  const preloadPath = await writeOwnedGamesFetchPreload(
    fixture.rootDir,
    [],
    {},
    [
      { appid: 620, name: 'Portal 2', playtime_2weeks: 45, playtime_forever: 240, img_icon_url: 'icon-620' },
      { appid: 440, name: 'Team Fortress 2', playtime_2weeks: 30, playtime_forever: 1200, img_icon_url: 'icon-440' }
    ]
  );
  fixture.env.NODE_OPTIONS = [fixture.env.NODE_OPTIONS, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(' ');

  const client = new Client({ name: 'steam-mcp-test-client-recently-played', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'packages', 'steam-mcp', 'dist', 'index.js')],
    cwd: repoRoot,
    env: fixture.env,
    stderr: 'pipe'
  });

  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'steam_recently_played',
      arguments: {
        limit: 1
      }
    });
    const payload = parseFirstTextContent(result) as {
      totalCount: number;
      games: Array<{
        appId: number;
        name?: string;
        playtimeTwoWeeks?: number;
        playtimeForever?: number;
        iconUrl?: string;
      }>;
    };

    assert.equal(payload.totalCount, 2);
    assert.deepEqual(payload.games, [
      {
        appId: 620,
        name: 'Portal 2',
        playtimeTwoWeeks: 45,
        playtimeForever: 240,
        iconUrl: 'icon-620'
      }
    ]);
  } finally {
    await client.close();
  }
});

test('stdio server reorders steam_find_similar store matches in official mode through preload-patched store search and official prioritization', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  fixture.env.STEAM_API_KEY = 'test-key';
  const appDetails620 = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  const appDetails2051120 = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-2051120.json'), 'utf8');
  const preloadPath = await writeOwnedGamesFetchPreload(
    fixture.rootDir,
    [620],
    {
      620: appDetails620,
      2051120: appDetails2051120
    },
    [],
    [
      {
        id: 620,
        name: 'Portal 2',
        developers: ['Valve'],
        publishers: ['Valve'],
        genres: ['Puzzle'],
        tags: ['Co-op'],
        is_free: false,
        tiny_image: 'https://cdn.example/portal2.jpg'
      },
      {
        id: 2051120,
        name: 'Split Fiction',
        developers: ['Hazelight Studios'],
        publishers: ['Electronic Arts'],
        genres: ['Action', 'Adventure'],
        tags: ['Co-op'],
        is_free: false,
        tiny_image: 'https://cdn.example/split-fiction.jpg'
      }
    ],
    [2051120, 620]
  );
  fixture.env.NODE_OPTIONS = [fixture.env.NODE_OPTIONS, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(' ');

  const client = new Client({ name: 'steam-mcp-test-client-similar-official', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'packages', 'steam-mcp', 'dist', 'index.js')],
    cwd: repoRoot,
    env: fixture.env,
    stderr: 'pipe'
  });

  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'steam_find_similar',
      arguments: {
        seedAppIds: [620],
        query: 'Portal 2',
        scope: 'store',
        mode: 'official',
        limit: 10
      }
    });
    const payload = parseFirstTextContent(result) as Array<{
      item: { appId: number };
      reasons: string[];
    }>;
    assert.deepEqual(payload.map((match) => match.item.appId), [2051120, 620]);
    assert.deepEqual(payload.map((match) => match.reasons), [
      ['official store prioritization'],
      ['official store prioritization']
    ]);
  } finally {
    await client.close();
  }
});

test('stdio server returns explicit missing-key error for steam_recently_played', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  delete fixture.env.STEAM_API_KEY;

  const client = new Client({ name: 'steam-mcp-test-client-recently-played-missing-key', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'packages', 'steam-mcp', 'dist', 'index.js')],
    cwd: repoRoot,
    env: fixture.env,
    stderr: 'pipe'
  });

  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'steam_recently_played',
      arguments: {}
    });
    const payload = parseFirstTextContent(result) as { error: string };
    assert.deepEqual(payload, {
      error: 'Steam Web API key is required for official recently-played access. Set STEAM_API_KEY.'
    });
  } finally {
    await client.close();
  }
});
