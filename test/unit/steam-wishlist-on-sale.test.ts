import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WishlistOnSaleResult } from '../../packages/steam-core/src/wishlist/index.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamWishlistOnSaleTool } from '../../packages/steam-mcp/src/tools/steam-wishlist-on-sale.js';

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
  wishlistOnSaleResult?: WishlistOnSaleResult;
  wishlistOnSaleError?: Error;
}) {
  const calls = {
    discover: 0,
    wishlistOnSale: [] as Array<unknown>,
    registeredTools: [] as string[]
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
    wishlistSaleService: {
      listOnSale: async (request: unknown) => {
        calls.wishlistOnSale.push(request);
        if (options.wishlistOnSaleError) {
          throw options.wishlistOnSaleError;
        }

        return options.wishlistOnSaleResult ?? { totalCount: 0, onSaleCount: 0, unknownPriceCount: 0, items: [] };
      }
    }
  } as unknown as SteamMcpContext;

  let handler: RegisteredToolHandler | undefined;
  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) {
      calls.registeredTools.push(name);
      if (name === 'steam_wishlist_on_sale') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamWishlistOnSaleTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke(rawArgs: unknown) {
      assert.ok(handler);
      return handler(rawArgs);
    }
  };
}

test('steam wishlist on sale registers the expected tool name', () => {
  const harness = createContext({ selectedUserId: '76561198000000000' });

  assert.deepEqual(harness.calls.registeredTools, ['steam_wishlist_on_sale']);
});

test('steam wishlist on sale returns sale derivation JSON and passes through limit', async () => {
  const harness = createContext({
    selectedUserId: '76561198000000000',
    wishlistOnSaleResult: {
      totalCount: 3,
      onSaleCount: 2,
      unknownPriceCount: 1,
      items: [{
        appId: 620,
        name: 'Portal 2',
        type: 'game',
        storeUrl: 'https://store.steampowered.com/app/620/',
        priority: 1,
        dateAdded: 1710000000,
        price: {
          currency: 'USD',
          initialInCents: 1999,
          finalInCents: 499,
          discountPercent: 75,
          initialFormatted: '$19.99',
          finalFormatted: '$4.99'
        }
      }]
    }
  });

  const result = await harness.invoke({ limit: 1 });

  assert.deepEqual(parseFirstTextContent(result), {
    totalCount: 3,
    onSaleCount: 2,
    unknownPriceCount: 1,
    items: [{
      appId: 620,
      name: 'Portal 2',
      type: 'game',
      storeUrl: 'https://store.steampowered.com/app/620/',
      priority: 1,
      dateAdded: 1710000000,
      price: {
        currency: 'USD',
        initialInCents: 1999,
        finalInCents: 499,
        discountPercent: 75,
        initialFormatted: '$19.99',
        finalFormatted: '$4.99'
      }
    }]
  });
  assert.deepEqual(harness.calls.wishlistOnSale, [{ steamId: '76561198000000000', limit: 1 }]);
});

test('steam wishlist on sale converts 32-bit selected user id to SteamID64 before fetching', async () => {
  const harness = createContext({ selectedUserId: '12345' });

  await harness.invoke({});

  assert.deepEqual(harness.calls.wishlistOnSale, [{ steamId: '76561197960278073' }]);
});

test('steam wishlist on sale reports explicit error when no selected user is available', async () => {
  const harness = createContext({});

  const result = await harness.invoke({});

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'No selected Steam user was found; steam_wishlist_on_sale requires a discoverable selected user.'
  });
  assert.deepEqual(harness.calls.wishlistOnSale, []);
});

test('steam wishlist on sale reports explicit error when selected user cannot be resolved to SteamID64', async () => {
  const harness = createContext({ selectedUserId: 'not-a-steam-id' });

  const result = await harness.invoke({});

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'The selected Steam user could not be resolved to a SteamID64; steam_wishlist_on_sale requires a valid SteamID64.'
  });
  assert.deepEqual(harness.calls.wishlistOnSale, []);
});

test('steam wishlist on sale surfaces upstream sale service failures', async () => {
  const harness = createContext({
    selectedUserId: '76561198000000000',
    wishlistOnSaleError: new Error('Official wishlist request failed with status 503.')
  });

  const result = await harness.invoke({});

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Official wishlist request failed with status 503.'
  });
});
