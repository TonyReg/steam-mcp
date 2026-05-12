import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OfficialStoreListsResult, SteamCuratorDiscoveryResult } from '../../packages/steam-core/src/types.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamCuratorDiscoveryTool } from '../../packages/steam-mcp/src/tools/steam-curator-discovery.js';

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
  const text = firstContent.text;
  if (typeof text !== 'string') {
    throw new Error('Expected text content.');
  }
  return JSON.parse(text);
}

function createContext(options: { listsResult?: OfficialStoreListsResult; listsError?: Error }) {
  const calls = {
    getLists: [] as Array<unknown>,
    getItems: [] as Array<unknown>,
    getItemsToFeature: [] as Array<unknown>,
    queryItems: [] as Array<unknown>
  };

  const context = {
    officialStoreClient: {
      getLists: async (request: unknown) => {
        calls.getLists.push(request);
        if (options.listsError) {
          throw options.listsError;
        }

        return options.listsResult ?? { lists: [] };
      },
      getItems: async (request: unknown) => {
        calls.getItems.push(request);
        throw new Error('getItems should not be called');
      },
      getItemsToFeature: async (request: unknown) => {
        calls.getItemsToFeature.push(request);
        throw new Error('getItemsToFeature should not be called');
      },
      queryItems: async (request: unknown) => {
        calls.queryItems.push(request);
        throw new Error('queryItems should not be called');
      }
    }
  } as unknown as SteamMcpContext;

  let handler: RegisteredToolHandler | undefined;
  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) {
      if (name === 'steam_curator_discovery') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamCuratorDiscoveryTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke(rawArgs: unknown) {
      assert.ok(handler);
      return handler(rawArgs);
    }
  };
}

test('steam curator discovery uses GetLists only, preserving upstream ordering and curator metadata', async () => {
  const harness = createContext({
    listsResult: {
      lists: [
        {
          listId: '9876543210123456789',
          title: 'Co-op Gems',
          curatorName: 'Puzzle Curator',
          curatorSteamId: '76561198000000001',
          description: 'Tightly curated co-op picks.',
          appCount: 12
        },
        {
          listId: '12345678901234567890',
          title: 'Narrative Finds',
          curatorName: 'Story Scout',
          curatorSteamId: '76561198000000002',
          description: 'Story-rich recommendations.',
          appCount: 7
        }
      ]
    }
  });

  const result = await harness.invoke({ limit: 2, start: 40 });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      listId: '9876543210123456789',
      title: 'Co-op Gems',
      source: 'curation',
      ordering: 'curation',
      method: 'getLists',
      filtersApplied: ['limit:2', 'start:40', 'metadataOnly:true'],
      curatorName: 'Puzzle Curator',
      curatorSteamId: '76561198000000001',
      description: 'Tightly curated co-op picks.',
      appCount: 12
    },
    {
      listId: '12345678901234567890',
      title: 'Narrative Finds',
      source: 'curation',
      ordering: 'curation',
      method: 'getLists',
      filtersApplied: ['limit:2', 'start:40', 'metadataOnly:true'],
      curatorName: 'Story Scout',
      curatorSteamId: '76561198000000002',
      description: 'Story-rich recommendations.',
      appCount: 7
    }
  ] satisfies SteamCuratorDiscoveryResult[]);
  assert.deepEqual(harness.calls.getLists, [{ count: 2, start: 40, returnMetadataOnly: true }]);
  assert.deepEqual(harness.calls.getItems, []);
  assert.deepEqual(harness.calls.getItemsToFeature, []);
  assert.deepEqual(harness.calls.queryItems, []);
});

test('steam curator discovery uses defaults when optional args are omitted', async () => {
  const harness = createContext({
    listsResult: {
      lists: [{ listId: '1', title: 'Default Window' }]
    }
  });

  const result = await harness.invoke({});
  assert.deepEqual(parseFirstTextContent(result), [
    {
      listId: '1',
      title: 'Default Window',
      source: 'curation',
      ordering: 'curation',
      method: 'getLists',
      filtersApplied: ['limit:20', 'start:0', 'metadataOnly:true']
    }
  ]);
  assert.deepEqual(harness.calls.getLists, [{ count: 20, returnMetadataOnly: true }]);
});

test('steam curator discovery returns explicit API-key failures from official curation access', async () => {
  const harness = createContext({
    listsError: new Error('Steam Web API key is required for official store curation access. Set STEAM_API_KEY.')
  });

  const result = await harness.invoke({});
  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official store curation access. Set STEAM_API_KEY.'
  });
});
