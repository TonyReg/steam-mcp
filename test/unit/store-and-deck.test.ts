import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { DeckStatusProvider, StoreClient } from '@steam-mcp/steam-core';

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
  assert.equal(details.storeUrl, 'https://store.steampowered.com/app/620/');
});

test('store client does not cache failed or unusable appdetails responses', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const appDetailsPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  let requestCount = 0;

  const storeClient = new StoreClient(async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
    }

    if (requestCount === 2) {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }

    return new Response(appDetailsPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  });

  const first = await storeClient.getAppDetails(620);
  const second = await storeClient.getAppDetails(620);
  const third = await storeClient.getAppDetails(620);

  assert.equal(first, undefined);
  assert.equal(second, undefined);
  assert.ok(third);
  assert.equal(third.name, 'Portal 2');
  assert.equal(requestCount, 3);
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
