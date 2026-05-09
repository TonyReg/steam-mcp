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
  assert.equal(requestUrl.toString().startsWith('https://api.steampowered.com/IStoreService/GetAppList/v1/'), true);
  assert.equal(requestUrl.searchParams.get('key'), 'test-key');
  assert.equal(requestUrl.searchParams.get('max_results'), null);
  assert.equal(requestUrl.searchParams.get('last_appid'), null);
  assert.equal(requestUrl.searchParams.get('if_modified_since'), null);
  assert.equal(requestUrl.searchParams.get('include_games'), null);
  assert.equal(requestUrl.searchParams.get('include_dlc'), null);
  assert.equal(requestUrl.searchParams.get('include_software'), null);
  assert.equal(requestUrl.searchParams.get('format'), 'json');

  const inputJson = JSON.parse(requestUrl.searchParams.get('input_json') ?? '{}') as Record<string, unknown>;
  assert.deepEqual(inputJson, {
    max_results: 2,
    last_appid: 600,
    if_modified_since: 1713000000,
    include_games: false,
    include_dlc: true,
    include_software: true
  });
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

test('official store client calls GetOwnedGames with input_json-only steamid and normalizes results', async () => {
  const requestedUrls: string[] = [];
  const client = new OfficialStoreClient({
    steamWebApiKey: 'test-key',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      return new Response(JSON.stringify({
        response: {
          game_count: 2,
          games: [
            {
              appid: 440,
              name: 'Team Fortress 2',
              playtime_forever: 123,
              img_icon_url: 'icon-440',
              has_community_visible_stats: true
            },
            {
              appid: 620,
              name: 'Portal 2'
            }
          ]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }
  });

  const result = await client.getOwnedGames({
    steamId: '76561198000000000',
    includeAppInfo: true,
    includePlayedFreeGames: true,
    includeFreeSub: true,
    appIdsFilter: [440, 620]
  });

  assert.deepEqual(result, {
    gameCount: 2,
    games: [
      {
        appId: 440,
        name: 'Team Fortress 2',
        playtimeForever: 123,
        iconUrl: 'icon-440',
        hasCommunityVisibleStats: true
      },
      {
        appId: 620,
        name: 'Portal 2',
        playtimeForever: undefined,
        iconUrl: undefined,
        hasCommunityVisibleStats: undefined
      }
    ]
  });

  const requestUrl = new URL(requestedUrls[0] ?? '');
  assert.equal(requestUrl.toString().startsWith('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'), true);
  assert.equal(requestUrl.searchParams.get('key'), 'test-key');
  assert.equal(requestUrl.searchParams.get('format'), 'json');
  assert.equal(requestUrl.searchParams.get('steamid'), null);
  assert.equal(requestUrl.searchParams.get('include_appinfo'), null);
  assert.equal(requestUrl.searchParams.get('include_played_free_games'), null);
  assert.equal(requestUrl.searchParams.get('include_free_sub'), null);
  assert.equal(requestUrl.searchParams.get('appids_filter[0]'), null);

  const inputJson = JSON.parse(requestUrl.searchParams.get('input_json') ?? '{}') as Record<string, unknown>;
  assert.deepEqual(inputJson, {
    steamid: '76561198000000000',
    include_appinfo: true,
    include_played_free_games: true,
    include_free_sub: true,
    appids_filter: [440, 620]
  });
});

test('official store client rejects owned-games calls when no API key is configured', async () => {
  const client = new OfficialStoreClient({
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    }
  });

  await assert.rejects(() => client.getOwnedGames({
    steamId: '76561198000000000',
    includeAppInfo: true,
    includePlayedFreeGames: true,
    includeFreeSub: true
  }), /STEAM_API_KEY/);
});

test('official store client surfaces non-ok HTTP failures for owned-games requests', async () => {
  const client = new OfficialStoreClient({
    steamWebApiKey: 'test-key',
    fetchImpl: async () => new Response('upstream failure', { status: 502 })
  });

  await assert.rejects(() => client.getOwnedGames({
    steamId: '76561198000000000',
    includeAppInfo: true,
    includePlayedFreeGames: true,
    includeFreeSub: true
  }), /Official owned-games request failed with status 502\./);
});

test('official store client calls GetRecentlyPlayedGames with input_json-only steamid and normalizes results', async () => {
  const requestedUrls: string[] = [];
  const client = new OfficialStoreClient({
    steamWebApiKey: 'test-key',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      return new Response(JSON.stringify({
        response: {
          total_count: 2,
          games: [
            {
              appid: 620,
              name: 'Portal 2',
              playtime_2weeks: 45,
              playtime_forever: 240,
              img_icon_url: 'icon-620'
            },
            {
              appid: 440,
              name: 'Team Fortress 2'
            }
          ]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }
  });

  const result = await client.getRecentlyPlayedGames({
    steamId: '76561198000000000'
  });

  assert.deepEqual(result, {
    totalCount: 2,
    games: [
      {
        appId: 620,
        name: 'Portal 2',
        playtimeTwoWeeks: 45,
        playtimeForever: 240,
        iconUrl: 'icon-620'
      },
      {
        appId: 440,
        name: 'Team Fortress 2',
        playtimeTwoWeeks: undefined,
        playtimeForever: undefined,
        iconUrl: undefined
      }
    ]
  });

  const requestUrl = new URL(requestedUrls[0] ?? '');
  assert.equal(requestUrl.toString().startsWith('https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/'), true);
  assert.equal(requestUrl.searchParams.get('key'), 'test-key');
  assert.equal(requestUrl.searchParams.get('format'), 'json');
  assert.equal(requestUrl.searchParams.get('steamid'), null);

  const inputJson = JSON.parse(requestUrl.searchParams.get('input_json') ?? '{}') as Record<string, unknown>;
  assert.deepEqual(inputJson, {
    steamid: '76561198000000000'
  });
});

test('official store client rejects recently-played calls when no API key is configured', async () => {
  const client = new OfficialStoreClient({
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    }
  });

  await assert.rejects(() => client.getRecentlyPlayedGames({
    steamId: '76561198000000000'
  }), /STEAM_API_KEY/);
});

test('official store client surfaces non-ok HTTP failures for recently-played requests', async () => {
  const client = new OfficialStoreClient({
    steamWebApiKey: 'test-key',
    fetchImpl: async () => new Response('upstream failure', { status: 504 })
  });

  await assert.rejects(() => client.getRecentlyPlayedGames({
    steamId: '76561198000000000'
  }), /Official recently-played request failed with status 504\./);
});
