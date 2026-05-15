import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WishlistListResult } from '../../packages/steam-core/src/types.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamWishlistTool } from '../../packages/steam-mcp/src/tools/steam-wishlist.js';

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

function createContext(options: {
  selectedUserId?: string;
  wishlistResult?: WishlistListResult;
  wishlistError?: Error;
}) {
  const calls = {
    discover: 0,
    wishlistList: [] as Array<unknown>
  };

  const context = {
    discoveryService: {
      discover: async () => {
        calls.discover += 1;
        return {
          userIds: options.selectedUserId ? [options.selectedUserId] : [],
          selectedUserId: options.selectedUserId,
          warnings: [],
          libraryFolders: []
        };
      }
    },
    wishlistService: {
      list: async (request: unknown) => {
        calls.wishlistList.push(request);
        if (options.wishlistError) {
          throw options.wishlistError;
        }

        return options.wishlistResult ?? { totalCount: 0, items: [] };
      }
    }
  } as unknown as SteamMcpContext;

  let handler: RegisteredToolHandler | undefined;
  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) {
      if (name === 'steam_wishlist') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamWishlistTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke(rawArgs: unknown) {
      assert.ok(handler);
      return handler(rawArgs);
    }
  };
}

test('steam wishlist returns totalCount and slices upstream-ordered items by limit', async () => {
  const harness = createContext({
    selectedUserId: '76561198000000000',
    wishlistResult: {
      totalCount: 3,
      items: [
        { appId: 620, priority: 1, dateAdded: 1710000000 },
        { appId: 730, priority: 2, dateAdded: 1710000100 },
        { appId: 440, priority: 3 }
      ]
    }
  });

  const result = await harness.invoke({ limit: 2 });

  assert.deepEqual(parseFirstTextContent(result), {
    totalCount: 3,
    items: [
      { appId: 620, priority: 1, dateAdded: 1710000000 },
      { appId: 730, priority: 2, dateAdded: 1710000100 }
    ]
  });
  assert.deepEqual(harness.calls.wishlistList, [{ steamId: '76561198000000000' }]);
});

test('steam wishlist converts 32-bit selected user id to SteamID64 before fetching', async () => {
  const harness = createContext({ selectedUserId: '12345' });

  await harness.invoke({});

  assert.deepEqual(harness.calls.wishlistList, [{ steamId: '76561197960278073' }]);
});

test('steam wishlist reports explicit error when no selected user is available', async () => {
  const harness = createContext({});

  const result = await harness.invoke({ limit: 5 });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'No selected Steam user was found; steam_wishlist requires a discoverable selected user.'
  });
  assert.deepEqual(harness.calls.wishlistList, []);
});

test('steam wishlist reports explicit error when selected user cannot be resolved to SteamID64', async () => {
  const harness = createContext({ selectedUserId: 'invalid-user' });

  const result = await harness.invoke({});

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'The selected Steam user could not be resolved to a SteamID64; steam_wishlist requires a valid SteamID64.'
  });
  assert.deepEqual(harness.calls.wishlistList, []);
});

test('steam wishlist surfaces upstream wishlist failures', async () => {
  const harness = createContext({
    selectedUserId: '76561198000000000',
    wishlistError: new Error('Steam Web API key is required for official wishlist access. Set STEAM_API_KEY.')
  });

  const result = await harness.invoke({});

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official wishlist access. Set STEAM_API_KEY.'
  });
});
