import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DeckStatusProvider } from '../../packages/steam-core/src/deck/index.js';
import { StoreClient } from '../../packages/steam-core/src/store/index.js';

test('store client and deck provider normalize fixture payloads', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const storeSearchPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'storesearch-portal.json'), 'utf8');
  const appDetailsPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  const deckPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'deck-620.json'), 'utf8');

  const deckProvider = new DeckStatusProvider(async () => new Response(deckPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response);
  const storeClient = new StoreClient(async (input) => {
    const url = String(input);
    if (url.includes('appdetails')) {
      return new Response(appDetailsPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }

    return new Response(storeSearchPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, deckProvider);

  const results = await storeClient.search({ query: 'portal', deckStatuses: ['verified'] });
  assert.equal(results.length, 1);
  assert.equal(results[0].deckStatus, 'verified');

  const details = await storeClient.getAppDetails(620);
  assert.ok(details);
  assert.equal(details.name, 'Portal 2');
  assert.deepEqual(details.genres, ['Adventure', 'Puzzle']);
  assert.equal(details.type, 'game');
  assert.equal(details.releaseDate, 'Apr 18, 2011');
  assert.equal(details.comingSoon, false);
});

test('store client normalizes sparse appdetails payloads', async () => {
  const storeClient = new StoreClient(async () => new Response(JSON.stringify({
    '620': {
      success: true,
      data: {
        steam_appid: 620,
        name: 'Portal 2'
      }
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response);

  const details = await storeClient.getAppDetails(620);
  assert.ok(details);
  assert.equal(details.name, 'Portal 2');
  assert.deepEqual(details.developers, []);
  assert.deepEqual(details.publishers, []);
  assert.deepEqual(details.tags, []);
  assert.equal(details.type, undefined);
  assert.equal(details.releaseDate, undefined);
  assert.equal(details.comingSoon, undefined);
  assert.equal(details.priceOverview, undefined);
  assert.equal(details.storeUrl, 'https://store.steampowered.com/app/620/');
});

test('store client normalizes discounted appdetails price overview', async () => {
  const storeClient = new StoreClient(async () => new Response(JSON.stringify({
    '620': {
      success: true,
      data: {
        steam_appid: 620,
        name: 'Portal 2',
        price_overview: {
          currency: 'USD',
          initial: 1999,
          final: 499,
          discount_percent: 75,
          initial_formatted: '$19.99',
          final_formatted: '$4.99'
        }
      }
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response);

  const details = await storeClient.getAppDetails(620);

  assert.ok(details);
  assert.deepEqual(details.priceOverview, {
    currency: 'USD',
    initialInCents: 1999,
    finalInCents: 499,
    discountPercent: 75,
    initialFormatted: '$19.99',
    finalFormatted: '$4.99'
  });
});

test('store client ignores incomplete appdetails price overview', async () => {
  const storeClient = new StoreClient(async () => new Response(JSON.stringify({
    '620': {
      success: true,
      data: {
        steam_appid: 620,
        name: 'Portal 2',
        price_overview: {
          currency: 'USD',
          initial: 1999,
          discount_percent: 75
        }
      }
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response);

  const details = await storeClient.getAppDetails(620);

  assert.ok(details);
  assert.equal(details.priceOverview, undefined);
});

test('store client persists and rehydrates appdetails price overview', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'steam-mcp-store-cache-price-'));
  const payload = JSON.stringify({
    '620': {
      success: true,
      data: {
        steam_appid: 620,
        name: 'Portal 2',
        price_overview: {
          currency: 'USD',
          initial: 1999,
          final: 499,
          discount_percent: 75,
          initial_formatted: '$19.99',
          final_formatted: '$4.99'
        }
      }
    }
  });
  let requestCount = 0;

  const firstClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const first = await firstClient.getCacheableAppDetails(620);
  assert.ok(first);
  assert.deepEqual(first.priceOverview, {
    currency: 'USD',
    initialInCents: 1999,
    finalInCents: 499,
    discountPercent: 75,
    initialFormatted: '$19.99',
    finalFormatted: '$4.99'
  });

  const secondClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-02T00:00:00.000Z') });

  const second = await secondClient.getCacheableAppDetails(620);
  assert.ok(second);
  assert.deepEqual(second.priceOverview, first.priceOverview);
  assert.equal(requestCount, 1);
});

test('store client persists appdetails cache to disk and reuses it across instances', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const appDetailsPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'steam-mcp-store-cache-persist-'));
  let requestCount = 0;

  const firstClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(appDetailsPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const first = await firstClient.getAppDetails(620);
  assert.ok(first);
  assert.equal(first.name, 'Portal 2');
  assert.equal(requestCount, 1);

  const secondClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-02T00:00:00.000Z') });

  const second = await secondClient.getAppDetails(620);
  assert.ok(second);
  assert.equal(second.name, 'Portal 2');
  assert.equal(requestCount, 1);
});

test('store client returns sparse appdetails live without persisting them', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'steam-mcp-store-cache-sparse-live-'));
  let requestCount = 0;
  const sparsePayload = JSON.stringify({
    '620': {
      success: true,
      data: {
        steam_appid: 620,
        name: 'Portal 2'
      }
    }
  });

  const firstClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(sparsePayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const first = await firstClient.getAppDetails(620);
  const second = await firstClient.getAppDetails(620);

  assert.ok(first);
  assert.equal(first.name, 'Portal 2');
  assert.ok(second);
  assert.equal(second.name, 'Portal 2');
  assert.equal(requestCount, 2);

  const secondClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-02T00:00:00.000Z') });

  const third = await secondClient.getAppDetails(620);
  assert.equal(third, undefined);
  assert.equal(requestCount, 3);
});

test('store client strict cacheable appdetails rejects sparse fallback but returns rich details', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const richPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  const sparsePayload = JSON.stringify({
    '620': {
      success: true,
      data: {
        steam_appid: 620,
        name: 'Portal 2'
      }
    }
  });

  let requestCount = 0;
  const sparseClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(sparsePayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  });

  assert.equal(await sparseClient.getCacheableAppDetails(620), undefined);
  assert.equal(requestCount, 1);

  const richClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(richPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir: await mkdtemp(path.join(tmpdir(), 'steam-mcp-store-cache-strict-')), now: () => new Date('2026-01-01T00:00:00.000Z') });

  const richDetails = await richClient.getCacheableAppDetails(620);
  assert.ok(richDetails);
  assert.equal(richDetails.name, 'Portal 2');
  assert.deepEqual(richDetails.genres, ['Adventure', 'Puzzle']);
  assert.equal(richDetails.type, 'game');
  assert.equal(requestCount, 2);
});

 test('store client ignores sparse persisted cache entries and refreshes them from richer metadata', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const appDetailsPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'steam-mcp-store-cache-sparse-persisted-'));
  await writeFile(path.join(cacheDir, '620.json'), `${JSON.stringify({
    updatedAt: '2026-01-01T00:00:00.000Z',
    details: {
      appId: 620,
      name: 'Portal 2',
      developers: [],
      publishers: [],
      genres: [],
      categories: [],
      tags: [],
      storeUrl: 'https://store.steampowered.com/app/620/'
    }
  }, null, 2)}\n`, 'utf8');

  let requestCount = 0;
  const storeClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(appDetailsPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-02T00:00:00.000Z') });

  const details = await storeClient.getAppDetails(620);
  assert.ok(details);
  assert.equal(details.name, 'Portal 2');
  assert.deepEqual(details.genres, ['Adventure', 'Puzzle']);
  assert.equal(requestCount, 1);

  const reloadedClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-03T00:00:00.000Z') });

  const cached = await reloadedClient.getAppDetails(620);
  assert.ok(cached);
  assert.equal(cached.name, 'Portal 2');
  assert.deepEqual(cached.genres, ['Adventure', 'Puzzle']);
  assert.equal(requestCount, 1);
});

test('store client refreshes stale cached appdetails after ttl and falls back to stale data on refresh failure', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const appDetailsPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  const refreshedPayload = JSON.stringify({
    '620': {
      success: true,
      data: {
        name: 'Portal 2 (Refreshed)',
        developers: ['Valve'],
        publishers: ['Valve'],
        genres: [{ id: '23', description: 'Adventure' }],
        categories: [{ id: 2, description: 'Single-player' }],
        tags: ['Co-op']
      }
    }
  });
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'steam-mcp-store-cache-ttl-'));
  let requestCount = 0;

  const initialClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(appDetailsPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-01T00:00:00.000Z') });
  await initialClient.getAppDetails(620);

  const refreshedClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(refreshedPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-02-05T00:00:00.000Z') });
  const refreshed = await refreshedClient.getAppDetails(620);
  assert.ok(refreshed);
  assert.equal(refreshed.name, 'Portal 2 (Refreshed)');

  const fallbackClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-03-12T00:00:00.000Z') });
  const fallback = await fallbackClient.getAppDetails(620);
  assert.ok(fallback);
  assert.equal(fallback.name, 'Portal 2 (Refreshed)');
  assert.equal(requestCount, 3);
});

test('store client does not persist failed or unusable appdetails responses', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const appDetailsPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'steam-mcp-store-cache-invalid-'));
  let requestCount = 0;

  const firstClient = new StoreClient(async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
    }

    if (requestCount === 2) {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }

    return new Response(appDetailsPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-01T00:00:00.000Z') });

  const first = await firstClient.getAppDetails(620);
  const second = await firstClient.getAppDetails(620);
  const third = await firstClient.getAppDetails(620);

  const secondClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-02T00:00:00.000Z') });
  const fourth = await secondClient.getAppDetails(620);

  assert.equal(first, undefined);
  assert.equal(second, undefined);
  assert.ok(third);
  assert.equal(third.name, 'Portal 2');
  assert.ok(fourth);
  assert.equal(fourth.name, 'Portal 2');
  assert.equal(requestCount, 3);
});

test('store client getFreshAppDetails bypasses unexpired cached price data', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'steam-mcp-store-cache-fresh-price-'));
  const cachedPayload = JSON.stringify({
    '620': {
      success: true,
      data: {
        steam_appid: 620,
        name: 'Portal 2',
        price_overview: {
          currency: 'USD',
          initial: 1999,
          final: 499,
          discount_percent: 75,
          initial_formatted: '$19.99',
          final_formatted: '$4.99'
        }
      }
    }
  });
  const refreshedPayload = JSON.stringify({
    '620': {
      success: true,
      data: {
        steam_appid: 620,
        name: 'Portal 2',
        price_overview: {
          currency: 'USD',
          initial: 1999,
          final: 999,
          discount_percent: 50,
          initial_formatted: '$19.99',
          final_formatted: '$9.99'
        }
      }
    }
  });
  let requestCount = 0;

  const seedClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(cachedPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-01T00:00:00.000Z') });
  await seedClient.getCacheableAppDetails(620);

  const freshClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(refreshedPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-02T00:00:00.000Z') });
  const fresh = await freshClient.getFreshAppDetails(620);

  assert.ok(fresh);
  assert.deepEqual(fresh.priceOverview, {
    currency: 'USD',
    initialInCents: 1999,
    finalInCents: 999,
    discountPercent: 50,
    initialFormatted: '$19.99',
    finalFormatted: '$9.99'
  });
  assert.equal(requestCount, 2);
});

test('store client getFreshAppDetails does not fall back to cached price data on refresh failure', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'steam-mcp-store-cache-fresh-failure-'));
  const cachedPayload = JSON.stringify({
    '620': {
      success: true,
      data: {
        steam_appid: 620,
        name: 'Portal 2',
        price_overview: {
          currency: 'USD',
          initial: 1999,
          final: 499,
          discount_percent: 75,
          initial_formatted: '$19.99',
          final_formatted: '$4.99'
        }
      }
    }
  });
  let requestCount = 0;

  const seedClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response(cachedPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-01T00:00:00.000Z') });
  await seedClient.getCacheableAppDetails(620);

  const freshClient = new StoreClient(async () => {
    requestCount += 1;
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
  }, undefined, { cacheDir, now: () => new Date('2026-01-02T00:00:00.000Z') });
  const fresh = await freshClient.getFreshAppDetails(620);

  assert.equal(fresh, undefined);
  assert.equal(requestCount, 2);
});

test('deck status provider uses the live nAppID request contract', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const deckPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'deck-620.json'), 'utf8');
  const requestedUrls: string[] = [];

  const provider = new DeckStatusProvider(async (input) => {
    const requestUrl = new URL(String(input));
    requestedUrls.push(requestUrl.toString());
    const payload = requestUrl.searchParams.get('nAppID') === '620'
      ? deckPayload
      : '{"success":1,"results":[]}';

    return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  });

  const status = await provider.getStatus(620);
  assert.equal(status, 'verified');
  assert.equal(requestedUrls.length, 1);

  const requestUrl = new URL(requestedUrls[0]);
  assert.equal(requestUrl.searchParams.get('nAppID'), '620');
  assert.equal(requestUrl.searchParams.has('appid'), false);
});

test('deck status provider does not cache non-ok responses as unknown', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const deckPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'deck-620.json'), 'utf8');
  let requestCount = 0;

  const provider = new DeckStatusProvider(async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
    }

    return new Response(deckPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  });

  const firstStatus = await provider.getStatus(620);
  const secondStatus = await provider.getStatus(620);

  assert.equal(firstStatus, 'unknown');
  assert.equal(secondStatus, 'verified');
  assert.equal(requestCount, 2);
});

test('deck status provider limits concurrent lookups', async () => {
  let activeRequests = 0;
  let maxActiveRequests = 0;

  const provider = new DeckStatusProvider(async () => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeRequests -= 1;
    return new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  }, 2);

  const statuses = await Promise.all([620, 440, 570, 730, 400].map((appId) => provider.getStatus(appId)));

  assert.deepEqual(statuses, ['verified', 'verified', 'verified', 'verified', 'verified']);
  assert.ok(maxActiveRequests <= 2);
});
