import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  CloudStorageJsonCollectionBackend,
  CollectionBackendRegistry,
  ConfigService,
  DeckStatusProvider,
  LibraryService,
  LinkService,
  OfficialStoreClient,
  SteamDiscoveryService,
  StoreClient
} from '@steam-mcp/steam-core';
import type { OfficialOwnedGameSummary } from '@steam-mcp/steam-core';
import { readPairArrayDocument, readPairArrayPayload, rewriteCloudstorageAsPairArray } from '../support/cloudstorage-shape.js';
import { materializeSteamFixture } from '../support/fixture-steam.js';

function defaultOwnedGames(): OfficialOwnedGameSummary[] {
  return [
    { appId: 440, name: 'Team Fortress 2', playtimeForever: 1200 },
    { appId: 570, name: 'Dota 2', playtimeForever: 600 },
    { appId: 620, name: 'Portal 2', playtimeForever: 240 }
  ];
}

function createOwnedGamesClient(games: OfficialOwnedGameSummary[] = defaultOwnedGames()): OfficialStoreClient {
  return new OfficialStoreClient({
    fetchImpl: async () => new Response(JSON.stringify({
      response: {
        game_count: games.length,
        games: games.map((game) => ({
          appid: game.appId,
          name: game.name,
          playtime_forever: game.playtimeForever ?? 0
        }))
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response,
    steamWebApiKey: 'test-key'
  });
}

test('library service joins manifests, localconfig, and cloudstorage collections', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(
    path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json'),
    fixture.steamId
  );
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    createOwnedGamesClient(),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  const result = await library.list({ includeStoreMetadata: false, includeDeckStatus: false, limit: 10 });
  assert.equal(result.summary.total, 3);

  const portal2 = result.games.find((game) => game.appId === 620);
  assert.ok(portal2);
  assert.equal(portal2.name, 'Portal 2');
  assert.equal(portal2.favorite, true);
  assert.deepEqual(portal2.collections, ['Puzzle']);
  assert.equal(portal2.playtimeMinutes, 240);

  const tf2 = result.games.find((game) => game.appId === 440);
  assert.ok(tf2);
  assert.equal(tf2.hidden, true);

  const dota2 = result.games.find((game) => game.appId === 570);
  assert.ok(dota2);
  assert.deepEqual(dota2.collections, ['Multiplayer']);
});

test('library service includes API-owned non-installed games and enriches them from store metadata', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const appDetailsPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-2051120.json'), 'utf8');
  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(
    path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json'),
    fixture.steamId
  );
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('appids') === '2051120') {
        return new Response(appDetailsPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
      }

      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }),
    createOwnedGamesClient([{ appId: 2051120, name: 'HOT WHEELS UNLEASHED™ 2 - Turbocharged', playtimeForever: 0 }]),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  const result = await library.list({ includeStoreMetadata: true, includeDeckStatus: false, limit: 10 });
  const hotWheels2 = result.games.find((game) => game.appId === 2051120);
  assert.ok(hotWheels2);
  assert.equal(hotWheels2.name, 'HOT WHEELS UNLEASHED™ 2 - Turbocharged');
  assert.equal(hotWheels2.installed, false);
  assert.deepEqual(hotWheels2.collections, []);
  assert.deepEqual((hotWheels2.tags ?? []).slice().sort((left, right) => left.localeCompare(right)), ['Arcade', 'Racing']);
  assert.equal(hotWheels2.storeUrl, 'https://store.steampowered.com/app/2051120/');
  assert.equal(result.warnings.some((warning) => warning.includes('2051120') && warning.includes('not returned by GetOwnedGames')), false);
});

test('library service falls back to owned names when store metadata is not cacheable', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const sparseAppDetailsPayload = JSON.stringify({
    '2051120': {
      success: true,
      data: {
        name: 'Sparse Store Name'
      }
    }
  });
  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(
    path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json'),
    fixture.steamId
  );
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('appids') === '2051120') {
        return new Response(sparseAppDetailsPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
      }

      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }),
    createOwnedGamesClient([{ appId: 2051120, name: 'Owned Fallback Name', playtimeForever: 0 }]),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  const result = await library.list({ includeStoreMetadata: true, includeDeckStatus: false, limit: 10 });
  const ownedFallback = result.games.find((game) => game.appId === 2051120);
  assert.ok(ownedFallback);
  assert.equal(ownedFallback.name, 'Owned Fallback Name');
  assert.equal(ownedFallback.tags, undefined);
  assert.equal(ownedFallback.storeUrl, undefined);
  assert.equal(result.warnings.some((warning) => warning.includes('Store metadata lookup failed for 2051120')), false);
});

test('library service warns about stale collection refs that are absent from API-owned games', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const sourcePath = path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json');
  const document = JSON.parse(await readFile(sourcePath, 'utf8')) as Record<string, unknown>;
  document['user-collections.uc-racing'] = {
    name: 'Backlog',
    apps: ['2051120']
  };
  await writeFile(sourcePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(sourcePath, fixture.steamId);
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    createOwnedGamesClient(),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  const result = await library.list({ includeStoreMetadata: true, includeDeckStatus: false, limit: 10 });
  assert.equal(result.games.some((game) => game.appId === 2051120), false);
  assert.ok(result.warnings.some((warning) => warning.includes('Backlog') && warning.includes('2051120') && warning.includes('not returned by GetOwnedGames')));
});


test('library service matches collection filters case-insensitively', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(
    path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json'),
    fixture.steamId
  );
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    createOwnedGamesClient(),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  const puzzle = await library.list({ includeStoreMetadata: false, includeDeckStatus: false, collections: [' puzzle '], limit: 10 });
  assert.deepEqual(puzzle.games.map((game) => game.appId), [620]);

  const multiplayer = await library.list({ includeStoreMetadata: false, includeDeckStatus: false, collections: ['MULTIPLAYER'], limit: 10 });
  assert.deepEqual(multiplayer.games.map((game) => game.appId).sort((left, right) => left - right), [440, 570]);
});

test('library service ignores collections case-insensitively', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(
    path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json'),
    fixture.steamId
  );
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    createOwnedGamesClient(),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  const result = await library.list({ includeStoreMetadata: false, includeDeckStatus: false, ignoreCollections: [' multiplayer '], limit: 10 });
  assert.deepEqual(result.games.map((game) => game.appId), [620]);
});

test('library service reads live-style pair-array cloudstorage collections', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const sourcePath = path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json');
  await rewriteCloudstorageAsPairArray(sourcePath);

  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(sourcePath, fixture.steamId);
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    createOwnedGamesClient(),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  const result = await library.list({ includeStoreMetadata: false, includeDeckStatus: false, limit: 10 });
  assert.equal(result.summary.total, 3);

  const portal2 = result.games.find((game) => game.appId === 620);
  assert.ok(portal2);
  assert.equal(portal2.favorite, true);
  assert.deepEqual(portal2.collections, ['Puzzle']);

  const tf2 = result.games.find((game) => game.appId === 440);
  assert.ok(tf2);
  assert.equal(tf2.hidden, true);

  const dota2 = result.games.find((game) => game.appId === 570);
  assert.ok(dota2);
  assert.deepEqual(dota2.collections, ['Multiplayer']);

  const entries = await readPairArrayDocument(sourcePath);
  const favorite = readPairArrayPayload(entries, 'user-collections.favorite') as { id: string; name: string; added: number[]; removed: number[] };
  const hidden = readPairArrayPayload(entries, 'user-collections.hidden') as { id: string; name: string; added: number[]; removed: number[] };
  const multiplayer = readPairArrayPayload(entries, 'user-collections.uc-multiplayer') as { id: string; name: string; added: number[]; removed: number[] };

  assert.deepEqual(favorite, {
    id: 'favorite',
    name: 'Favorites',
    added: [620],
    removed: []
  });
  assert.deepEqual(hidden, {
    id: 'hidden',
    name: 'Hidden',
    added: [440],
    removed: []
  });
  assert.deepEqual(multiplayer, {
    id: 'uc-multiplayer',
    name: 'Multiplayer',
    added: [440, 570],
    removed: []
  });
});

test('library service resolves deck statuses through the live nAppID request contract', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(
    path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json'),
    fixture.steamId
  );
  const requestedUrls: string[] = [];
  const deckResponses = new Map([
    ['620', '{"results":{"resolved_category":3}}'],
    ['440', '{"results":{"resolved_category":2}}'],
    ['570', '{"results":{"resolved_category":1}}']
  ]);
  const deckProvider = new DeckStatusProvider(async (input) => {
    const requestUrl = new URL(String(input));
    requestedUrls.push(requestUrl.toString());
    const payload = requestUrl.searchParams.get('nAppID')
      ? deckResponses.get(requestUrl.searchParams.get('nAppID')!) ?? '{"success":1,"results":[]}'
      : '{"success":1,"results":[]}';

    return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  });
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    createOwnedGamesClient(),
    deckProvider,
    new LinkService()
  );

  const result = await library.list({ includeStoreMetadata: false, includeDeckStatus: true, limit: 10 });
  assert.equal(result.summary.total, 3);

  const statusesByApp = new Map(result.games.map((game) => [game.appId, game.deckStatus]));
  assert.equal(statusesByApp.get(620), 'verified');
  assert.equal(statusesByApp.get(440), 'playable');
  assert.equal(statusesByApp.get(570), 'unsupported');
  assert.equal(requestedUrls.length, 3);

  for (const rawUrl of requestedUrls) {
    const requestUrl = new URL(rawUrl);
    assert.ok(requestUrl.searchParams.has('nAppID'));
    assert.equal(requestUrl.searchParams.has('appid'), false);
  }
});

test('library service infers deck enrichment when deck status filters are requested', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(
    path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json'),
    fixture.steamId
  );
  const requestedUrls: string[] = [];
  const deckResponses = new Map([
    ['620', '{"results":{"resolved_category":3}}'],
    ['440', '{"results":{"resolved_category":2}}'],
    ['570', '{"results":{"resolved_category":1}}']
  ]);
  const deckProvider = new DeckStatusProvider(async (input) => {
    const requestUrl = new URL(String(input));
    requestedUrls.push(requestUrl.toString());
    const payload = requestUrl.searchParams.get('nAppID')
      ? deckResponses.get(requestUrl.searchParams.get('nAppID')!) ?? '{"success":1,"results":[]}'
      : '{"success":1,"results":[]}';

    return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
  });
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    createOwnedGamesClient(),
    deckProvider,
    new LinkService()
  );

  const result = await library.list({ includeStoreMetadata: false, deckStatuses: ['verified', 'playable'], limit: 10 });
  assert.deepEqual(result.games.map((game) => game.appId).sort((left, right) => left - right), [440, 620]);

  const statusesByApp = new Map(result.games.map((game) => [game.appId, game.deckStatus]));
  assert.equal(statusesByApp.get(620), 'verified');
  assert.equal(statusesByApp.get(440), 'playable');
  assert.equal(requestedUrls.length, 3);
});

test('library service rejects ambiguous collection names that differ only by case', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const sourcePath = path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json');
  const document = JSON.parse(await readFile(sourcePath, 'utf8')) as Record<string, unknown>;
  document['user-collections.uc-puzzle-copy'] = {
    name: 'puzzle',
    apps: ['440']
  };
  await writeFile(sourcePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  const config = new ConfigService(fixture.env).resolve();
  const discovery = new SteamDiscoveryService(config);
  const backend = new CloudStorageJsonCollectionBackend(sourcePath, fixture.steamId);
  const library = new LibraryService(
    discovery,
    new CollectionBackendRegistry([backend]),
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    createOwnedGamesClient(),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  await assert.rejects(
    () => library.list({ includeStoreMetadata: false, includeDeckStatus: false, limit: 10 }),
    /ambiguous collection names Puzzle and puzzle/
  );
});
