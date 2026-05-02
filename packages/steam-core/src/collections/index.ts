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

    const [snapshot, library] = await Promise.all([
      backend.readSnapshot(),
      this.libraryService.list({ includeStoreMetadata: false, includeDeckStatus: false, limit: 5000 })
    ]);

    const policies = normalizePolicies(request);
    const rules = normalizeRules(request);
    const warnings = [...snapshot.sourcePath ? [] : ['Collection source path is missing.']];
    const operations: CollectionPlan['operations'] = {};
    const matchedGames: GameRecord[] = [];

    for (const rule of rules) {
      const resolvedGames = await this.resolveRuleGames(rule, library.games);
      for (const game of resolvedGames) {
        matchedGames.push(game);
        const key = appIdString(game.appId);
        const current = operations[key] ?? { appId: game.appId };
        const next = applyRuleToOperation(current, rule, request.mode ?? 'add-only', policies, warnings);
        operations[key] = next;
      }
    }

    const destructive = (request.mode ?? 'add-only') === 'replace'
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
      mode: request.mode ?? 'add-only',
      operations,
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

    if (options.requireSteamClosed !== false && await this.safetyService.isSteamRunning()) {
      throw new Error('Steam appears to be running. Close Steam or set requireSteamClosed=false explicitly.');
    }

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
    const validationWarnings = backend.validatePlan(plan, snapshot);
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

    const collectionTargetPath = this.safetyService.assertCollectionWriteTarget(discovery.collectionSourcePath, discovery.selectedUserDir);
    const backupPath = await this.safetyService.createBackup(collectionTargetPath, config.stateDirectories.backupsDir);

    try {
      const draft = await backend.applyPlan(plan, snapshot);
      await this.safetyService.atomicWrite(collectionTargetPath, draft.nextDocument);
      const verifySnapshot = await backend.readSnapshot();
      if (verifySnapshot.snapshotHash !== draft.expectedSnapshotHash) {
        throw new Error('Post-write verification failed because the snapshot hash did not match the expected result.');
      }

      return {
        planId: normalizedPlanId,
        dryRun: false,
        backendId: backend.backendId,
        appliedOperationCount,
        backupPath,
        rollbackPath: backupPath,
        warnings: plan.warnings,
        skipped: []
      };
    } catch (error) {
      await this.safetyService.rollback(collectionTargetPath, backupPath);
      throw error;
    }
  }

  async readPlan(planId: string): Promise<CollectionPlan> {
    const config = this.configService.resolve();
    const planPath = this.resolvePlanPath(planId, config.stateDirectories.plansDir);
    return JSON.parse(await readFile(planPath, 'utf8')) as CollectionPlan;
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

function normalizePolicies(request: Pick<CollectionPlanRequest, 'readOnlyGroups' | 'ignoreGroups'>): CollectionPlanPolicies {
  return {
    readOnlyGroups: uniqueCollectionNames(request.readOnlyGroups ?? []),
    ignoreGroups: uniqueCollectionNames(request.ignoreGroups ?? [])
  };
}

function normalizePersistedPlan(plan: CollectionPlan): CollectionPlan {
  return {
    ...plan,
    policies: normalizePolicies(plan.policies ?? { readOnlyGroups: [], ignoreGroups: [] })
  };
}

function applyRuleToOperation(
  operation: CollectionPlan['operations'][string],
  rule: CollectionRule,
  mode: PlanMode,
  policies: CollectionPlanPolicies,
  warnings: string[]
): CollectionPlan['operations'][string] {
  const protectedGroups = new Set<string>([
    ...toCollectionNameSet(policies.readOnlyGroups),
    ...toCollectionNameSet(policies.ignoreGroups)
  ]);
  const collectionsToAdd = applyProtectedCollectionFilter(
    uniqueCollectionNames([...(operation.collectionsToAdd ?? []), ...(rule.collection ? [rule.collection] : []), ...(rule.addToCollections ?? [])]),
    protectedGroups,
    operation.appId,
    'add',
    warnings
  );
  let nextHidden = rule.hidden ?? operation.hidden;
  let nextCollectionsToRemove = applyProtectedCollectionFilter(
    uniqueCollectionNames([...(operation.collectionsToRemove ?? []), ...(rule.removeFromCollections ?? [])]),
    protectedGroups,
    operation.appId,
    'remove',
    warnings
  );
  let nextCollectionsSet = rule.setCollections
    ? applyProtectedCollectionFilter(uniqueCollectionNames(rule.setCollections), protectedGroups, operation.appId, 'set', warnings)
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
  protectedGroups: Set<string>,
  appId: number,
  action: 'add' | 'remove' | 'set',
  warnings: string[]
): string[] {
  if (protectedGroups.size === 0) {
    return collectionNames;
  }

  return collectionNames.filter((collectionName) => {
    if (!protectedGroups.has(normalizeCollectionName(collectionName))) {
      return true;
    }

    warnings.push(`Ignoring protected group ${collectionName} for app ${appId} during ${action}.`);
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
