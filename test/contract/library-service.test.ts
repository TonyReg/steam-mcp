import assert from 'node:assert/strict';
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
