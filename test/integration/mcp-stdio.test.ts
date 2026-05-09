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

async function writeOwnedGamesFetchPreload(fixtureRoot: string, appIds: number[], appDetailsPayloadById: Record<number, string> = {}): Promise<string> {
  const preloadPath = createPreloadPath(fixtureRoot);
  const script = `const ownedGames = ${JSON.stringify(appIds)};
const appDetailsPayloadById = ${JSON.stringify(appDetailsPayloadById)};
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
      'steam_release_scout',
      'steam_status',
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
