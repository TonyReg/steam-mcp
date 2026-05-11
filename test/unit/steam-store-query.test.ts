import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OfficialStoreQueryItemsResult } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamStoreQueryTool } from '../../packages/steam-mcp/src/tools/steam-store-query.js';

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
  queryItemsResult?: OfficialStoreQueryItemsResult;
  queryItemsError?: Error;
}) {
  const calls = {
    queryItems: [] as Array<unknown>
  };

  const context = {
    officialStoreClient: {
      queryItems: async (request: unknown) => {
        calls.queryItems.push(request);
        if (options.queryItemsError) {
          throw options.queryItemsError;
        }

        return options.queryItemsResult ?? { items: [] };
      }
    }
  } as unknown as SteamMcpContext;

  let handler: RegisteredToolHandler | undefined;
  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) {
      if (name === 'steam_store_query') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamStoreQueryTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke: (rawArgs: unknown) => handler!(rawArgs)
  };
}

test('steam store query forwards official catalog filters and returns items directly', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        {
          appId: 730,
          name: 'Counter-Strike 2',
          type: 'game',
          releaseDate: 'Aug 21, 2012',
          comingSoon: false,
          freeToPlay: true,
          developers: ['Valve'],
          publishers: ['Valve'],
          shortDescription: 'Competitive FPS.',
          headerImage: 'https://cdn.example/cs2.jpg',
          storeUrl: 'https://store.steampowered.com/app/730/'
        },
        {
          appId: 2051120,
          name: 'Portal with RTX',
          type: 'dlc',
          releaseDate: 'Dec 8, 2022',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/2051120/'
        }
      ]
    }
  });

  const result = await harness.invoke({
    limit: 5,
    types: ['game', 'dlc'],
    comingSoonOnly: false,
    freeToPlay: true
  });

  assert.deepEqual(harness.calls.queryItems, [{
    limit: 5,
    types: ['game', 'dlc'],
    comingSoonOnly: false,
    freeToPlay: true
  }]);
  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 730,
      name: 'Counter-Strike 2',
      type: 'game',
      releaseDate: 'Aug 21, 2012',
      comingSoon: false,
      freeToPlay: true,
      developers: ['Valve'],
      publishers: ['Valve'],
      shortDescription: 'Competitive FPS.',
      headerImage: 'https://cdn.example/cs2.jpg',
      storeUrl: 'https://store.steampowered.com/app/730/'
    },
    {
      appId: 2051120,
      name: 'Portal with RTX',
      type: 'dlc',
      releaseDate: 'Dec 8, 2022',
      comingSoon: false,
      freeToPlay: false,
      storeUrl: 'https://store.steampowered.com/app/2051120/'
    }
  ]);
});

test('steam store query preserves omitted args so official client defaults apply', async () => {
  const harness = createToolHarness({
    queryItemsResult: {
      items: [
        {
          appId: 620,
          name: 'Portal 2',
          type: 'game',
          releaseDate: 'Apr 18, 2011',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/620/'
        }
      ]
    }
  });

  const result = await harness.invoke({});

  assert.deepEqual(harness.calls.queryItems, [{}]);
  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 620,
      name: 'Portal 2',
      type: 'game',
      releaseDate: 'Apr 18, 2011',
      comingSoon: false,
      freeToPlay: false,
      storeUrl: 'https://store.steampowered.com/app/620/'
    }
  ]);
});

test('steam store query surfaces official query failures as an explicit error payload', async () => {
  const harness = createToolHarness({
    queryItemsError: new Error('Steam Web API key is required for official store query access. Set STEAM_API_KEY.')
  });

  const result = await harness.invoke({ comingSoonOnly: true });

  assert.deepEqual(harness.calls.queryItems, [{ comingSoonOnly: true }]);
  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official store query access. Set STEAM_API_KEY.'
  });
});
