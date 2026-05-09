import assert from 'node:assert/strict';
import test from 'node:test';
import { OfficialStoreClient } from '../../packages/steam-core/src/official-store/index.js';

test('official store client calls GetAppList with runtime API key and normalizes results', async () => {
  const requestedUrls: string[] = [];
  const client = new OfficialStoreClient({
    steamWebApiKey: 'test-key',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      return new Response(JSON.stringify({
        response: {
          apps: [
            {
              appid: 620,
              name: 'Portal 2',
              last_modified: 1714000000,
              price_change_number: 42
            },
            {
              appid: 730,
              name: 'Counter-Strike 2'
            }
          ],
          have_more_results: true,
          last_appid: 730
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }
  });

  const result = await client.getAppList({
    limit: 2,
    lastAppId: 600,
    ifModifiedSince: 1713000000,
    includeGames: false,
    includeDlc: true,
    includeSoftware: true
  });

  assert.deepEqual(result, {
    apps: [
      {
        appId: 620,
        name: 'Portal 2',
        lastModified: 1714000000,
        priceChangeNumber: 42
      },
      {
        appId: 730,
        name: 'Counter-Strike 2',
        lastModified: undefined,
        priceChangeNumber: undefined
      }
    ],
    haveMoreResults: true,
    lastAppId: 730
  });

  const requestUrl = new URL(requestedUrls[0] ?? '');
  assert.equal(requestUrl.toString().startsWith('https://partner.steam-api.com/IStoreService/GetAppList/v1/'), true);
  assert.equal(requestUrl.searchParams.get('key'), 'test-key');
  assert.equal(requestUrl.searchParams.get('max_results'), '2');
  assert.equal(requestUrl.searchParams.get('last_appid'), '600');
  assert.equal(requestUrl.searchParams.get('if_modified_since'), '1713000000');
  assert.equal(requestUrl.searchParams.get('include_games'), 'false');
  assert.equal(requestUrl.searchParams.get('include_dlc'), 'true');
  assert.equal(requestUrl.searchParams.get('include_software'), 'true');
  assert.equal(requestUrl.searchParams.get('format'), 'json');
});

test('official store client returns an explicit missing-key error before fetching', async () => {
  const client = new OfficialStoreClient({
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    }
  });

  await assert.rejects(() => client.getAppList(), /STEAM_API_KEY/);
});

test('official store client surfaces non-ok HTTP failures', async () => {
  const client = new OfficialStoreClient({
    steamWebApiKey: 'test-key',
    fetchImpl: async () => new Response('upstream failure', { status: 503 })
  });

  await assert.rejects(() => client.getAppList(), /Official store catalog request failed with status 503\./);
});