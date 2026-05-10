import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoreAppDetails, StoreSearchCandidate } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import {
  enrichStoreCandidatesWithCacheableDetails,
  mergeSimilarStoreCandidateWithCacheableDetails,
  mergeStoreSearchCandidateWithCacheableDetails
} from '../../packages/steam-mcp/src/tools/store-cacheable-details-batch.js';

function createStoreClient(detailsById: Map<number, StoreAppDetails | undefined>) {
  const calls: number[] = [];
  const storeClient = {
    getCacheableAppDetails: async (appId: number) => {
      calls.push(appId);
      return detailsById.get(appId);
    }
  } as SteamMcpContext['storeClient'];

  return { calls, storeClient };
}

test('store cacheable details helper enriches store-search candidates and preserves order', async () => {
  const { calls, storeClient } = createStoreClient(new Map<number, StoreAppDetails | undefined>([
    [620, {
      appId: 620,
      name: 'Portal 2',
      type: 'game',
      releaseDate: 'Apr 18, 2011',
      comingSoon: false,
      developers: ['Valve'],
      publishers: ['Valve'],
      genres: ['Puzzle', 'Action'],
      categories: ['Single-player', 'Co-op'],
      tags: ['Co-op', 'First-Person'],
      shortDescription: 'A mind-bending co-op puzzle game.',
      headerImage: 'https://cdn.example/portal2.jpg',
      storeUrl: 'https://store.steampowered.com/app/620/'
    }],
    [257510, undefined]
  ]));
  const candidates: StoreSearchCandidate[] = [
    {
      appId: 620,
      name: 'Portal 2',
      genres: ['Puzzle'],
      tags: ['Co-op'],
      storeUrl: 'https://store.steampowered.com/app/620/'
    },
    {
      appId: 257510,
      name: 'The Talos Principle',
      storeUrl: 'https://store.steampowered.com/app/257510/'
    }
  ];

  const enriched = await enrichStoreCandidatesWithCacheableDetails(
    storeClient,
    candidates,
    mergeStoreSearchCandidateWithCacheableDetails
  );

  assert.deepEqual(calls, [620, 257510]);
  assert.deepEqual(enriched, [
    {
      appId: 620,
      name: 'Portal 2',
      type: 'game',
      releaseDate: 'Apr 18, 2011',
      comingSoon: false,
      developers: ['Valve'],
      publishers: ['Valve'],
      genres: ['Puzzle', 'Action'],
      categories: ['Single-player', 'Co-op'],
      tags: ['Co-op', 'First-Person'],
      shortDescription: 'A mind-bending co-op puzzle game.',
      headerImage: 'https://cdn.example/portal2.jpg',
      storeUrl: 'https://store.steampowered.com/app/620/'
    },
    {
      appId: 257510,
      name: 'The Talos Principle',
      storeUrl: 'https://store.steampowered.com/app/257510/'
    }
  ]);
});

test('store cacheable details helper leaves candidates unchanged when strict details are unavailable', async () => {
  const originalCandidate: StoreSearchCandidate = {
    appId: 257510,
    name: 'The Talos Principle',
    developers: ['Original Dev'],
    genres: ['Adventure'],
    storeUrl: 'https://store.steampowered.com/app/257510/'
  };
  const { calls, storeClient } = createStoreClient(new Map<number, StoreAppDetails | undefined>([[257510, undefined]]));

  const enriched = await enrichStoreCandidatesWithCacheableDetails(
    storeClient,
    [originalCandidate],
    mergeStoreSearchCandidateWithCacheableDetails
  );

  assert.deepEqual(calls, [257510]);
  assert.deepEqual(enriched, [originalCandidate]);
});

test('similar merge keeps similarity-focused fields only', () => {
  const candidate: StoreSearchCandidate = {
    appId: 3,
    name: 'The Talos Principle',
    storeUrl: 'https://store.steampowered.com/app/257510/'
  };
  const details: StoreAppDetails = {
    appId: 3,
    name: 'The Talos Principle',
    type: 'game',
    releaseDate: 'Dec 11, 2014',
    comingSoon: false,
    developers: ['Croteam'],
    publishers: ['Devolver Digital'],
    genres: ['Puzzle'],
    categories: ['Single-player'],
    tags: ['Puzzle', 'Philosophical'],
    shortDescription: 'Think through a philosophical puzzle world.',
    headerImage: 'https://cdn.example/talos.jpg',
    storeUrl: 'https://store.steampowered.com/app/257510/'
  };

  assert.deepEqual(mergeSimilarStoreCandidateWithCacheableDetails(candidate, details), {
    appId: 3,
    name: 'The Talos Principle',
    developers: ['Croteam'],
    publishers: ['Devolver Digital'],
    genres: ['Puzzle'],
    tags: ['Puzzle', 'Philosophical'],
    headerImage: 'https://cdn.example/talos.jpg',
    storeUrl: 'https://store.steampowered.com/app/257510/'
  });
});
