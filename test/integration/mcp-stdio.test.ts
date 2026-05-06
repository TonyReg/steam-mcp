import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
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
      'steam_library_curator'
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
    assert.match(JSON.stringify(collectionPlannerPrompt), /does not mean Steam sync has completed/);

    const status = await client.callTool({ name: 'steam_status', arguments: {} });
    assert.match(JSON.stringify(status), /cloudstorage-json/);
    assert.match(JSON.stringify(status), /windowsOrchestrationEnabled/);
    assert.match(JSON.stringify(status), /windowsOrchestrationSupported/);

    const library = await client.callTool({ name: 'steam_library_list', arguments: { limit: 2 } });
    assert.match(JSON.stringify(library), /Portal 2/);

    const links = await client.callTool({ name: 'steam_link_generate', arguments: { appIds: [620] } });
    assert.match(JSON.stringify(links), /steam:\/\/run\/620/);

    assert.ok(stderrChunks.some((chunk) => chunk.includes('steam-mcp server connected')));
  } finally {
    await client.close();
  }
});

test('stdio server reports missing Steam Web API key in status', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  delete fixture.env.STEAM_API_KEY;
  delete fixture.env.STEAM_WEB_API_KEY;

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
    assert.ok(statusPayload.warnings.some((warning) => warning.includes('Steam Web API key not available in MCP runtime')));
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
    assert.equal(statusPayload.warnings.some((warning) => warning.includes('Steam Web API key not available in MCP runtime')), false);
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
    assert.deepEqual(listPayload.games.map((game) => game.appId).sort((left, right) => left - right), [440, 570]);
    assert.equal(listPayload.summary.total, 3);
    assert.equal(listPayload.summary.returned, 2);
  } finally {
    await client.close();
  }
});
