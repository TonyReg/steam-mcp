import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
import {
  readModifiedKeys,
  readPairArrayDocument,
  readPairArrayPayload,
  readPairArrayWrapper,
  rewriteCloudstorageAsPairArray
} from '../support/cloudstorage-shape.js';
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
  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');

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
  assert.ok(result.rollbackPath);
  assert.notEqual(result.backupPath, result.rollbackPath);
  assert.ok(result.backupPath.startsWith(harness.configService.resolve().stateDirectories.backupsDir));
  assert.equal(await readFile(result.backupPath, 'utf8'), beforeDocumentText);

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

test('collection service writes experimental dirty stage first', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const beforeNamespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  const result = await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true, experimentalFinalize: false });

  const updated = await readPairArrayDocument(harness.sourcePath);
  const racingWrapper = readPairArrayWrapper(updated, 'user-collections.uc-racing');
  const racing = readPairArrayPayload(updated, 'user-collections.uc-racing') as { name: string; added: number[]; removed: number[] };
  const modifiedKeys = await readModifiedKeys(harness.sourcePath);
  const namespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;

  assert.equal(result.appliedOperationCount, 1);
  assert.equal(racing.name, 'Racing');
  assert.deepEqual(racing.added, [440]);
  assert.deepEqual(racing.removed, []);
  assert.equal(racingWrapper.version, null);
  assert.deepEqual(modifiedKeys, ['user-collections.uc-racing']);
  assert.deepEqual(beforeNamespaces, [[1, '1416'], [3, '0']]);
  assert.deepEqual(namespaces, [[1, '1417'], [3, '0']]);
  assert.match(result.warnings.join(' '), /pending finalize/i);

  const persistedPlan = JSON.parse(await readFile(preview.plan.planPath, 'utf8')) as { expectedDirtySnapshotHash?: string };
  assert.equal(typeof persistedPlan.expectedDirtySnapshotHash, 'string');
  assert.ok((persistedPlan.expectedDirtySnapshotHash?.length ?? 0) > 0);
});

test('collection service finalizes experimental dirty state', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true, experimentalFinalize: false });
  const persistedAfterDirty = JSON.parse(await readFile(preview.plan.planPath, 'utf8')) as { expectedDirtySnapshotHash?: string };
  assert.equal(typeof persistedAfterDirty.expectedDirtySnapshotHash, 'string');
  const dirtyNamespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;

  const result = await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true, experimentalFinalize: true });

  const updated = await readPairArrayDocument(harness.sourcePath);
  const racingWrapper = readPairArrayWrapper(updated, 'user-collections.uc-racing');
  const modifiedKeys = await readModifiedKeys(harness.sourcePath);
  const namespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;

  assert.equal(result.appliedOperationCount, 1);
  assert.equal(racingWrapper.version, '1417');
  assert.deepEqual(modifiedKeys, []);
  assert.deepEqual(dirtyNamespaces, [[1, '1417'], [3, '0']]);
  assert.deepEqual(namespaces, [[1, '1417'], [3, '0']]);
});

test('collection service stages hidden-only experimental changes', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [620],
        hidden: true
      }
    ]
  });

  const result = await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  const updated = await readPairArrayDocument(harness.sourcePath);
  const hiddenWrapper = readPairArrayWrapper(updated, 'user-collections.hidden');
  const hidden = readPairArrayPayload(updated, 'user-collections.hidden') as { added: number[]; removed: number[] };
  const modifiedKeys = await readModifiedKeys(harness.sourcePath);
  const namespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;

  assert.equal(result.appliedOperationCount, 1);
  assert.equal(hiddenWrapper.version, null);
  assert.deepEqual(hidden.added, [440, 620]);
  assert.deepEqual(hidden.removed, []);
  assert.deepEqual(modifiedKeys, ['user-collections.hidden']);
  assert.deepEqual(namespaces, [[1, '1417'], [3, '0']]);
});

test('collection service materializes namespace metadata during experimental dirty stage when it is missing', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  await writeFile(harness.namespacePath, `${JSON.stringify([[3, '0']], null, 2)}\n`, 'utf8');

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  const result = await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  const updated = await readPairArrayDocument(harness.sourcePath);
  const racingWrapper = readPairArrayWrapper(updated, 'user-collections.uc-racing');
  const namespaces = JSON.parse(await readFile(harness.namespacePath, 'utf8')) as Array<[number, string]>;
  assert.equal(result.appliedOperationCount, 1);
  assert.equal(racingWrapper.version, null);
  assert.deepEqual(await readModifiedKeys(harness.sourcePath), ['user-collections.uc-racing']);
  assert.deepEqual(namespaces, [[3, '0'], [1, '1']]);
});

test('collection service rejects experimental finalize when live snapshot drifts from persisted dirty snapshot', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  const dirtyDocument = await readPairArrayDocument(harness.sourcePath);
  const driftedDocument = dirtyDocument.map(([key, value]) => {
    if (key !== 'user-collections.uc-racing') {
      return [key, value] as [string, unknown];
    }

    const wrapper = structuredClone(value) as Record<string, unknown>;
    const payload = JSON.parse(String(wrapper.value)) as { id: string; name: string; added: number[]; removed: number[] };
    payload.added = [440, 620];
    wrapper.value = JSON.stringify(payload);
    return [key, wrapper] as [string, unknown];
  });
  await writeFile(harness.sourcePath, `${JSON.stringify(driftedDocument, null, 2)}\n`, 'utf8');

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: true
    }),
    /staged snapshot drifted after dirty stage/i
  );
});

test('collection service rejects experimental finalize when dirty snapshot hash is missing from the persisted plan', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  const persistedPlan = JSON.parse(await readFile(preview.plan.planPath, 'utf8')) as { expectedDirtySnapshotHash?: string };
  delete persistedPlan.expectedDirtySnapshotHash;
  await writeFile(preview.plan.planPath, `${JSON.stringify(persistedPlan, null, 2)}\n`, 'utf8');

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: true
    }),
    /requires a successful dirty stage/i
  );
});

test('collection service rejects experimental finalize when modified sidecar is missing but dirty wrapped entries remain', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  await writeFile(path.join(harness.fixture.cloudStorageDir, 'cloud-storage-namespace-1.modified.json'), '[]\n', 'utf8');

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: true
    }),
    /staged state appears corrupted/i
  );
});

test('collection service rejects experimental finalize when modified sidecar contains non-string entries', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  await writeFile(
    path.join(harness.fixture.cloudStorageDir, 'cloud-storage-namespace-1.modified.json'),
    `${JSON.stringify(['user-collections.uc-racing', 42], null, 2)}\n`,
    'utf8'
  );

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: true
    }),
    /must contain only string keys/i
  );
});

test('collection service rejects experimental finalize when modified sidecar keys do not match dirty wrapped entries', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      },
      {
        appIds: [620],
        hidden: true
      }
    ]
  });

  await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  await writeFile(
    path.join(harness.fixture.cloudStorageDir, 'cloud-storage-namespace-1.modified.json'),
    `${JSON.stringify(['user-collections.uc-racing'], null, 2)}\n`,
    'utf8'
  );

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: true
    }),
    /modified sidecar keys .* do not match dirty wrapped entries/i
  );
});

test('collection service leaves no-op experimental apply unchanged', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');
  const beforeNamespacesText = await readFile(harness.namespacePath, 'utf8');
  const beforeModifiedKeys = await readModifiedKeys(harness.sourcePath);

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [620],
        addToCollections: ['Puzzle']
      }
    ]
  });

  const result = await collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true, experimentalFinalize: false });
  assert.equal(result.backupPath, undefined);
  assert.equal(result.rollbackPath, undefined);
  assert.equal(await readFile(harness.sourcePath, 'utf8'), beforeDocumentText);
  assert.equal(await readFile(harness.namespacePath, 'utf8'), beforeNamespacesText);
  assert.deepEqual(await readModifiedKeys(harness.sourcePath), beforeModifiedKeys);
});

test('collection service finalizes cleanly after no-op dirty stage', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');
  const beforeNamespacesText = await readFile(harness.namespacePath, 'utf8');
  const beforeModifiedKeys = await readModifiedKeys(harness.sourcePath);

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [620],
        addToCollections: ['Puzzle']
      }
    ]
  });

  const dirtyResult = await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });
  const finalizeResult = await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: true
  });

  assert.equal(dirtyResult.backupPath, undefined);
  assert.equal(dirtyResult.rollbackPath, undefined);
  assert.equal(finalizeResult.backupPath, undefined);
  assert.equal(finalizeResult.rollbackPath, undefined);
  assert.equal(await readFile(harness.sourcePath, 'utf8'), beforeDocumentText);
  assert.equal(await readFile(harness.namespacePath, 'utf8'), beforeNamespacesText);
  assert.deepEqual(await readModifiedKeys(harness.sourcePath), beforeModifiedKeys);
});

test('collection service rejects experimental staged sync for object-shaped cloudstorage documents', async () => {
  const harness = await createCollectionServiceHarness();
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: false
    }),
    /pair-array cloudstorage format/i
  );
});

test('collection service rejects experimental finalize when namespace metadata is missing for dirty staged state', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  await writeFile(harness.namespacePath, `${JSON.stringify([[3, '0']], null, 2)}\n`, 'utf8');

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: true
    }),
    /namespace metadata is missing for a dirty staged state/i
  );
});

test('collection service rejects experimental finalize when namespace metadata is invalid for dirty staged state', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  await writeFile(harness.namespacePath, `${JSON.stringify([[1, 'bad-version'], [3, '0']], null, 2)}\n`, 'utf8');

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: true
    }),
    /namespace metadata is invalid/i
  );
});

test('collection service rolls back finalize targets when post-write content verification fails', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const previewService = harness.createCollectionService();

  const preview = await previewService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await previewService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  class CorruptingFinalizeSafetyService extends SafetyService {
    private didCorrupt = false;

    override async atomicWrite(targetPath: string, content: string): Promise<void> {
      if (!this.didCorrupt && path.basename(targetPath).toLowerCase() === 'cloud-storage-namespace-1.json') {
        this.didCorrupt = true;
        await super.atomicWrite(targetPath, `${content}\nCORRUPTED`);
        return;
      }

      await super.atomicWrite(targetPath, content);
    }
  }

  const collectionService = harness.createCollectionService(new CorruptingFinalizeSafetyService(async () => false));
  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');
  const beforeNamespacesText = await readFile(harness.namespacePath, 'utf8');
  const beforeModifiedKeys = await readModifiedKeys(harness.sourcePath);

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: true
    }),
    /did not match the expected content/i
  );

  assert.equal(await readFile(harness.sourcePath, 'utf8'), beforeDocumentText);
  assert.equal(await readFile(harness.namespacePath, 'utf8'), beforeNamespacesText);
  assert.deepEqual(await readModifiedKeys(harness.sourcePath), beforeModifiedKeys);
});

test('collection service requires Steam to be closed for experimental staged calls', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const collectionService = harness.createCollectionService();

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: false,
      experimentalFinalize: false
    }),
    /requires Steam to be closed/i
  );

  await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: false,
      experimentalFinalize: true
    }),
    /requires Steam to be closed/i
  );
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

test('collection service rolls back dirty targets when dirty write fails', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);

  class FailingDirtySafetyService extends SafetyService {
    override async atomicWrite(targetPath: string, content: string): Promise<void> {
      if (path.basename(targetPath).toLowerCase() === 'cloud-storage-namespace-1.modified.json') {
        throw new Error('dirty write failed');
      }

      await super.atomicWrite(targetPath, content);
    }
  }

  const collectionService = harness.createCollectionService(new FailingDirtySafetyService(async () => false));
  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');
  const beforeNamespacesText = await readFile(harness.namespacePath, 'utf8');
  const beforeModifiedKeys = await readModifiedKeys(harness.sourcePath);

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });
  const beforePlanFileText = await readFile(preview.plan.planPath, 'utf8');

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true, experimentalFinalize: false }),
    /dirty write failed/
  );

  assert.equal(await readFile(harness.sourcePath, 'utf8'), beforeDocumentText);
  assert.equal(await readFile(harness.namespacePath, 'utf8'), beforeNamespacesText);
  assert.deepEqual(await readModifiedKeys(harness.sourcePath), beforeModifiedKeys);
  assert.equal(await readFile(preview.plan.planPath, 'utf8'), beforePlanFileText);
});

test('collection service leaves plan file unchanged on no-op dirty stage', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);

  const collectionService = harness.createCollectionService();
  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [620],
        addToCollections: ['Puzzle']
      }
    ]
  });

  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');
  const beforeNamespacesText = await readFile(harness.namespacePath, 'utf8');
  const beforeModifiedKeys = await readModifiedKeys(harness.sourcePath);
  const beforePlanFileText = await readFile(preview.plan.planPath, 'utf8');

  const result = await collectionService.applyPlan(preview.plan.planId, {
    dryRun: false,
    requireSteamClosed: true,
    experimentalFinalize: false
  });

  assert.equal(result.backupPath, undefined);
  assert.equal(result.rollbackPath, undefined);
  assert.equal(await readFile(harness.sourcePath, 'utf8'), beforeDocumentText);
  assert.equal(await readFile(harness.namespacePath, 'utf8'), beforeNamespacesText);
  assert.deepEqual(await readModifiedKeys(harness.sourcePath), beforeModifiedKeys);
  assert.equal(await readFile(preview.plan.planPath, 'utf8'), beforePlanFileText);
});

test('safety service rollback does not delete a file that was not written by the failing transaction', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot, true);
  const safetyService = new SafetyService(async () => false);
  const targetPath = path.join(fixture.cloudStorageDir, 'cloud-storage-namespace-1.modified.json');

  await writeFile(targetPath, '["external"]\n', 'utf8');
  await safetyService.rollback(targetPath, null, new Set());

  assert.equal(await readFile(targetPath, 'utf8'), '["external"]\n');
});

test('collection service deletes a newly created modified sidecar during partial-write rollback', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);

  const modifiedPath = path.join(harness.fixture.cloudStorageDir, 'cloud-storage-namespace-1.modified.json');
  await rm(modifiedPath, { force: true });

  class FailingNamespaceAfterDirtySafetyService extends SafetyService {
    override async atomicWrite(targetPath: string, content: string): Promise<void> {
      if (path.basename(targetPath).toLowerCase() === 'cloud-storage-namespaces.json') {
        throw new Error('namespace write failed');
      }

      await super.atomicWrite(targetPath, content);
    }
  }

  const collectionService = harness.createCollectionService(new FailingNamespaceAfterDirtySafetyService(async () => false));
  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');
  const beforeNamespacesText = await readFile(harness.namespacePath, 'utf8');

  const preview = await collectionService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, {
      dryRun: false,
      requireSteamClosed: true,
      experimentalFinalize: false
    }),
    /namespace write failed/
  );

  assert.equal(await readFile(harness.sourcePath, 'utf8'), beforeDocumentText);
  assert.equal(await readFile(harness.namespacePath, 'utf8'), beforeNamespacesText);
  await assert.rejects(
    () => readFile(modifiedPath, 'utf8'),
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
  );
});

test('collection service rolls back finalize targets when finalize write fails', async () => {
  const harness = await createCollectionServiceHarness();
  await rewriteCloudstorageAsPairArray(harness.sourcePath);
  const previewService = harness.createCollectionService();

  const preview = await previewService.createPlan({
    mode: 'merge',
    rules: [
      {
        appIds: [440],
        addToCollections: ['Racing']
      }
    ]
  });

  await previewService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true, experimentalFinalize: false });

  class FailingFinalizeSafetyService extends SafetyService {
    override async atomicWrite(targetPath: string, content: string): Promise<void> {
      if (path.basename(targetPath).toLowerCase() === 'cloud-storage-namespace-1.modified.json') {
        throw new Error('finalize write failed');
      }

      await super.atomicWrite(targetPath, content);
    }
  }

  const collectionService = harness.createCollectionService(new FailingFinalizeSafetyService(async () => false));
  const beforeDocumentText = await readFile(harness.sourcePath, 'utf8');
  const beforeNamespacesText = await readFile(harness.namespacePath, 'utf8');
  const beforeModifiedKeys = await readModifiedKeys(harness.sourcePath);

  await assert.rejects(
    () => collectionService.applyPlan(preview.plan.planId, { dryRun: false, requireSteamClosed: true, experimentalFinalize: true }),
    /finalize write failed/
  );

  assert.equal(await readFile(harness.sourcePath, 'utf8'), beforeDocumentText);
  assert.equal(await readFile(harness.namespacePath, 'utf8'), beforeNamespacesText);
  assert.deepEqual(await readModifiedKeys(harness.sourcePath), beforeModifiedKeys);
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

test('collection service rejects write targets whose cloudstorage directory resolves outside the selected Steam user dir', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot, true);
  const configService = new ConfigService(fixture.env);
  const realCloudStorageDir = fixture.cloudStorageDir;
  const rogueCloudStorageDir = path.join(fixture.rootDir, 'rogue-cloudstorage');
  const userConfigDir = path.join(fixture.installDir, 'userdata', fixture.steamId, 'config');
  const junctionPath = path.join(userConfigDir, 'cloudstorage');

  await mkdir(rogueCloudStorageDir, { recursive: true });
  await writeFile(path.join(rogueCloudStorageDir, 'cloud-storage-namespace-1.json'), await readFile(path.join(realCloudStorageDir, 'cloud-storage-namespace-1.json'), 'utf8'), 'utf8');
  await writeFile(path.join(rogueCloudStorageDir, 'cloud-storage-namespaces.json'), await readFile(path.join(realCloudStorageDir, 'cloud-storage-namespaces.json'), 'utf8'), 'utf8');
  await writeFile(path.join(rogueCloudStorageDir, 'cloud-storage-namespace-1.modified.json'), '[]\n', 'utf8');

  await rm(junctionPath, { recursive: true, force: true });
  await symlink(rogueCloudStorageDir, junctionPath, 'junction');

  try {
    const discovery = new SteamDiscoveryService(configService.resolve());
    const sourcePath = path.join(junctionPath, 'cloud-storage-namespace-1.json');
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
      rules: [{
        appIds: [620],
        addToCollections: ['Co-op']
      }]
    });

    await assert.rejects(
      () => collectionService.applyPlan(preview.plan.planId, { requireSteamClosed: true }),
      /Steam cloudstorage directory real path .* escapes root/
    );
  } finally {
    await rm(junctionPath, { recursive: true, force: true });
    await mkdir(realCloudStorageDir, { recursive: true });
    await writeFile(path.join(realCloudStorageDir, 'cloud-storage-namespace-1.json'), await readFile(path.join(rogueCloudStorageDir, 'cloud-storage-namespace-1.json'), 'utf8'), 'utf8');
    await writeFile(path.join(realCloudStorageDir, 'cloud-storage-namespaces.json'), await readFile(path.join(rogueCloudStorageDir, 'cloud-storage-namespaces.json'), 'utf8'), 'utf8');
    await writeFile(path.join(realCloudStorageDir, 'cloud-storage-namespace-1.modified.json'), '[]\n', 'utf8');
  }
});

test('safety service rollbackMany attempts all targets and surfaces aggregate failure', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot, true);
  const targetOne = path.join(fixture.cloudStorageDir, 'cloud-storage-namespace-1.json');
  const targetTwo = path.join(fixture.cloudStorageDir, 'cloud-storage-namespaces.json');
  const backupOne = path.join(fixture.rootDir, 'backup-one.json');
  const backupTwo = path.join(fixture.rootDir, 'backup-two.json');

  await writeFile(backupOne, 'one', 'utf8');
  await writeFile(backupTwo, 'two', 'utf8');

  class PartiallyFailingRollbackSafetyService extends SafetyService {
    override async rollback(targetPath: string, backupPath: string | null, writtenTargetPaths?: Set<string>): Promise<void> {
      if (path.basename(targetPath).toLowerCase() === 'cloud-storage-namespace-1.json') {
        throw new Error('first rollback failed');
      }

      await super.rollback(targetPath, backupPath, writtenTargetPaths);
    }
  }

  const safetyService = new PartiallyFailingRollbackSafetyService(async () => false);

  await assert.rejects(
    () => safetyService.rollbackMany({
      [targetOne]: backupOne,
      [targetTwo]: backupTwo
    }),
    (error: AggregateError) => {
      assert.match(error.message, /Collection rollback failed for 1 target/);
      return true;
    }
  );

  assert.equal(await readFile(targetTwo, 'utf8'), 'two');
});
