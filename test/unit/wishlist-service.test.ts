import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfficialStoreClient } from '../../packages/steam-core/src/official-store/index.js';
import { createWishlistAnnotationMap, WishlistService } from '../../packages/steam-core/src/wishlist/index.js';

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
