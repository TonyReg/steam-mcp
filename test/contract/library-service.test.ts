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
  SteamDiscoveryService,
  StoreClient
} from '@steam-mcp/steam-core';
import { readPairArrayDocument, readPairArrayPayload, rewriteCloudstorageAsPairArray } from '../support/cloudstorage-shape.js';
import { materializeSteamFixture } from '../support/fixture-steam.js';

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
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  const puzzle = await library.list({ includeStoreMetadata: false, includeDeckStatus: false, collections: [' puzzle '], limit: 10 });
  assert.deepEqual(puzzle.games.map((game) => game.appId), [620]);

  const multiplayer = await library.list({ includeStoreMetadata: false, includeDeckStatus: false, collections: ['MULTIPLAYER'], limit: 10 });
  assert.deepEqual(multiplayer.games.map((game) => game.appId).sort((left, right) => left - right), [440, 570]);
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
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  await assert.rejects(
    () => library.list({ includeStoreMetadata: false, includeDeckStatus: false, limit: 10 }),
    /ambiguous collection names Puzzle and puzzle/
  );
});
