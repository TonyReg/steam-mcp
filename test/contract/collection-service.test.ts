import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  CloudStorageJsonCollectionBackend,
  CollectionBackendRegistry,
  CollectionService,
  ConfigService,
  DeckStatusProvider,
  LibraryService,
  LinkService,
  SafetyService,
  SearchService,
  SteamDiscoveryService,
  StoreClient
} from '@steam-mcp/steam-core';
import { materializeSteamFixture } from '../support/fixture-steam.js';

test('collection service writes backup-first and preserves unrelated JSON fields', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot, true);
  const configService = new ConfigService(fixture.env);
  const discovery = new SteamDiscoveryService(configService.resolve());
  const sourcePath = path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json');
  const backend = new CloudStorageJsonCollectionBackend(sourcePath, fixture.steamId);
  const registry = new CollectionBackendRegistry([backend]);
  const library = new LibraryService(
    discovery,
    registry,
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );
  const collectionService = new CollectionService(
    configService,
    discovery,
    registry,
    library,
    new SearchService(),
    new SafetyService(async () => false)
  );

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [620],
        addToCollections: ['Co-op'],
        favorite: true
      }
    ]
  });

  const result = await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true });
  assert.equal(result.appliedOperationCount, 1);
  assert.ok(result.backupPath);

  const updated = JSON.parse(await readFile(sourcePath, 'utf8')) as Record<string, unknown>;
  assert.equal((updated['unrelated-section'] as { preserve: boolean }).preserve, true);
  const coop = updated['user-collections.uc-co-op'] as { apps: string[]; name: string };
  assert.equal(coop.name, 'Co-op');
  assert.deepEqual(coop.apps, ['620']);
});
