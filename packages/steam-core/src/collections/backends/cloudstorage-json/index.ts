import { readFile } from 'node:fs/promises';
import type { CollectionPlan, CollectionSnapshot } from '../../../types.js';
import { appIdString, hashValue, isRecord, normalizeAbsolutePath, parseJson, slugify, stableStringify, toBoolean, uniqueStrings } from '../../../utils.js';
import type { CollectionBackendAdapter, CollectionBackendApplyDraft } from '../../types.js';

type CloudStorageDocument = Record<string, unknown>;

export class CloudStorageJsonCollectionBackend implements CollectionBackendAdapter {
  readonly backendId = 'cloudstorage-json';
  private readonly sourcePath: string;

  constructor(sourcePath: string, private readonly steamId: string) {
    this.sourcePath = normalizeAbsolutePath(sourcePath);
  }

  async detect(): Promise<boolean> {
    try {
      await readFile(this.sourcePath, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  async readSnapshot(): Promise<CollectionSnapshot> {
    const document = await this.readDocument();
    return buildSnapshot(document, this.sourcePath, this.steamId, this.backendId);
  }

  validatePlan(plan: CollectionPlan, snapshot: CollectionSnapshot): string[] {
    const warnings: string[] = [];

    if (plan.backendId !== this.backendId) {
      warnings.push(`Plan backend ${plan.backendId} does not match ${this.backendId}.`);
    }

    if (plan.steamId !== snapshot.steamId) {
      warnings.push(`Plan steamId ${plan.steamId} does not match current steamId ${snapshot.steamId}.`);
    }

    if (plan.snapshotHash !== snapshot.snapshotHash) {
      warnings.push('Snapshot hash drift detected.');
    }

    return warnings;
  }

  async applyPlan(plan: CollectionPlan, snapshot: CollectionSnapshot): Promise<CollectionBackendApplyDraft> {
    const document = await this.readDocument();
    const nextDocument = updateDocument(document, plan, snapshot);
    const nextSnapshot = buildSnapshot(nextDocument, this.sourcePath, this.steamId, this.backendId);

    return {
      nextDocument: `${JSON.stringify(nextDocument, null, 2)}\n`,
      expectedSnapshotHash: nextSnapshot.snapshotHash
    };
  }

  private async readDocument(): Promise<CloudStorageDocument> {
    const text = await readFile(this.sourcePath, 'utf8');
    const parsed = parseJson(text);
    if (!isRecord(parsed)) {
      throw new Error(`Collection backend file ${this.sourcePath} is not a JSON object.`);
    }

    return parsed;
  }
}

function buildSnapshot(
  document: CloudStorageDocument,
  sourcePath: string,
  steamId: string,
  backendId: string
): CollectionSnapshot {
  const favorites = membershipFromValue(document['user-collections.favorite']);
  const hidden = membershipFromValue(document['user-collections.hidden']);
  const collectionsByApp = new Map<string, Set<string>>();
  const backendKeyMap: Record<string, string> = {};

  for (const [key, value] of Object.entries(document)) {
    if (!key.startsWith('user-collections.uc-')) {
      continue;
    }

    const collectionName = readCollectionName(key, value);
    backendKeyMap[collectionName] = key;

    for (const appId of membershipFromValue(value)) {
      const current = collectionsByApp.get(appId) ?? new Set<string>();
      current.add(collectionName);
      collectionsByApp.set(appId, current);
    }
  }

  const normalizedCollectionsByApp = Object.fromEntries(
    [...collectionsByApp.entries()].map(([appId, collections]) => [appId, uniqueStrings(collections)])
  );
  const favoritesByApp = Object.fromEntries([...favorites].map((appId) => [appId, true]));
  const hiddenByApp = Object.fromEntries([...hidden].map((appId) => [appId, true]));

  const snapshotHash = hashValue({
    favoritesByApp,
    hiddenByApp,
    collectionsByApp: normalizedCollectionsByApp
  });

  return {
    backendId,
    sourcePath,
    steamId,
    snapshotHash,
    collectionsByApp: normalizedCollectionsByApp,
    favoritesByApp,
    hiddenByApp,
    rawMetadata: {
      backendKeyMap
    }
  };
}

function membershipFromValue(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(value.flatMap((entry) => (typeof entry === 'number' || typeof entry === 'string') ? [String(entry)] : []));
  }

  if (isRecord(value)) {
    const nestedContainers = ['apps', 'appids', 'items', 'entries'];
    for (const key of nestedContainers) {
      if (key in value) {
        return membershipFromValue(value[key]);
      }
    }

    const result = new Set<string>();
    for (const [key, entry] of Object.entries(value)) {
      if (/^\d+$/.test(key) && toBoolean(entry) !== false) {
        result.add(key);
      }
    }

    return result;
  }

  return new Set<string>();
}

function readCollectionName(key: string, value: unknown): string {
  if (isRecord(value)) {
    if (typeof value.name === 'string' && value.name.trim() !== '') {
      return value.name;
    }

    if (typeof value.title === 'string' && value.title.trim() !== '') {
      return value.title;
    }
  }

  return key.replace('user-collections.uc-', '');
}

function updateDocument(document: CloudStorageDocument, plan: CollectionPlan, snapshot: CollectionSnapshot): CloudStorageDocument {
  const nextDocument = structuredClone(document);

  const favorites = new Set<string>(Object.keys(snapshot.favoritesByApp).filter((appId) => snapshot.favoritesByApp[appId]));
  const hidden = new Set<string>(Object.keys(snapshot.hiddenByApp).filter((appId) => snapshot.hiddenByApp[appId]));
  const collections = new Map<string, Set<string>>();

  for (const [appId, collectionNames] of Object.entries(snapshot.collectionsByApp)) {
    collections.set(appId, new Set(collectionNames));
  }

  for (const operation of Object.values(plan.operations)) {
    const appId = appIdString(operation.appId);
    const currentCollections = collections.get(appId) ?? new Set<string>();

    if (operation.favorite !== undefined) {
      if (operation.favorite) {
        favorites.add(appId);
      } else {
        favorites.delete(appId);
      }
    }

    if (operation.hidden !== undefined) {
      if (operation.hidden) {
        hidden.add(appId);
      } else {
        hidden.delete(appId);
      }
    }

    if (operation.collectionsSet) {
      currentCollections.clear();
      for (const collectionName of operation.collectionsSet) {
        currentCollections.add(collectionName);
      }
    }

    for (const collectionName of operation.collectionsToAdd ?? []) {
      currentCollections.add(collectionName);
    }

    for (const collectionName of operation.collectionsToRemove ?? []) {
      currentCollections.delete(collectionName);
    }

    collections.set(appId, currentCollections);
  }

  nextDocument['user-collections.favorite'] = rewriteMembershipValue(nextDocument['user-collections.favorite'], favorites);
  nextDocument['user-collections.hidden'] = rewriteMembershipValue(nextDocument['user-collections.hidden'], hidden);

  const collectionNames = uniqueStrings(new Set([...Object.values(snapshot.collectionsByApp).flat(), ...[...collections.values()].flatMap((set) => [...set]) ]));
  const appsByCollection = new Map<string, Set<string>>();

  for (const [appId, collectionSet] of collections.entries()) {
    for (const collectionName of collectionSet) {
      const current = appsByCollection.get(collectionName) ?? new Set<string>();
      current.add(appId);
      appsByCollection.set(collectionName, current);
    }
  }

  for (const collectionName of collectionNames) {
    const backendKey = snapshot.rawMetadata.backendKeyMap[collectionName] ?? `user-collections.uc-${slugify(collectionName)}`;
    const existingValue = nextDocument[backendKey];
    nextDocument[backendKey] = rewriteNamedCollectionValue(existingValue, collectionName, appsByCollection.get(collectionName) ?? new Set<string>());
  }

  return nextDocument;
}

function rewriteMembershipValue(original: unknown, members: Set<string>): unknown {
  const sortedMembers = uniqueStrings(members);

  if (Array.isArray(original)) {
    return sortedMembers;
  }

  if (isRecord(original)) {
    const numericKeys = Object.keys(original).filter((key) => /^\d+$/.test(key));
    if (numericKeys.length > 0) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(original)) {
        if (!/^\d+$/.test(key)) {
          result[key] = value;
        }
      }

      for (const member of sortedMembers) {
        result[member] = member in original ? original[member] : true;
      }

      return result;
    }

    for (const nestedKey of ['apps', 'appids', 'items', 'entries']) {
      if (nestedKey in original) {
        return {
          ...original,
          [nestedKey]: rewriteMembershipValue(original[nestedKey], members)
        };
      }
    }
  }

  return sortedMembers;
}

function rewriteNamedCollectionValue(original: unknown, collectionName: string, members: Set<string>): unknown {
  const sortedMembers = uniqueStrings(members);

  if (isRecord(original)) {
    for (const nestedKey of ['apps', 'appids', 'items', 'entries']) {
      if (nestedKey in original) {
        return {
          ...original,
          name: typeof original.name === 'string' ? original.name : collectionName,
          [nestedKey]: rewriteMembershipValue(original[nestedKey], members)
        };
      }
    }

    const numericKeys = Object.keys(original).filter((key) => /^\d+$/.test(key));
    if (numericKeys.length > 0) {
      return rewriteMembershipValue({ ...original, name: original.name ?? collectionName }, members);
    }

    return {
      ...original,
      name: typeof original.name === 'string' ? original.name : collectionName,
      apps: sortedMembers
    };
  }

  return {
    name: collectionName,
    apps: sortedMembers
  };
}

export const cloudStorageJsonInternals = {
  buildSnapshot,
  membershipFromValue,
  updateDocument,
  stableStringify
};
