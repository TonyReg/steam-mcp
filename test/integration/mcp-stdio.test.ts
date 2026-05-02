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

  const status = await client.callTool({ name: 'steam_status', arguments: {} });
  assert.match(JSON.stringify(status), /cloudstorage-json/);

  const library = await client.callTool({ name: 'steam_library_list', arguments: { limit: 2 } });
  assert.match(JSON.stringify(library), /Portal 2/);

  const links = await client.callTool({ name: 'steam_link_generate', arguments: { appIds: [620] } });
  assert.match(JSON.stringify(links), /steam:\/\/run\/620/);

  assert.ok(stderrChunks.some((chunk) => chunk.includes('steam-mcp server connected')));

  await client.close();
});

test('stdio server applies env-configured default protected groups', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  fixture.env.STEAM_DEFAULT_READ_ONLY_GROUPS = '["Puzzle"]';
  fixture.env.STEAM_DEFAULT_IGNORE_GROUPS = '["Puzzle"]';

  const client = new Client({ name: 'steam-mcp-test-client-default-groups', version: '0.1.0' });
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
          readOnlyGroups: string[];
          ignoreGroups: string[];
        };
      };
    };
    assert.deepEqual(planPayload.plan.policies, {
      readOnlyGroups: ['Puzzle'],
      ignoreGroups: ['Puzzle']
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
