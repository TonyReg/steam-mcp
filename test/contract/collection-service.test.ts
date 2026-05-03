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
import { readPairArrayDocument, readPairArrayPayload, rewriteCloudstorageAsPairArray } from '../support/cloudstorage-shape.js';
import { materializeSteamFixture } from '../support/fixture-steam.js';

async function createCollectionServiceHarness(enableWrites = true) {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot, enableWrites);
  const configService = new ConfigService(fixture.env);
  const discovery = new SteamDiscoveryService(configService.resolve());
  const sourcePath = path.join(fixture.cloudStorageDir, 'cloud-storage-namespace-1.json');
  const namespacePath = path.join(fixture.cloudStorageDir, 'cloud-storage-namespaces.json');
  const backend = new CloudStorageJsonCollectionBackend(sourcePath, fixture.steamId);
  const registry = new CollectionBackendRegistry([backend]);
  const library = new LibraryService(
    discovery,
    registry,
    new StoreClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new DeckStatusProvider(async () => new Response('{"results":{"resolved_category":3}}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response),
    new LinkService()
  );

  return {
    fixture,
    configService,
    discovery,
    sourcePath,
    namespacePath,
    backend,
    registry,
    library,
    createCollectionService: (safetyService = new SafetyService(async () => false)) => new CollectionService(
      configService,
      discovery,
      registry,
      library,
      new SearchService(),
      safetyService
    )
  };
}

test('collection service writes backup-first, keeps favorites read-only, and preserves read-only groups', async () => {
  const harness = await createCollectionServiceHarness();
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    readOnlyGroups: [' puzzle '],
    rules: [
      {
        appIds: [620],
        setCollections: ['Co-op']
      }
    ]
  });

  const result = await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true });
  assert.equal(result.appliedOperationCount, 1);
  assert.ok(result.backupPath);

  const updated = JSON.parse(await readFile(harness.sourcePath, 'utf8')) as Record<string, unknown>;
  assert.equal((updated['unrelated-section'] as { preserve: boolean }).preserve, true);
  assert.deepEqual(updated['user-collections.favorite'], ['620']);

  const puzzle = updated['user-collections.uc-puzzle'] as { apps: string[]; name: string; description: string };
  assert.equal(puzzle.name, 'Puzzle');
  assert.deepEqual(puzzle.apps, ['620']);
  assert.equal(puzzle.description, 'Preserve me');

  const coop = updated['user-collections.uc-co-op'] as { apps: string[]; name: string };
  assert.equal(coop.name, 'Co-op');
  assert.deepEqual(coop.apps, ['620']);
});

test('collection service preserves live-style pair-array documents and ignored-group memberships', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();
  const beforeNamespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;
  const beforeCoopEntry = (await readPairArrayDocument(harness.sourcePath)).find(([key]) => key === 'user-collections.uc-co-op');
  assert.equal(beforeCoopEntry, undefined);

  const preview = await collectionService.createPlan({
    mode: 'merge',
    ignoreGroups: [' multiplayer '],
    rules: [
      {
        appIds: [620],
        addToCollections: ['Co-op']
      }
    ]
  });

  const result = await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true });
  assert.equal(result.appliedOperationCount, 1);

  const updated = await readPairArrayDocument(harness.sourcePath);
  const unrelated = readPairArrayPayload(updated, 'unrelated-section') as { preserve: boolean };
  assert.equal(unrelated.preserve, true);
  assert.deepEqual(updated.map(([key]) => key), [
    'user-collections.favorite',
    'user-collections.hidden',
    'user-collections.uc-puzzle',
    'user-collections.uc-multiplayer',
    'unrelated-section',
    'user-collections.uc-co-op'
  ]);

  const favorite = readPairArrayPayload(updated, 'user-collections.favorite') as { id: string; name: string; added: number[]; removed: number[] };
  assert.deepEqual(favorite, {
    id: 'favorite',
    name: 'Favorites',
    added: [620],
    removed: []
  });

  const hidden = readPairArrayPayload(updated, 'user-collections.hidden') as { id: string; name: string; added: number[]; removed: number[] };
  assert.deepEqual(hidden, {
    id: 'hidden',
    name: 'Hidden',
    added: [440],
    removed: []
  });

  const multiplayer = readPairArrayPayload(updated, 'user-collections.uc-multiplayer') as { id: string; name: string; added: number[]; removed: number[] };
  assert.deepEqual(multiplayer, {
    id: 'uc-multiplayer',
    name: 'Multiplayer',
    added: [440, 570],
    removed: []
  });

  const coop = readPairArrayPayload(updated, 'user-collections.uc-co-op') as { name: string; added: number[]; removed: number[] };
  assert.equal(coop.name, 'Co-op');
  assert.deepEqual(coop.added, [620]);
  assert.deepEqual(coop.removed, []);

  const wrappedCoop = updated.find(([key]) => key === 'user-collections.uc-co-op')?.[1] as Record<string, unknown> | undefined;
  assert.ok(wrappedCoop);
  assert.equal(typeof wrappedCoop.timestamp, 'number');
  assert.equal(wrappedCoop.version, '1417');

  const namespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;
  assert.deepEqual(beforeNamespaces, [[1, '1416'], [3, '0']]);
  assert.deepEqual(namespaces, [[1, '1417'], [3, '0']]);
});

test('collection service bumps wrapped entry metadata and namespace counter only when wrapped payload changes', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const beforeDocument = await readPairArrayDocument(harness.sourcePath);
  const beforePuzzleWrapper = beforeDocument.find(([key]) => key === 'user-collections.uc-puzzle')?.[1] as Record<string, unknown>;
  const beforeNamespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Puzzle']
      }
    ]
  });

  await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true });

  const updated = await readPairArrayDocument(harness.sourcePath);
  const puzzleWrapper = updated.find(([key]) => key === 'user-collections.uc-puzzle')?.[1] as Record<string, unknown>;
  assert.ok(puzzleWrapper);
  assert.equal(typeof puzzleWrapper.timestamp, 'number');
  assert.equal(puzzleWrapper.version, '1417');
  assert.ok(Number(puzzleWrapper.timestamp) >= Number(beforePuzzleWrapper.timestamp));

  const puzzle = readPairArrayPayload(updated, 'user-collections.uc-puzzle') as { name: string; added: number[]; removed: number[]; description?: string };
  assert.equal(puzzle.name, 'Puzzle');
  assert.deepEqual(puzzle.added, [440, 620]);
  assert.deepEqual(puzzle.removed, []);
  assert.equal(puzzle.description, undefined);

  const namespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;
  assert.deepEqual(beforeNamespaces, [[1, '1416'], [3, '0']]);
  assert.deepEqual(namespaces, [[1, '1417'], [3, '0']]);
});

test('collection service leaves wrapped metadata and namespace counter unchanged on no-op apply', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');
  const beforeNamespacesText = await readFile(harness.namespacePath, 'utf8');

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [620],
        addToCollections: ['Puzzle']
      }
    ]
  });

  const result = await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true });
  assert.equal(result.appliedOperationCount, 1);
  assert.equal(result.backupPath, undefined);
  assert.equal(result.rollbackPath, undefined);
  assert.equal(await readFile(harness.sourcePath, 'utf8'), beforeDocumentText);
  assert.equal(await readFile(harness.namespacePath, 'utf8'), beforeNamespacesText);
});

test('collection service ignores legacy favorite operations during apply', async () => {
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
        addToCollections: ['Co-op']
      }
    ]
  });

  const persistedPlan = JSON.parse(await readFile(preview.plan.planPath, 'utf8')) as {
    operations: Record<string, Record<string, unknown> | undefined>;
  };
  const currentOperation = persistedPlan.operations['620'];
  assert.ok(currentOperation);
  persistedPlan.operations['620'] = {
    ...currentOperation,
    favorite: false
  };
  await writeFile(preview.plan.planPath, `${JSON.stringify(persistedPlan, null, 2)}\n`, 'utf8');

  const result = await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true });
  assert.equal(result.appliedOperationCount, 1);

  const updated = JSON.parse(await readFile(sourcePath, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(updated['user-collections.favorite'], ['620']);
  const coop = updated['user-collections.uc-co-op'] as { apps: string[]; name: string };
  assert.equal(coop.name, 'Co-op');
  assert.deepEqual(coop.apps, ['620']);
});

test('collection service merges env default protected groups into persisted plan policies', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  fixture.env.STEAM_DEFAULT_READ_ONLY_GROUPS = '["Puzzle"]';
  fixture.env.STEAM_DEFAULT_IGNORE_GROUPS = '["Multiplayer"]';
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
    readOnlyGroups: ['Co-op'],
    ignoreGroups: ['Backlog'],
    rules: [
      {
        appIds: [620],
        addToCollections: ['Co-op']
      }
    ]
  });

  assert.deepEqual(preview.plan.policies, {
    readOnlyGroups: ['Co-op', 'Puzzle'],
    ignoreGroups: ['Backlog', 'Multiplayer']
  });
});

test('collection service excludes ignored-group games from explicit appId rules', async () => {
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

  const preview = await collectionService.createPlan({
    mode: 'merge',
    ignoreGroups: ['Multiplayer'],
    rules: [
      {
        appIds: [440],
        addToCollections: ['Co-op']
      }
    ]
  });

  assert.deepEqual(preview.matchedGames, []);
  assert.deepEqual(preview.plan.operations, {});
});

test('collection service excludes ignored-group games from query rules', async () => {
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

  const preview = await collectionService.createPlan({
    mode: 'merge',
    ignoreGroups: ['Puzzle'],
    rules: [
      {
        query: 'portal',
        addToCollections: ['Co-op']
      }
    ]
  });

  assert.deepEqual(preview.matchedGames, []);
  assert.deepEqual(preview.plan.operations, {});
});

test('collection service query rules match store tags when store metadata is available', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  const appDetailsPayload = await readFile(path.join(repoRoot, 'fixtures', 'steam', 'store', 'appdetails-620.json'), 'utf8');
  const configService = new ConfigService(fixture.env);
  const discovery = new SteamDiscoveryService(configService.resolve());
  const sourcePath = path.join(fixture.installDir, 'userdata', fixture.steamId, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json');
  const backend = new CloudStorageJsonCollectionBackend(sourcePath, fixture.steamId);
  const registry = new CollectionBackendRegistry([backend]);
  const library = new LibraryService(
    discovery,
    registry,
    new StoreClient(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('appids') === '620') {
        return new Response(appDetailsPayload, { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
      }

      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }),
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
        query: 'co-op',
        addToCollections: ['Backlog']
      }
    ]
  });

  assert.deepEqual(preview.matchedGames.map((game) => game.appId), [620]);
  assert.equal(preview.matchedGames[0]?.name, 'Portal 2');
  assert.deepEqual((preview.matchedGames[0]?.tags ?? []).slice().sort((left, right) => left.localeCompare(right)), ['Co-op', 'Puzzle']);
  assert.deepEqual(preview.plan.operations, {
    '620': {
      appId: 620,
      collectionsToAdd: ['Backlog']
    }
  });
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

test('collection service rolls back both cloudstorage files when namespace write fails', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);

  class FailingSafetyService extends SafetyService {
    override async atomicWrite(targetPath: string, content: string): Promise<void> {
      if (path.basename(targetPath).toLowerCase() === 'cloud-storage-namespaces.json') {
        throw new Error('namespace write failed');
      }

      await super.atomicWrite(targetPath, content);
    }
  }

  const collectionService = harness.createCollectionService(new FailingSafetyService(async () => false));
  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');
  const beforeNamespacesText = await readFile(harness.namespacePath, 'utf8');

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Puzzle']
      }
    ]
  });

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true }),
    /namespace write failed/
  );

  assert.equal(await readFile(harness.sourcePath, 'utf8'), beforeDocumentText);
  assert.equal(await readFile(harness.namespacePath, 'utf8'), beforeNamespacesText);
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
