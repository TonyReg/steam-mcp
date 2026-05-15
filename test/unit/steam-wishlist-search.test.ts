import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GameRecord, SearchMatch } from '@steam-mcp/steam-core';
import type { WishlistDetailsResult } from '../../packages/steam-core/src/wishlist/index.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamWishlistSearchTool } from '../../packages/steam-mcp/src/tools/steam-wishlist-search.js';

type ToolResult = { content?: Array<{ type: string; text?: string }> };
type RegisteredToolHandler = (rawArgs: unknown) => ToolResult | Promise<ToolResult>;

function parseFirstTextContent(result: ToolResult): unknown {
  const firstContent = result.content?.[0];
  assert.ok(firstContent);
  return JSON.parse(firstContent.text ?? 'null');
}

function createHarness(options: { selectedUserId?: string; details?: WishlistDetailsResult; matches?: SearchMatch<GameRecord>[]; error?: Error }) {
  const calls = { details: [] as unknown[], search: [] as Array<{ games: GameRecord[]; request: unknown }> };
  const context = {
    discoveryService: { discover: async () => ({ selectedUserId: options.selectedUserId, warnings: [], libraryFolders: [], userIds: [] }) },
    wishlistEnrichmentService: {
      listDetails: async (request: unknown) => {
        calls.details.push(request);
        if (options.error) throw options.error;
        return options.details ?? { totalCount: 0, missingDetailsCount: 0, items: [] };
      }
    },
    searchService: {
      searchLibrary: (games: GameRecord[], request: unknown) => {
        calls.search.push({ games, request });
        return options.matches ?? [];
      }
    }
  } as unknown as SteamMcpContext;
  let handler: RegisteredToolHandler | undefined;
  const server = { registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) { if (name === 'steam_wishlist_search') handler = cb; } } as unknown as McpServer;
  registerSteamWishlistSearchTool(server, context);
  if (!handler) throw new Error('steam_wishlist_search was not registered');
  const registeredHandler = handler;
  return { calls, invoke: (rawArgs: unknown) => registeredHandler(rawArgs) };
}

test('steam wishlist search uses wishlist details and deterministic search results', async () => {
  const details: WishlistDetailsResult = {
    totalCount: 2,
    missingDetailsCount: 1,
    items: [
      { appId: 620, priority: 1, details: { appId: 620, name: 'Portal 2', developers: ['Valve'], publishers: ['Valve'], genres: ['Puzzle'], categories: ['Co-op'], tags: ['Puzzle'], storeUrl: 'https://store.steampowered.com/app/620/' }, deckStatus: 'verified' },
      { appId: 730 }
    ]
  };
  const harness = createHarness({ selectedUserId: '76561198000000000', details, matches: [{ item: { appId: 620, name: 'Portal 2' }, score: 60, reasons: ['name contains query'] }] });

  const result = await harness.invoke({ query: 'portal', limit: 3, deckStatuses: ['verified'] });

  assert.deepEqual(harness.calls.details, [{ steamId: '76561198000000000', includeDeckStatus: true }]);
  assert.deepEqual(harness.calls.search[0]?.request, { query: 'portal', limit: 3, deckStatuses: ['verified'] });
  assert.deepEqual(parseFirstTextContent(result), [{ item: details.items[0], score: 60, reasons: ['name contains query'] }]);
});

test('steam wishlist search returns selected-user and upstream errors', async () => {
  assert.deepEqual(parseFirstTextContent(await createHarness({}).invoke({ query: 'portal' })), { error: 'No selected Steam user was found; steam_wishlist_search requires a discoverable selected user.' });
  assert.deepEqual(parseFirstTextContent(await createHarness({ selectedUserId: 'bad' }).invoke({ query: 'portal' })), { error: 'The selected Steam user could not be resolved to a SteamID64; steam_wishlist_search requires a valid SteamID64.' });
  assert.deepEqual(parseFirstTextContent(await createHarness({ selectedUserId: '76561198000000000', error: new Error('details failed') }).invoke({ query: 'portal' })), { error: 'details failed' });
});
