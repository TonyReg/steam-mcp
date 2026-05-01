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
