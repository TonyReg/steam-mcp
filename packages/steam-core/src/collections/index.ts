import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '../config/index.js';
import type { LibraryService } from '../library/index.js';
import type { SearchService } from '../search/index.js';
import type {
  CollectionApplyOptions,
  CollectionApplyResult,
  CollectionPlan,
  CollectionPlanPolicies,
  CollectionPlanPreview,
  CollectionPlanRequest,
  CollectionRule,
  CollectionSnapshot,
  GameRecord,
  PlanMode
} from '../types.js';
import { appIdString, ensurePathInsideRoot, normalizeCollectionName, normalizeUuid, nowIso, toCollectionNameSet, uniqueCollectionNames, uniqueStrings } from '../utils.js';
import type { SteamDiscoveryService } from '../discovery/index.js';
import type { SafetyService } from '../safety/index.js';
import type { CollectionBackendRegistry } from './backend-registry/index.js';

export class CollectionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly discoveryService: SteamDiscoveryService,
    private readonly backendRegistry: CollectionBackendRegistry,
    private readonly libraryService: LibraryService,
    private readonly searchService: SearchService,
    private readonly safetyService: SafetyService
  ) {}

  async createPlan(request: CollectionPlanRequest): Promise<CollectionPlanPreview> {
    const config = this.configService.resolve();
    const discovery = await this.discoveryService.discover();
    if (!discovery.selectedUserId || !discovery.collectionBackendId || !discovery.collectionSourcePath) {
      throw new Error('No selected Steam user with a cloudstorage-json backend is available for planning.');
    }

    const backend = this.backendRegistry.resolve(
      discovery.collectionBackendId,
      discovery.collectionSourcePath,
      discovery.selectedUserId
    );
    if (!backend) {
      throw new Error(`Collection backend ${discovery.collectionBackendId} is not registered.`);
    }

    const policies = normalizePolicies({
      readOnlyCollections: [...config.defaultReadOnlyCollections, ...(request.readOnlyCollections ?? [])],
      ignoreCollections: [...config.defaultIgnoreCollections, ...(request.ignoreCollections ?? [])]
    });

    const [snapshot, library] = await Promise.all([
      backend.readSnapshot(),
      this.libraryService.list({
        includeStoreMetadata: true,
        includeDeckStatus: false,
        ignoreCollections: policies.ignoreCollections,
        limit: 5000
      })
    ]);
    const mode = request.mode ?? 'add-only';
    const rules = normalizeRules(request);
    const warnings = [...snapshot.sourcePath ? [] : ['Collection source path is missing.']];
    const operations: CollectionPlan['operations'] = {};
    const matchedGames: GameRecord[] = [];
    const collectionDeletes = collectCollectionDeletes(rules, mode, policies, snapshot, warnings);

    for (const rule of rules) {
      const resolvedGames = await this.resolveRuleGames(rule, library.games);
      for (const game of resolvedGames) {
        matchedGames.push(game);
        const key = appIdString(game.appId);
        const current = operations[key] ?? { appId: game.appId };
        const next = applyRuleToOperation(current, rule, mode, policies, warnings);
        operations[key] = next;
      }
    }

    assertNoCollectionDeleteConflicts(collectionDeletes, operations);

    const destructive = mode === 'replace'
      || collectionDeletes.length > 0
      || Object.values(operations).some((operation) => (operation.collectionsToRemove?.length ?? 0) > 0 || operation.hidden === false);
    if (destructive) {
      warnings.push('Plan contains destructive changes. Review carefully before apply.');
    }

    const directories = await this.configService.ensureStateDirectories();
    const planId = randomUUID();
    const plan: CollectionPlan = {
      planId,
      createdAt: nowIso(),
      backendId: snapshot.backendId,
      steamId: discovery.selectedUserId,
      snapshotHash: snapshot.snapshotHash,
      mode,
      operations,
      collectionDeletes,
      policies,
      warnings: uniqueStrings(warnings),
      sourceRequest: request.request,
      planPath: this.resolvePlanPath(planId, directories.plansDir)
    };

    await writeFile(plan.planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

    return {
      plan,
      matchedGames: uniqueGames(matchedGames),
      destructive
    };
  }

  async applyPlan(planId: string, options: CollectionApplyOptions = {}): Promise<CollectionApplyResult> {
    const normalizedPlanId = normalizeUuid(planId, 'planId');
    const config = this.configService.resolve();
    const discovery = await this.discoveryService.discover();

    if (!config.collectionWritesEnabled) {
      throw new Error('Collection writes are disabled. Set STEAM_ENABLE_COLLECTION_WRITES=1 to enable steam_collection_apply.');
    }

    if (!discovery.selectedUserId || !discovery.selectedUserDir || !discovery.collectionBackendId || !discovery.collectionSourcePath) {
      throw new Error('No writable cloudstorage-json backend is available for the selected Steam user.');
    }

    const writableDiscovery = discovery as typeof discovery & {
      selectedUserId: string;
      selectedUserDir: string;
      collectionBackendId: string;
      collectionSourcePath: string;
    };

    if (options.requireSteamClosed === false) {
      throw new Error('Staged collection sync requires Steam to be closed; omit requireSteamClosed=false for dirty/finalize calls.');
    }

    const windowsOrchestrationSupported = this.safetyService.isWindowsOrchestrationSupported();

    if (options.dryRun) {
      return this.applyPlanInner(normalizedPlanId, config, writableDiscovery, options);
    }

    if (config.windowsOrchestrationEnabled && !windowsOrchestrationSupported) {
      throw new Error('Windows orchestration is enabled, but this runtime is not supported. Disable STEAM_ENABLE_WINDOWS_ORCHESTRATION or close Steam manually before calling steam_collection_apply.');
    }

    const windowsOrchestrationActive = config.windowsOrchestrationEnabled && windowsOrchestrationSupported;
    const steamRunning = await this.safetyService.isSteamRunning();

    if (!windowsOrchestrationActive) {
      if (steamRunning) {
        throw new Error('Steam appears to be running. Close Steam before calling steam_collection_apply.');
      }

      return this.applyPlanInner(normalizedPlanId, config, writableDiscovery, options);
    }

    let stoppedByWrapper = false;

    if (steamRunning) {
      await this.safetyService.stopSteamBestEffort();
      const steamStopped = await this.safetyService.waitForSteamStopped();
      if (!steamStopped) {
        throw new Error('Steam appears to be running. Windows orchestration could not confirm shutdown before steam_collection_apply.');
      }

      stoppedByWrapper = true;
    }

    try {
      return await this.applyPlanInner(normalizedPlanId, config, writableDiscovery, options);
    } finally {
      if (stoppedByWrapper) {
        await this.safelyRestartSteamAfterApply();
      }
    }
  }

  async readPlan(planId: string): Promise<CollectionPlan> {
    const config = this.configService.resolve();
    const planPath = this.resolvePlanPath(planId, config.stateDirectories.plansDir);
    return JSON.parse(await readFile(planPath, 'utf8')) as CollectionPlan;
  }

  private async applyPlanInner(
    normalizedPlanId: string,
    config: ReturnType<ConfigService['resolve']>,
    discovery: Awaited<ReturnType<SteamDiscoveryService['discover']>> & {
      selectedUserId: string;
      selectedUserDir: string;
      collectionBackendId: string;
      collectionSourcePath: string;
    },
    options: CollectionApplyOptions
  ): Promise<CollectionApplyResult> {
    const backend = this.backendRegistry.resolve(
      discovery.collectionBackendId,
      discovery.collectionSourcePath,
      discovery.selectedUserId
    );
    if (!backend) {
      throw new Error(`Collection backend ${discovery.collectionBackendId} is not registered.`);
    }

    const planPath = this.resolvePlanPath(normalizedPlanId, config.stateDirectories.plansDir);
    const persistedPlan = JSON.parse(await readFile(planPath, 'utf8')) as CollectionPlan;
    const plan = normalizePersistedPlan(persistedPlan);
    const snapshot = await backend.readSnapshot();
    const rawValidationWarnings = backend.validatePlan(plan, snapshot);
    const validationWarnings = rawValidationWarnings.filter((warning) => !(
      options.finalize === true
      && warning === 'Snapshot hash drift detected.'
    ));
    if (validationWarnings.length > 0) {
      throw new Error(validationWarnings.join(' '));
    }
    const appliedOperationCount = Object.keys(plan.operations).length;
    if (options.dryRun) {
      return {
        planId: normalizedPlanId,
        dryRun: true,
        backendId: backend.backendId,
        appliedOperationCount,
        warnings: plan.warnings,
        skipped: []
      };
    }

    await this.safetyService.assertCollectionWriteTarget(discovery.collectionSourcePath, discovery.selectedUserDir);
    const draft = await backend.applyPlan(plan, snapshot, { finalize: options.finalize });
    const stageWrites = options.finalize === true ? draft.finalizeWrites : draft.dirtyWrites;
    const hasPendingFinalizeWarning = (draft.finalizeWarnings?.length ?? 0) > 0;
    const noOpStage = stageWrites.length === 0;

    if (options.finalize === true && !noOpStage) {
      if (!plan.expectedDirtySnapshotHash) {
        throw new Error('Finalize requires a successful dirty stage with a persisted expectedDirtySnapshotHash.');
      }

      if (snapshot.snapshotHash !== plan.expectedDirtySnapshotHash) {
        throw new Error('Finalize cannot continue because the staged snapshot drifted after dirty stage.');
      }
    }

    const planWrite = options.finalize !== true && stageWrites.length > 0 && draft.expectedDirtySnapshotHash
      ? {
          targetPath: planPath,
          content: `${JSON.stringify({
            ...plan,
            expectedDirtySnapshotHash: draft.expectedDirtySnapshotHash
          } satisfies CollectionPlan, null, 2)}\n`
        }
      : undefined;

    if (noOpStage && planWrite === undefined) {
      return {
        planId: normalizedPlanId,
        dryRun: false,
        backendId: backend.backendId,
        appliedOperationCount,
        warnings: options.finalize === true ? plan.warnings : [...plan.warnings, ...(hasPendingFinalizeWarning ? draft.finalizeWarnings ?? [] : [])],
        skipped: []
      };
    }

    const targetPaths = stageWrites.length === 0
      ? []
      : await this.safetyService.assertCollectionWriteTargets(
          stageWrites.map((write) => write.targetPath),
          discovery.selectedUserDir
        );
    if (stageWrites.length > 0 && (targetPaths.length !== stageWrites.length || targetPaths[0] === undefined)) {
      throw new Error('Collection backend returned an invalid write target set.');
    }

    const writes = stageWrites.map((write, index) => ({
      ...write,
      targetPath: targetPaths[index] ?? write.targetPath
    }));

    const rollbackPath = targetPaths[0];
    const backupTargets = planWrite ? [...targetPaths, planPath] : targetPaths;
    const backupsByTargetPath = backupTargets.length === 0
      ? {}
      : await this.safetyService.createBackups(backupTargets, config.stateDirectories.backupsDir);
    const writesWithPlan = planWrite ? [...writes, planWrite] : writes;
    let writtenTargetPaths: string[] = [];

    try {
      writtenTargetPaths = await this.safetyService.atomicWriteMany(writesWithPlan);
      await Promise.all(writesWithPlan.map(async (write) => {
        const actualContent = await readFile(write.targetPath, 'utf8');
        if (actualContent !== write.content) {
          throw new Error(`Post-write verification failed because ${write.targetPath} did not match the expected content.`);
        }
      }));
      const verifySnapshot = await backend.readSnapshot();
      const expectedSnapshotHash = options.finalize === true
        ? draft.expectedFinalSnapshotHash
        : draft.expectedDirtySnapshotHash ?? draft.expectedFinalSnapshotHash;
      if (verifySnapshot.snapshotHash !== expectedSnapshotHash) {
        throw new Error('Post-write verification failed because the snapshot hash did not match the expected result.');
      }

      return {
        planId: normalizedPlanId,
        dryRun: false,
        backendId: backend.backendId,
        appliedOperationCount,
        backupPath: rollbackPath ? backupsByTargetPath[rollbackPath] ?? undefined : undefined,
        rollbackPath,
        warnings: [...plan.warnings, ...(hasPendingFinalizeWarning ? draft.finalizeWarnings ?? [] : [])],
        skipped: []
      };
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      const rollbackWrittenTargetPaths = (originalError as Error & { writtenTargetPaths?: string[] }).writtenTargetPaths ?? writtenTargetPaths;

      try {
        await this.safetyService.rollbackMany(backupsByTargetPath, rollbackWrittenTargetPaths);
      } catch (rollbackError) {
        const typedOriginalError = originalError as Error & { cause?: unknown; rollbackError?: unknown };
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        if (typedOriginalError.cause === undefined) {
          typedOriginalError.cause = rollbackError;
        }
        typedOriginalError.rollbackError = rollbackError;
        typedOriginalError.message = `${typedOriginalError.message} (rollback also failed: ${rollbackMessage})`;
      }

      throw originalError;
    }
  }

  private async safelyRestartSteamAfterApply(): Promise<void> {
    try {
      await this.safetyService.startSteamBestEffort();
    } catch {
      // Best-effort only.
    }
  }

  private resolvePlanPath(planId: string, plansDir: string): string {
    const normalizedPlanId = normalizeUuid(planId, 'planId');
    return ensurePathInsideRoot(path.join(plansDir, `${normalizedPlanId}.json`), plansDir, 'Collection plan path');
  }

  private async resolveRuleGames(rule: CollectionRule, library: GameRecord[]): Promise<GameRecord[]> {
    const explicitGames = rule.appIds?.map((appId) => library.find((game) => game.appId === appId)).filter((game): game is GameRecord => game !== undefined) ?? [];
    const searchedGames = rule.query ? this.searchService.searchLibrary(library, { query: rule.query, limit: 100 }).map((match) => match.item) : [];
    return uniqueGames([...explicitGames, ...searchedGames]);
  }
}

function normalizeRules(request: CollectionPlanRequest): CollectionRule[] {
  if (request.rules?.length) {
    return request.rules;
  }

  if (request.request && request.request.trim() !== '') {
    return [{
      query: request.request,
      collection: request.request
    }];
  }

  throw new Error('Collection planning requires either explicit rules or a non-empty request string.');
}

function normalizePolicies(request: Pick<CollectionPlanRequest, 'readOnlyCollections' | 'ignoreCollections'>): CollectionPlanPolicies {
  return {
    readOnlyCollections: uniqueCollectionNames(request.readOnlyCollections ?? []),
    ignoreCollections: uniqueCollectionNames(request.ignoreCollections ?? [])
  };
}

function normalizePersistedPlan(plan: CollectionPlan): CollectionPlan {
  return {
    ...plan,
    collectionDeletes: uniqueCollectionNames(plan.collectionDeletes ?? []),
    policies: normalizePolicies(plan.policies ?? { readOnlyCollections: [], ignoreCollections: [] })
  };
}

function resolveSnapshotDisplayName(collectionName: string, snapshot: CollectionSnapshot): string {
  return snapshot.rawMetadata.displayNameMap[normalizeCollectionName(collectionName)] ?? collectionName.trim();
}

function collectCollectionDeletes(
  rules: CollectionRule[],
  mode: PlanMode,
  policies: CollectionPlanPolicies,
  snapshot: CollectionSnapshot,
  warnings: string[]
): string[] {
  const protectedCollections = new Set<string>([
    ...toCollectionNameSet(policies.readOnlyCollections),
    ...toCollectionNameSet(policies.ignoreCollections)
  ]);
  const deletedCollections: string[] = [];

  for (const rule of rules) {
    for (const collectionName of uniqueCollectionNames(rule.deleteCollections ?? [])) {
      const canonicalCollectionName = normalizeCollectionName(collectionName);
      if (canonicalCollectionName === 'favorite' || canonicalCollectionName === 'hidden') {
        throw new Error(`Cannot delete built-in collection ${collectionName.trim()}.`);
      }

      if (mode === 'add-only') {
        warnings.push(`Ignoring destructive collection deletes in add-only mode: ${collectionName.trim()}.`);
        continue;
      }

      if (protectedCollections.has(canonicalCollectionName)) {
        warnings.push(`Ignoring protected collection ${collectionName.trim()} during delete.`);
        continue;
      }

      const collectionState = snapshot.rawMetadata.collectionStateMap[canonicalCollectionName];
      if (collectionState === 'tombstone') {
        warnings.push(`Collection ${resolveSnapshotDisplayName(collectionName, snapshot)} is already deleted.`);
        continue;
      }

      if (collectionState !== 'live') {
        warnings.push(`Collection ${collectionName.trim()} does not exist and cannot be deleted.`);
        continue;
      }

      deletedCollections.push(resolveSnapshotDisplayName(collectionName, snapshot));
    }
  }

  return uniqueCollectionNames(deletedCollections);
}

function assertNoCollectionDeleteConflicts(
  collectionDeletes: string[],
  operations: CollectionPlan['operations']
): void {
  if (collectionDeletes.length === 0) {
    return;
  }

  const deletedCanonicalNames = new Set(toCollectionNameSet(collectionDeletes));
  for (const operation of Object.values(operations)) {
    const touchedCollections = uniqueCollectionNames([
      ...(operation.collectionsToAdd ?? []),
      ...(operation.collectionsToRemove ?? []),
      ...(operation.collectionsSet ?? [])
    ]);

    for (const collectionName of touchedCollections) {
      const canonicalCollectionName = normalizeCollectionName(collectionName);
      if (deletedCanonicalNames.has(canonicalCollectionName)) {
        throw new Error(`Plan cannot both delete and modify collection ${canonicalCollectionName}.`);
      }
    }
  }
}

function applyRuleToOperation(
  operation: CollectionPlan['operations'][string],
  rule: CollectionRule,
  mode: PlanMode,
  policies: CollectionPlanPolicies,
  warnings: string[]
): CollectionPlan['operations'][string] {
  const protectedCollections = new Set<string>([
    ...toCollectionNameSet(policies.readOnlyCollections),
    ...toCollectionNameSet(policies.ignoreCollections)
  ]);
  const collectionsToAdd = applyProtectedCollectionFilter(
    uniqueCollectionNames([...(operation.collectionsToAdd ?? []), ...(rule.collection ? [rule.collection] : []), ...(rule.addToCollections ?? [])]),
    protectedCollections,
    operation.appId,
    'add',
    warnings
  );
  let nextHidden = rule.hidden ?? operation.hidden;
  let nextCollectionsToRemove = applyProtectedCollectionFilter(
    uniqueCollectionNames([...(operation.collectionsToRemove ?? []), ...(rule.removeFromCollections ?? [])]),
    protectedCollections,
    operation.appId,
    'remove',
    warnings
  );
  let nextCollectionsSet = rule.setCollections
    ? applyProtectedCollectionFilter(uniqueCollectionNames(rule.setCollections), protectedCollections, operation.appId, 'set', warnings)
    : operation.collectionsSet;

  if (mode === 'add-only') {
    if (nextHidden === false) {
      warnings.push(`Ignoring hidden=false for app ${operation.appId} in add-only mode.`);
      nextHidden = undefined;
    }

    if (nextCollectionsToRemove.length > 0 || nextCollectionsSet) {
      warnings.push(`Ignoring destructive collection changes for app ${operation.appId} in add-only mode.`);
      nextCollectionsToRemove = [];
      nextCollectionsSet = undefined;
    }
  }

  return {
    appId: operation.appId,
    ...(nextHidden !== undefined ? { hidden: nextHidden } : {}),
    ...(collectionsToAdd.length > 0 ? { collectionsToAdd } : {}),
    ...(nextCollectionsToRemove.length > 0 ? { collectionsToRemove: nextCollectionsToRemove } : {}),
    ...(nextCollectionsSet !== undefined ? { collectionsSet: nextCollectionsSet } : {})
  };
}

function applyProtectedCollectionFilter(
  collectionNames: string[],
  protectedCollections: Set<string>,
  appId: number,
  action: 'add' | 'remove' | 'set',
  warnings: string[]
): string[] {
  if (protectedCollections.size === 0) {
    return collectionNames;
  }

  return collectionNames.filter((collectionName) => {
    if (!protectedCollections.has(normalizeCollectionName(collectionName))) {
      return true;
    }

    warnings.push(`Ignoring protected collection ${collectionName} for app ${appId} during ${action}.`);
    return false;
  });
}

function uniqueGames(games: GameRecord[]): GameRecord[] {
  const byId = new Map<number, GameRecord>();
  for (const game of games) {
    byId.set(game.appId, game);
  }

  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}
