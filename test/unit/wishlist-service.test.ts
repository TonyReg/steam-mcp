import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfficialStoreClient } from '../../packages/steam-core/src/official-store/index.js';
import type { StoreAppDetails } from '../../packages/steam-core/src/types.js';
import { createWishlistAnnotationMap, WishlistSaleService, WishlistService } from '../../packages/steam-core/src/wishlist/index.js';

test('wishlist service combines official count and wishlist item reads', async () => {
  const calls: unknown[] = [];
  const officialStoreClient = {
    getWishlistItemCount: async (request: unknown) => {
      calls.push(['count', request]);
      return { count: 5 };
    },
    getWishlist: async (request: unknown) => {
      calls.push(['list', request]);
      return {
        items: [
          { appId: 620, priority: 1, dateAdded: 1714000000 },
          { appId: 730 }
        ]
      };
    }
  } as Pick<OfficialStoreClient, 'getWishlistItemCount' | 'getWishlist'>;
  const service = new WishlistService(officialStoreClient as OfficialStoreClient);

  const result = await service.list({ steamId: '76561198000000000' });

  assert.deepEqual(result, {
    totalCount: 5,
    items: [
      { appId: 620, priority: 1, dateAdded: 1714000000 },
      { appId: 730 }
    ]
  });
  assert.deepEqual(calls, [
    ['count', { steamId: '76561198000000000' }],
    ['list', { steamId: '76561198000000000' }]
  ]);
});

test('wishlist annotation map preserves optional priority and dateAdded only when present', () => {
  const annotations = createWishlistAnnotationMap([
    { appId: 620, priority: 1, dateAdded: 1714000000 },
    { appId: 730 }
  ]);

  assert.deepEqual(annotations.get(620), {
    listed: true,
    priority: 1,
    dateAdded: 1714000000
  });
  assert.deepEqual(annotations.get(730), {
    listed: true
  });
  assert.equal(annotations.has(440), false);
});

test('wishlist sale service derives discounted wishlist items from fresh store details and preserves full counts beyond limit', async () => {
  const calls = {
    wishlistList: [] as Array<unknown>,
    appDetails: [] as number[]
  };
  const wishlistService = {
    list: async (request: unknown) => {
      calls.wishlistList.push(request);
      return {
        totalCount: 7,
        items: [
          { appId: 10, priority: 1, dateAdded: 1710000000 },
          { appId: 20, priority: 2 },
          { appId: 30, dateAdded: 1710000300 },
          { appId: 40 },
          { appId: 50 },
          { appId: 60, priority: 6 },
          { appId: 70, priority: 7 }
        ]
      };
    }
  };
  const detailsByAppId = new Map<number, StoreAppDetails>([
    [10, createStoreDetails(10, 'Ten', { initialInCents: 2000, finalInCents: 500, discountPercent: 75 })],
    [20, createStoreDetails(20, 'Twenty', { initialInCents: 2000, finalInCents: 2000, discountPercent: 0 })],
    [30, createStoreDetails(30, 'Thirty')],
    [40, createStoreDetails(40, 'Forty', { initialInCents: 1000, finalInCents: 1000, discountPercent: 50 })],
    [60, createStoreDetails(60, 'Sixty', { initialInCents: 5000, finalInCents: 2500, discountPercent: 50 })],
    [70, createStoreDetails(70, 'Seventy', { initialInCents: 4000, finalInCents: 1000, discountPercent: 75 })]
  ]);
  const storeClient = {
    getFreshAppDetails: async (appId: number) => {
      calls.appDetails.push(appId);
      return detailsByAppId.get(appId);
    }
  };
  const service = new WishlistSaleService(wishlistService, storeClient);

  const result = await service.listOnSale({ steamId: '76561198000000000', limit: 2 });

  assert.deepEqual(result, {
    totalCount: 7,
    onSaleCount: 3,
    unknownPriceCount: 2,
    items: [
      {
        appId: 10,
        name: 'Ten',
        type: 'game',
        storeUrl: 'https://store.steampowered.com/app/10/',
        priority: 1,
        dateAdded: 1710000000,
        price: { initialInCents: 2000, finalInCents: 500, discountPercent: 75 }
      },
      {
        appId: 60,
        name: 'Sixty',
        type: 'game',
        storeUrl: 'https://store.steampowered.com/app/60/',
        priority: 6,
        price: { initialInCents: 5000, finalInCents: 2500, discountPercent: 50 }
      }
    ]
  });
  assert.deepEqual(calls.wishlistList, [{ steamId: '76561198000000000' }]);
  assert.deepEqual(calls.appDetails, [10, 20, 30, 40, 50, 60, 70]);
});

test('wishlist sale service propagates wishlist lookup failures', async () => {
  const expectedError = new Error('Official wishlist request failed with status 503.');
  const service = new WishlistSaleService({
    list: async () => {
      throw expectedError;
    }
  }, {
    getFreshAppDetails: async () => createStoreDetails(10, 'Ten', { initialInCents: 2000, finalInCents: 500, discountPercent: 75 })
  });

  await assert.rejects(service.listOnSale({ steamId: '76561198000000000' }), expectedError);
});

function createStoreDetails(
  appId: number,
  name: string,
  priceOverview?: StoreAppDetails['priceOverview']
): StoreAppDetails {
  return {
    appId,
    name,
    type: 'game',
    developers: [],
    publishers: [],
    genres: [],
    categories: [],
    tags: [],
    storeUrl: `https://store.steampowered.com/app/${appId}/`,
    ...(priceOverview === undefined ? {} : { priceOverview })
  };
}
