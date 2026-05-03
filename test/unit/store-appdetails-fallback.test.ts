import assert from 'node:assert/strict';
import test from 'node:test';
import { createStoreAppDetailsFallbackFetch } from '../../packages/steam-mcp/src/store-appdetails-fallback.js';

test('fallback calls GetOwnedGames with converted SteamID64 and returns synthetic appdetails payload', async () => {
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());

    if (url.hostname === 'store.steampowered.com') {
      return new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } }) as Response;
    }

    return new Response(JSON.stringify({
      response: {
        games: [
          {
            appid: 2051120,
            name: 'HOT WHEELS UNLEASHED™ 2 - Turbocharged'
          }
        ]
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  };

  const wrappedFetch = createStoreAppDetailsFallbackFetch({
    fetchImpl,
    steamWebApiKey: 'test-key',
    getSelectedUserId: async () => '935812139'
  });

  const response = await wrappedFetch('https://store.steampowered.com/api/appdetails?appids=2051120&l=english&cc=us');
  const payload = await response.json() as Record<string, { success: boolean; data: { steam_appid: number; name: string } }>;

  assert.equal(payload['2051120']?.success, true);
  assert.equal(payload['2051120']?.data.name, 'HOT WHEELS UNLEASHED™ 2 - Turbocharged');

  const apiUrl = new URL(requestedUrls.find((entry) => entry.includes('IPlayerService/GetOwnedGames')) ?? '');
  assert.equal(apiUrl.searchParams.get('key'), 'test-key');
  assert.equal(apiUrl.searchParams.get('steamid'), '76561198896077867');
  assert.equal(apiUrl.searchParams.get('include_appinfo'), '1');
  assert.equal(apiUrl.searchParams.get('include_played_free_games'), '1');
  assert.equal(apiUrl.searchParams.get('appids_filter[0]'), '2051120');
  assert.equal(apiUrl.searchParams.get('format'), 'json');
});

test('fallback preserves successful storefront payloads without calling the Web API', async () => {
  const requestedUrls: string[] = [];
  const wrappedFetch = createStoreAppDetailsFallbackFetch({
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      return new Response(JSON.stringify({
        '620': {
          success: true,
          data: {
            steam_appid: 620,
            name: 'Portal 2'
          }
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    },
    steamWebApiKey: 'test-key',
    getSelectedUserId: async () => '76561198000000000'
  });

  const response = await wrappedFetch('https://store.steampowered.com/api/appdetails?appids=620&l=english&cc=us');
  const payload = await response.json() as Record<string, { data: { name: string } }>;

  assert.equal(payload['620']?.data.name, 'Portal 2');
  assert.equal(requestedUrls.some((entry) => entry.includes('IPlayerService/GetOwnedGames')), false);
});

test('fallback skips official Web API lookup when key or user is unavailable', async () => {
  const requestedUrls: string[] = [];
  const wrappedFetch = createStoreAppDetailsFallbackFetch({
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) as Response;
    },
    getSelectedUserId: async () => undefined
  });

  const response = await wrappedFetch('https://store.steampowered.com/api/appdetails?appids=2051120&l=english&cc=us');

  assert.equal(response.status, 503);
  assert.equal(requestedUrls.length, 1);
});

test('fallback preserves storefront failure when owned-game lookup returns no match', async () => {
  const requestedUrls: string[] = [];
  const wrappedFetch = createStoreAppDetailsFallbackFetch({
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      if (url.hostname === 'store.steampowered.com') {
        return new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } }) as Response;
      }

      return new Response('{"response":{"games":[]}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    },
    steamWebApiKey: 'test-key',
    getSelectedUserId: async () => '76561198000000000'
  });

  const response = await wrappedFetch('https://store.steampowered.com/api/appdetails?appids=2051120&l=english&cc=us');

  assert.equal(response.status, 403);
  assert.equal(requestedUrls.some((entry) => entry.includes('IPlayerService/GetOwnedGames')), true);
});
