import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WishlistDiscountSummaryResult } from '../../packages/steam-core/src/wishlist/index.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamWishlistDiscountSummaryTool } from '../../packages/steam-mcp/src/tools/steam-wishlist-discount-summary.js';

type ToolResult = { content?: Array<{ type: string; text?: string }> };
type RegisteredToolHandler = (rawArgs: unknown) => ToolResult | Promise<ToolResult>;

function parseFirstTextContent(result: ToolResult): unknown {
  const firstContent = result.content?.[0];
  assert.ok(firstContent);
  return JSON.parse(firstContent.text ?? 'null');
}

function createHarness(options: { selectedUserId?: string; result?: WishlistDiscountSummaryResult; error?: Error }) {
  const calls = { summary: [] as unknown[], registeredTools: [] as string[] };
  const context = {
    discoveryService: { discover: async () => ({ selectedUserId: options.selectedUserId, warnings: [], libraryFolders: [], userIds: [] }) },
    wishlistEnrichmentService: {
      summarizeDiscounts: async (request: unknown) => {
        calls.summary.push(request);
        if (options.error) throw options.error;
        return options.result ?? { totalCount: 0, pricedCount: 0, discountedCount: 0, unknownPriceCount: 0, items: [], currencies: [], metadata: { priceSource: 'live-public-appdetails', countsIgnoreLimit: true } };
      }
    }
  } as unknown as SteamMcpContext;
  let handler: RegisteredToolHandler | undefined;
  const server = { registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) { calls.registeredTools.push(name); handler = cb; } } as unknown as McpServer;
  registerSteamWishlistDiscountSummaryTool(server, context);
  if (!handler) throw new Error('steam_wishlist_discount_summary was not registered');
  const registeredHandler = handler;
  return { calls, invoke: (rawArgs: unknown) => registeredHandler(rawArgs) };
}

test('steam wishlist discount summary registers and passes summary options', async () => {
  const harness = createHarness({ selectedUserId: '12345' });

  const result = await harness.invoke({ limit: 2, minimumDiscountPercent: 50 });

  assert.deepEqual(harness.calls.registeredTools, ['steam_wishlist_discount_summary']);
  assert.deepEqual(harness.calls.summary, [{ steamId: '76561197960278073', limit: 2, minimumDiscountPercent: 50 }]);
  assert.deepEqual(parseFirstTextContent(result), { totalCount: 0, pricedCount: 0, discountedCount: 0, unknownPriceCount: 0, items: [], currencies: [], metadata: { priceSource: 'live-public-appdetails', countsIgnoreLimit: true } });
});

test('steam wishlist discount summary returns selected-user and upstream errors', async () => {
  assert.deepEqual(parseFirstTextContent(await createHarness({}).invoke({})), { error: 'No selected Steam user was found; steam_wishlist_discount_summary requires a discoverable selected user.' });
  assert.deepEqual(parseFirstTextContent(await createHarness({ selectedUserId: 'bad' }).invoke({})), { error: 'The selected Steam user could not be resolved to a SteamID64; steam_wishlist_discount_summary requires a valid SteamID64.' });
  assert.deepEqual(parseFirstTextContent(await createHarness({ selectedUserId: '76561198000000000', error: new Error('summary failed') }).invoke({})), { error: 'summary failed' });
});
