import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  OfficialStoreItemsResult,
  OfficialStoreItemsToFeatureResult,
  SteamFeaturedScoutResult,
  WishlistListResult
} from '../../packages/steam-core/src/types.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamFeaturedScoutTool } from '../../packages/steam-mcp/src/tools/steam-featured-scout.js';

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

function createContext(options: {
  featuredResult?: OfficialStoreItemsToFeatureResult;
  itemsResult?: OfficialStoreItemsResult;
  featuredError?: Error;
  itemsError?: Error;
  selectedUserId?: string;
  wishlistResult?: WishlistListResult;
  wishlistError?: Error;
}) {
  const calls = {
    getItemsToFeature: [] as Array<unknown>,
    getItems: [] as Array<unknown>,
    getTopReleasesPages: 0,
    queryItems: [] as Array<unknown>,
    discover: 0,
    wishlistList: [] as Array<unknown>
  };

  const context = {
    officialStoreClient: {
      getItemsToFeature: async (request: unknown) => {
        calls.getItemsToFeature.push(request);
        if (options.featuredError) {
          throw options.featuredError;
        }

        return options.featuredResult ?? {
          spotlights: [],
          daily_deals: [],
          specials: [],
          purchase_recommendations: []
        };
      },
      getItems: async (request: unknown) => {
        calls.getItems.push(request);
        if (options.itemsError) {
          throw options.itemsError;
        }

        return options.itemsResult ?? { items: [] };
      },
      getTopReleasesPages: async () => {
        calls.getTopReleasesPages += 1;
        throw new Error('getTopReleasesPages should not be called');
      },
      queryItems: async (request: unknown) => {
        calls.queryItems.push(request);
        throw new Error('queryItems should not be called');
      }
    },
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
      if (name === 'steam_featured_scout') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamFeaturedScoutTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke(rawArgs: unknown) {
      assert.ok(handler);
      return handler(rawArgs);
    }
  };
}

test('steam featured scout uses GetItemsToFeature then GetItems, preserving marketing ordering and provenance', async () => {
  const harness = createContext({
    featuredResult: {
      spotlights: [620, 730],
      daily_deals: [440],
      specials: [500],
      purchase_recommendations: [620, 2051120]
    },
    itemsResult: {
      items: [
        {
          appId: 440,
          name: 'Team Fortress 2',
          type: 'game',
          releaseDate: '2007-10-10T00:00:00.000Z',
          comingSoon: false,
          freeToPlay: true,
          storeUrl: 'https://store.steampowered.com/app/440/'
        },
        {
          appId: 620,
          name: 'Portal 2',
          type: 'game',
          releaseDate: '2011-04-18T19:00:00.000Z',
          comingSoon: false,
          freeToPlay: false,
          storeUrl: 'https://store.steampowered.com/app/620/'
        },
        {
          appId: 730,
          name: 'Counter-Strike 2',
          type: 'game',
          releaseDate: '2012-08-21T00:00:00.000Z',
          comingSoon: false,
          freeToPlay: true,
          storeUrl: 'https://store.steampowered.com/app/730/'
        },
        {
          appId: 500,
          name: 'Toolbox',
          type: 'software',
          releaseDate: '2007-10-16T10:00:00.000Z',
          comingSoon: false,
          storeUrl: 'https://store.steampowered.com/app/500/'
        },
        {
          appId: 2051120,
          name: 'Split Fiction',
          type: 'game',
          releaseDate: '2025-03-06T00:00:00.000Z',
          comingSoon: false,
          storeUrl: 'https://store.steampowered.com/app/2051120/'
        }
      ]
    }
  });

  const result = await harness.invoke({
    limit: 4,
    types: ['game', 'software'],
    language: 'japanese',
    countryCode: 'JP'
  });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 620,
      name: 'Portal 2',
      type: 'game',
      releaseDate: '2011-04-18T19:00:00.000Z',
      comingSoon: false,
      freeToPlay: false,
      source: 'marketing',
      ordering: 'marketing',
      method: 'itemsToFeature',
      marketingBucket: 'spotlights',
      filtersApplied: ['types:game,software'],
      storeUrl: 'https://store.steampowered.com/app/620/'
    },
    {
      appId: 730,
      name: 'Counter-Strike 2',
      type: 'game',
      releaseDate: '2012-08-21T00:00:00.000Z',
      comingSoon: false,
      freeToPlay: true,
      source: 'marketing',
      ordering: 'marketing',
      method: 'itemsToFeature',
      marketingBucket: 'spotlights',
      filtersApplied: ['types:game,software'],
      storeUrl: 'https://store.steampowered.com/app/730/'
    },
    {
      appId: 440,
      name: 'Team Fortress 2',
      type: 'game',
      releaseDate: '2007-10-10T00:00:00.000Z',
      comingSoon: false,
      freeToPlay: true,
      source: 'marketing',
      ordering: 'marketing',
      method: 'itemsToFeature',
      marketingBucket: 'daily_deals',
      filtersApplied: ['types:game,software'],
      storeUrl: 'https://store.steampowered.com/app/440/'
    },
    {
      appId: 500,
      name: 'Toolbox',
      type: 'software',
      releaseDate: '2007-10-16T10:00:00.000Z',
      comingSoon: false,
      source: 'marketing',
      ordering: 'marketing',
      method: 'itemsToFeature',
      marketingBucket: 'specials',
      filtersApplied: ['types:game,software'],
      storeUrl: 'https://store.steampowered.com/app/500/'
    }
  ] satisfies SteamFeaturedScoutResult[]);
  assert.deepEqual(harness.calls.getItemsToFeature, [{ language: 'japanese', countryCode: 'JP' }]);
  assert.deepEqual(harness.calls.getItems, [{
    appIds: [620, 730, 440, 500, 2051120],
    language: 'japanese',
    countryCode: 'JP'
  }]);
  assert.equal(harness.calls.getTopReleasesPages, 0);
  assert.deepEqual(harness.calls.queryItems, []);
});

test('steam featured scout locally filters enriched items by type and trims to limit', async () => {
  const harness = createContext({
    featuredResult: {
      spotlights: [10, 11, 12],
      daily_deals: [13],
      specials: [],
      purchase_recommendations: []
    },
    itemsResult: {
      items: [
        { appId: 10, name: 'Game One', type: 'game', comingSoon: false, storeUrl: 'https://store.steampowered.com/app/10/' },
        { appId: 11, name: 'DLC One', type: 'dlc', comingSoon: false, storeUrl: 'https://store.steampowered.com/app/11/' },
        { appId: 12, name: 'Game Two', type: 'game', comingSoon: true, storeUrl: 'https://store.steampowered.com/app/12/' },
        { appId: 13, name: 'Software One', type: 'software', comingSoon: false, storeUrl: 'https://store.steampowered.com/app/13/' }
      ]
    }
  });

  const result = await harness.invoke({ limit: 2, types: ['game'] });
  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 10,
      name: 'Game One',
      type: 'game',
      comingSoon: false,
      source: 'marketing',
      ordering: 'marketing',
      method: 'itemsToFeature',
      marketingBucket: 'spotlights',
      filtersApplied: ['types:game'],
      storeUrl: 'https://store.steampowered.com/app/10/'
    },
    {
      appId: 12,
      name: 'Game Two',
      type: 'game',
      comingSoon: true,
      source: 'marketing',
      ordering: 'marketing',
      method: 'itemsToFeature',
      marketingBucket: 'spotlights',
      filtersApplied: ['types:game'],
      storeUrl: 'https://store.steampowered.com/app/12/'
    }
  ]);
  assert.deepEqual(harness.calls.getItems, [{ appIds: [10, 11, 12, 13] }]);
});

test('steam featured scout returns explicit API-key failures from official marketing access', async () => {
  const harness = createContext({
    featuredError: new Error('Steam Web API key is required for official store marketing access. Set STEAM_API_KEY.')
  });

  const result = await harness.invoke({});
  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official store marketing access. Set STEAM_API_KEY.'
  });
  assert.deepEqual(harness.calls.getItems, []);
});

test('steam featured scout annotates matching wishlist items only when requested', async () => {
  const harness = createContext({
    selectedUserId: '12345',
    featuredResult: {
      spotlights: [620, 730],
      daily_deals: [],
      specials: [],
      purchase_recommendations: []
    },
    itemsResult: {
      items: [
        { appId: 620, name: 'Portal 2', type: 'game', comingSoon: false, storeUrl: 'https://store.steampowered.com/app/620/' },
        { appId: 730, name: 'Counter-Strike 2', type: 'game', comingSoon: false, storeUrl: 'https://store.steampowered.com/app/730/' }
      ]
    },
    wishlistResult: {
      totalCount: 1,
      items: [{ appId: 730, dateAdded: 1710000000 }]
    }
  });

  const result = await harness.invoke({ limit: 2, types: ['game'], includeWishlist: true });

  assert.deepEqual(parseFirstTextContent(result), [
    {
      appId: 620,
      name: 'Portal 2',
      type: 'game',
      comingSoon: false,
      source: 'marketing',
      ordering: 'marketing',
      method: 'itemsToFeature',
      marketingBucket: 'spotlights',
      filtersApplied: ['types:game'],
      storeUrl: 'https://store.steampowered.com/app/620/'
    },
    {
      appId: 730,
      name: 'Counter-Strike 2',
      type: 'game',
      comingSoon: false,
      source: 'marketing',
      ordering: 'marketing',
      method: 'itemsToFeature',
      marketingBucket: 'spotlights',
      filtersApplied: ['types:game'],
      storeUrl: 'https://store.steampowered.com/app/730/',
      wishlist: { listed: true, dateAdded: 1710000000 }
    }
  ]);
  assert.equal(harness.calls.discover, 1);
  assert.deepEqual(harness.calls.wishlistList, [{ steamId: '76561197960278073' }]);
});

test('steam featured scout does not resolve wishlist when includeWishlist is omitted', async () => {
  const harness = createContext({
    featuredResult: { spotlights: [620], daily_deals: [], specials: [], purchase_recommendations: [] },
    itemsResult: { items: [{ appId: 620, name: 'Portal 2', type: 'game', comingSoon: false, storeUrl: 'https://store.steampowered.com/app/620/' }] }
  });

  await harness.invoke({ limit: 1, types: ['game'] });

  assert.equal(harness.calls.discover, 0);
  assert.deepEqual(harness.calls.wishlistList, []);
});

test('steam featured scout returns explicit wishlist lookup errors', async () => {
  const harness = createContext({
    selectedUserId: '76561198000000000',
    wishlistError: new Error('Official wishlist request failed with status 503.')
  });

  const result = await harness.invoke({ includeWishlist: true });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Official wishlist request failed with status 503.'
  });
  assert.deepEqual(harness.calls.getItemsToFeature, []);
});
