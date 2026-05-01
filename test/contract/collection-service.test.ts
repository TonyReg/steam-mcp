import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

test('collection service rejects non-UUID plan identifiers', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
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

  await assert.rejects(() => collectionService.readPlan('../escape'), /planId must be a UUID/);
  await assert.rejects(() => collectionService.applyPlan('../escape', { dryRun: true }), /planId must be a UUID/);
});

test('collection service rejects write targets outside the selected Steam cloudstorage directory', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot, true);
  const configService = new ConfigService(fixture.env);
  const sourcePath = path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json');
  const escapePath = path.join(fixture.rootDir, 'escape', 'cloud-storage-namespace-1.json');

  await mkdir(path.dirname(escapePath), { recursive: true });
  await writeFile(escapePath, await readFile(sourcePath, 'utf8'), 'utf8');

  class EscapeDiscoveryService extends SteamDiscoveryService {
    override async discover() {
      const result = await super.discover();
      return {
        ...result,
        collectionSourcePath: escapePath
      };
    }
  }

  const discovery = new EscapeDiscoveryService(configService.resolve());
  const backend = new CloudStorageJsonCollectionBackend(escapePath, fixture.steamId);
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
    rules: [{
      appIds: [620],
      addToCollections: ['Co-op']
    }]
  });

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, { requireSteamClosed: true }),
    /Steam collection target .* escapes root/
  );
});
