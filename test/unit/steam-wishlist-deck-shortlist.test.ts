import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GameRecord, SearchMatch, StoreSearchCandidate } from '@steam-mcp/steam-core';
import type { WishlistDetailsResult } from '../../packages/steam-core/src/wishlist/index.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamWishlistDeckShortlistTool } from '../../packages/steam-mcp/src/tools/steam-wishlist-deck-shortlist.js';

type ToolResult = { content?: Array<{ type: string; text?: string }> };
type RegisteredToolHandler = (rawArgs: unknown) => ToolResult | Promise<ToolResult>;

function parseFirstTextContent(result: ToolResult): unknown {
  const firstContent = result.content?.[0];
  assert.ok(firstContent);
  return JSON.parse(firstContent.text ?? 'null');
}

function createDetails(): WishlistDetailsResult {
  return {
    totalCount: 3,
    missingDetailsCount: 0,
    items: [
      { appId: 10, details: storeDetails(10, 'Verified Puzzle'), deckStatus: 'verified' },
      { appId: 20, details: storeDetails(20, 'Playable Co-op'), deckStatus: 'playable' },
      { appId: 30, details: storeDetails(30, 'Unsupported Horror'), deckStatus: 'unsupported' }
    ]
  };
}

function createHarness(options: { selectedUserId?: string; details?: WishlistDetailsResult; searchMatches?: SearchMatch<GameRecord>[]; storeMatches?: SearchMatch<StoreSearchCandidate>[]; error?: Error }) {
  const calls = { details: [] as unknown[], search: [] as unknown[], library: [] as unknown[], rankStore: [] as Array<{ seedAppIds: number[]; candidateAppIds: number[] }> };
  const context = {
    discoveryService: { discover: async () => ({ selectedUserId: options.selectedUserId, warnings: [], libraryFolders: [], userIds: [] }) },
    wishlistEnrichmentService: { listDetails: async (request: unknown) => { calls.details.push(request); if (options.error) throw options.error; return options.details ?? createDetails(); } },
    searchService: { searchLibrary: (_games: GameRecord[], request: unknown) => { calls.search.push(request); return options.searchMatches ?? []; } },
    libraryService: { list: async (request: unknown) => { calls.library.push(request); return { games: [{ appId: 620, name: 'Portal 2', genres: ['Puzzle'], tags: ['Co-op'] }], warnings: [], summary: { total: 1, returned: 1, installed: 0, favorites: 0, hidden: 0 } }; } },
    recommendService: { rankSimilarStoreCandidates: (seedGames: GameRecord[], candidates: StoreSearchCandidate[]) => { calls.rankStore.push({ seedAppIds: seedGames.map((game) => game.appId), candidateAppIds: candidates.map((candidate) => candidate.appId) }); return options.storeMatches ?? []; } }
  } as unknown as SteamMcpContext;
  let handler: RegisteredToolHandler | undefined;
  const server = { registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) { if (name === 'steam_wishlist_deck_shortlist') handler = cb; } } as unknown as McpServer;
  registerSteamWishlistDeckShortlistTool(server, context);
  if (!handler) throw new Error('steam_wishlist_deck_shortlist was not registered');
  const registeredHandler = handler;
  return { calls, invoke: (rawArgs: unknown) => registeredHandler(rawArgs) };
}

test('steam wishlist deck shortlist defaults to verified/playable and preserves wishlist order', async () => {
  const harness = createHarness({ selectedUserId: '76561198000000000' });

  const payload = parseFirstTextContent(await harness.invoke({})) as { matchedCount: number; items: Array<{ appId: number }> };

  assert.deepEqual(harness.calls.details, [{ steamId: '76561198000000000', includeDeckStatus: true }]);
  assert.equal(payload.matchedCount, 2);
  assert.deepEqual(payload.items.map((item) => item.appId), [10, 20]);
});

test('steam wishlist deck shortlist uses search for query and recommend for seeds', async () => {
  const details = createDetails();
  const queryHarness = createHarness({ selectedUserId: '76561198000000000', details, searchMatches: [{ item: { appId: 20, name: 'Playable Co-op' }, score: 80, reasons: ['prefix name match'] }] });
  assert.deepEqual(parseFirstTextContent(await queryHarness.invoke({ query: 'play', deckStatuses: ['playable'] })), { totalCount: 3, matchedCount: 1, items: [{ ...details.items[1], score: 80, reasons: ['prefix name match'] }] });
  assert.deepEqual(queryHarness.calls.search, [{ query: 'play', deckStatuses: ['playable'], limit: 20 }]);

  const seedHarness = createHarness({ selectedUserId: '76561198000000000', details, storeMatches: [{ item: { appId: 10, name: 'Verified Puzzle', storeUrl: 'https://store.steampowered.com/app/10/' }, score: 10, reasons: ['genre overlap: Puzzle'] }] });
  assert.deepEqual(parseFirstTextContent(await seedHarness.invoke({ seedAppIds: [620], limit: 1 })), { totalCount: 3, matchedCount: 1, items: [{ ...details.items[0], score: 10, reasons: ['genre overlap: Puzzle'] }] });
  assert.deepEqual(seedHarness.calls.library, [{ includeStoreMetadata: true, includeDeckStatus: true, limit: 5000 }]);
  assert.deepEqual(seedHarness.calls.rankStore, [{ seedAppIds: [620], candidateAppIds: [10, 20] }]);

  const precedenceHarness = createHarness({ selectedUserId: '76561198000000000', details, searchMatches: [{ item: { appId: 20, name: 'Playable Co-op' }, score: 80, reasons: ['prefix name match'] }], storeMatches: [{ item: { appId: 10, name: 'Verified Puzzle', storeUrl: 'https://store.steampowered.com/app/10/' }, score: 10, reasons: ['genre overlap: Puzzle'] }] });
  assert.deepEqual(parseFirstTextContent(await precedenceHarness.invoke({ query: 'play', seedAppIds: [620] })), { totalCount: 3, matchedCount: 1, items: [{ ...details.items[1], score: 80, reasons: ['prefix name match'] }] });
  assert.deepEqual(precedenceHarness.calls.search, [{ query: 'play', deckStatuses: ['verified', 'playable'], limit: 20 }]);
  assert.deepEqual(precedenceHarness.calls.library, []);
  assert.deepEqual(precedenceHarness.calls.rankStore, []);
});

test('steam wishlist deck shortlist returns selected-user and upstream errors', async () => {
  assert.deepEqual(parseFirstTextContent(await createHarness({}).invoke({})), { error: 'No selected Steam user was found; steam_wishlist_deck_shortlist requires a discoverable selected user.' });
  assert.deepEqual(parseFirstTextContent(await createHarness({ selectedUserId: 'bad' }).invoke({})), { error: 'The selected Steam user could not be resolved to a SteamID64; steam_wishlist_deck_shortlist requires a valid SteamID64.' });
  assert.deepEqual(parseFirstTextContent(await createHarness({ selectedUserId: '76561198000000000', error: new Error('deck failed') }).invoke({})), { error: 'deck failed' });
});

function storeDetails(appId: number, name: string) {
  return { appId, name, developers: ['Valve'], publishers: ['Valve'], genres: ['Puzzle'], categories: ['Co-op'], tags: ['Puzzle'], storeUrl: `https://store.steampowered.com/app/${appId}/` };
}
