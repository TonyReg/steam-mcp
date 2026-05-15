import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WishlistDetailsResult } from '../../packages/steam-core/src/wishlist/index.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamWishlistDetailsTool } from '../../packages/steam-mcp/src/tools/steam-wishlist-details.js';

type ToolResult = { content?: Array<{ type: string; text?: string }> };
type RegisteredToolHandler = (rawArgs: unknown) => ToolResult | Promise<ToolResult>;

function parseFirstTextContent(result: ToolResult): unknown {
  const firstContent = result.content?.[0];
  assert.ok(firstContent);
  assert.equal(firstContent.type, 'text');
  assert.equal(typeof firstContent.text, 'string');
  return JSON.parse(firstContent.text ?? 'null');
}

function createHarness(options: { selectedUserId?: string; result?: WishlistDetailsResult; error?: Error }) {
  const calls = { details: [] as unknown[], registeredTools: [] as string[] };
  const context = {
    discoveryService: { discover: async () => ({ selectedUserId: options.selectedUserId, warnings: [], libraryFolders: [], userIds: [] }) },
    wishlistEnrichmentService: {
      listDetails: async (request: unknown) => {
        calls.details.push(request);
        if (options.error) throw options.error;
        return options.result ?? { totalCount: 0, missingDetailsCount: 0, items: [] };
      }
    }
  } as unknown as SteamMcpContext;
  let handler: RegisteredToolHandler | undefined;
  const server = { registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) { calls.registeredTools.push(name); handler = cb; } } as unknown as McpServer;
  registerSteamWishlistDetailsTool(server, context);
  if (!handler) throw new Error('steam_wishlist_details was not registered');
  const registeredHandler = handler;
  return { calls, invoke: (rawArgs: unknown) => registeredHandler(rawArgs) };
}

test('steam wishlist details registers and passes selected-user options', async () => {
  const harness = createHarness({
    selectedUserId: '12345',
    result: { totalCount: 1, missingDetailsCount: 0, items: [{ appId: 620, details: { appId: 620, name: 'Portal 2', developers: [], publishers: [], genres: [], categories: [], tags: [], storeUrl: 'https://store.steampowered.com/app/620/' }, deckStatus: 'verified' }] }
  });

  const result = await harness.invoke({ limit: 5, includeDeckStatus: true, priceFreshness: 'fresh' });

  assert.deepEqual(harness.calls.registeredTools, ['steam_wishlist_details']);
  assert.deepEqual(harness.calls.details, [{ steamId: '76561197960278073', limit: 5, includeDeckStatus: true, priceFreshness: 'fresh' }]);
  assert.deepEqual(parseFirstTextContent(result), { totalCount: 1, missingDetailsCount: 0, items: [{ appId: 620, details: { appId: 620, name: 'Portal 2', developers: [], publishers: [], genres: [], categories: [], tags: [], storeUrl: 'https://store.steampowered.com/app/620/' }, deckStatus: 'verified' }] });
});

test('steam wishlist details returns selected-user and upstream errors', async () => {
  const missingUser = createHarness({});
  assert.deepEqual(parseFirstTextContent(await missingUser.invoke({})), { error: 'No selected Steam user was found; steam_wishlist_details requires a discoverable selected user.' });

  const invalidUser = createHarness({ selectedUserId: 'invalid-user' });
  assert.deepEqual(parseFirstTextContent(await invalidUser.invoke({})), { error: 'The selected Steam user could not be resolved to a SteamID64; steam_wishlist_details requires a valid SteamID64.' });

  const upstream = createHarness({ selectedUserId: '76561198000000000', error: new Error('wishlist failed') });
  assert.deepEqual(parseFirstTextContent(await upstream.invoke({})), { error: 'wishlist failed' });
});
