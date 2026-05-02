import { readFile } from 'node:fs/promises';
import type { CollectionPlan, CollectionSnapshot } from '../../../types.js';
import { appIdString, hashValue, isRecord, normalizeAbsolutePath, normalizeCollectionName, parseJson, slugify, stableStringify, toBoolean, toCollectionNameSet, uniqueCollectionNames, uniqueStrings } from '../../../utils.js';
import type { CollectionBackendAdapter, CollectionBackendApplyDraft } from '../../types.js';

type CloudStorageDocument = Record<string, unknown>;
type CloudStorageDocumentFormat = 'object' | 'pair-array';

const RESERVED_DOCUMENT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

interface ParsedCloudStorageDocument {
  document: CloudStorageDocument;
  format: CloudStorageDocumentFormat;
  keyOrder: string[];
}

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
    const { document } = await this.readDocument();
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
    const parsedDocument = await this.readDocument();
    const nextDocument = updateDocument(parsedDocument.document, plan, snapshot);
    const nextSnapshot = buildSnapshot(nextDocument, this.sourcePath, this.steamId, this.backendId);

    return {
      nextDocument: serializeDocument(nextDocument, parsedDocument.format, parsedDocument.keyOrder),
      expectedSnapshotHash: nextSnapshot.snapshotHash
    };
  }

  private async readDocument(): Promise<ParsedCloudStorageDocument> {
    const text = await readFile(this.sourcePath, 'utf8');
    const parsed = parseJson(text);
    return normalizeDocument(parsed, this.sourcePath);
  }
}

function normalizeDocument(parsed: unknown, sourcePath: string): ParsedCloudStorageDocument {
  if (isRecord(parsed)) {
    const document = createCloudStorageDocument();
    const keyOrder: string[] = [];

    for (const [key, value] of Object.entries(parsed)) {
      assertSafeDocumentKey(key, sourcePath);
      document[key] = value;
      keyOrder.push(key);
    }

    return {
      document,
      format: 'object',
      keyOrder
    };
  }

  if (Array.isArray(parsed)) {
    const document = createCloudStorageDocument();
    const keyOrder: string[] = [];
    const seenKeys = new Set<string>();

    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length < 2 || typeof entry[0] !== 'string') {
        throw new Error(`Collection backend file ${sourcePath} contains an unsupported array entry shape.`);
      }

      const [key, value] = entry;
      assertSafeDocumentKey(key, sourcePath);
      document[key] = value;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        keyOrder.push(key);
      }
    }

    return {
      document,
      format: 'pair-array',
      keyOrder
    };
  }

  throw new Error(`Collection backend file ${sourcePath} is not a supported JSON document.`);
}

function serializeDocument(document: CloudStorageDocument, format: CloudStorageDocumentFormat, keyOrder: string[]): string {
  if (format === 'object') {
    return `${JSON.stringify(document, null, 2)}\n`;
  }

  const seen = new Set<string>();
  const entries: Array<[string, unknown]> = [];

  for (const key of keyOrder) {
    if (Object.hasOwn(document, key)) {
      entries.push([key, wrapPairArrayValue(key, document[key])]);
      seen.add(key);
    }
  }

  for (const key of Object.keys(document)) {
    if (!seen.has(key)) {
      entries.push([key, wrapPairArrayValue(key, document[key])]);
    }
  }

  return `${JSON.stringify(entries, null, 2)}\n`;
}

function createCloudStorageDocument(): CloudStorageDocument {
  return Object.create(null) as CloudStorageDocument;
}

function assertSafeDocumentKey(key: string, sourcePath: string): void {
  if (RESERVED_DOCUMENT_KEYS.has(key)) {
    throw new Error(`Collection backend file ${sourcePath} contains reserved key ${key}.`);
  }
}

function isWrappedCloudStorageEntry(value: unknown): value is Record<string, unknown> & { key: string } {
  return isRecord(value)
    && typeof value.key === 'string'
    && ('value' in value || 'timestamp' in value || 'version' in value || 'is_deleted' in value);
}

function unwrapCollectionValue(value: unknown): unknown {
  if (!isWrappedCloudStorageEntry(value)) {
    return value;
  }

  if (toBoolean(value.is_deleted) === true && !('value' in value)) {
    return undefined;
  }

  const payload = value.value;
  if (typeof payload === 'string') {
    try {
      return parseJson(payload);
    } catch {
      return payload;
    }
  }

  return payload;
}

function wrapPairArrayValue(key: string, value: unknown): unknown {
  if (isWrappedCloudStorageEntry(value)) {
    return value;
  }

  if (!key.startsWith('user-collections.')) {
    return value;
  }

  const payload = buildPairArrayPayload(key, value);

  return {
    key,
    timestamp: Math.floor(Date.now() / 1000),
    value: JSON.stringify(payload),
    version: '1'
  };
}

function buildPairArrayPayload(key: string, value: unknown): unknown {
  if (key === 'user-collections.favorite') {
    return {
      id: 'favorite',
      name: 'Favorites',
      added: serializeMembershipArray(uniqueStrings(membershipFromValue(value)), true),
      removed: []
    };
  }

  if (key === 'user-collections.hidden') {
    return {
      id: 'hidden',
      name: 'Hidden',
      added: serializeMembershipArray(uniqueStrings(membershipFromValue(value)), true),
      removed: []
    };
  }

  if (key.startsWith('user-collections.uc-')) {
    const collectionName = readCollectionName(key, value);
    return {
      id: key.replace('user-collections.', ''),
      name: collectionName,
      added: serializeMembershipArray(uniqueStrings(membershipFromValue(value)), true),
      removed: []
    };
  }

  return value;
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
  const displayNameMap: Record<string, string> = {};

  for (const [key, value] of Object.entries(document)) {
    if (!key.startsWith('user-collections.uc-')) {
      continue;
    }

    const collectionName = readCollectionName(key, value);
    const canonicalCollectionName = normalizeCollectionName(collectionName);
    const existingDisplayName = displayNameMap[canonicalCollectionName];
    if (existingDisplayName && existingDisplayName !== collectionName) {
      throw new Error(
        `Collection backend file ${sourcePath} contains ambiguous collection names ${existingDisplayName} and ${collectionName}.`
      );
    }

    backendKeyMap[canonicalCollectionName] = key;
    displayNameMap[canonicalCollectionName] = collectionName;

    for (const appId of membershipFromValue(value)) {
      const current = collectionsByApp.get(appId) ?? new Set<string>();
      current.add(collectionName);
      collectionsByApp.set(appId, current);
    }
  }

  const normalizedCollectionsByApp = Object.fromEntries(
    [...collectionsByApp.entries()].map(([appId, collections]) => [appId, uniqueCollectionNames(collections)])
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
      backendKeyMap,
      displayNameMap
    }
  };
}

function membershipFromValue(value: unknown): Set<string> {
  const normalizedValue = unwrapCollectionValue(value);

  if (Array.isArray(normalizedValue)) {
    return new Set(normalizedValue.flatMap((entry) => (typeof entry === 'number' || typeof entry === 'string') ? [String(entry)] : []));
  }

  if (isRecord(normalizedValue)) {
    if ('added' in normalizedValue || 'removed' in normalizedValue) {
      const result = membershipFromValue(normalizedValue.added);
      for (const appId of membershipFromValue(normalizedValue.removed)) {
        result.delete(appId);
      }

      return result;
    }

    const nestedContainers = ['apps', 'appids', 'items', 'entries'];
    for (const key of nestedContainers) {
      if (key in normalizedValue) {
        return membershipFromValue(normalizedValue[key]);
      }
    }

    const result = new Set<string>();
    for (const [key, entry] of Object.entries(normalizedValue)) {
      if (/^\d+$/.test(key) && toBoolean(entry) !== false) {
        result.add(key);
      }
    }

    return result;
  }

  return new Set<string>();
}

function readCollectionName(key: string, value: unknown): string {
  const normalizedValue = unwrapCollectionValue(value);
  if (isRecord(normalizedValue)) {
    if (typeof normalizedValue.name === 'string' && normalizedValue.name.trim() !== '') {
      return normalizedValue.name;
    }

    if (typeof normalizedValue.title === 'string' && normalizedValue.title.trim() !== '') {
      return normalizedValue.title;
    }
  }

  return key.replace('user-collections.uc-', '');
}

function updateDocument(document: CloudStorageDocument, plan: CollectionPlan, snapshot: CollectionSnapshot): CloudStorageDocument {
  const nextDocument = structuredClone(document);

  const hidden = new Set<string>(Object.keys(snapshot.hiddenByApp).filter((appId) => snapshot.hiddenByApp[appId]));
  const collections = new Map<string, Set<string>>();
  const protectedGroups = new Set<string>([
    ...toCollectionNameSet(plan.policies.readOnlyGroups),
    ...toCollectionNameSet(plan.policies.ignoreGroups)
  ]);

  for (const [appId, collectionNames] of Object.entries(snapshot.collectionsByApp)) {
    collections.set(appId, new Set(collectionNames));
  }

  for (const operation of Object.values(plan.operations)) {
    const appId = appIdString(operation.appId);
    const currentCollections = collections.get(appId) ?? new Set<string>();
    const protectedMemberships = getProtectedMemberships(currentCollections, protectedGroups);

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
        if (protectedGroups.has(normalizeCollectionName(collectionName))) {
          continue;
        }

        currentCollections.add(resolveSnapshotCollectionName(collectionName, snapshot));
      }

      rehydrateProtectedMemberships(currentCollections, protectedMemberships);
    }

    for (const collectionName of operation.collectionsToAdd ?? []) {
      if (protectedGroups.has(normalizeCollectionName(collectionName))) {
        continue;
      }

      currentCollections.add(resolveSnapshotCollectionName(collectionName, snapshot));
    }

    for (const collectionName of operation.collectionsToRemove ?? []) {
      if (protectedGroups.has(normalizeCollectionName(collectionName))) {
        continue;
      }

      deleteCollectionByCanonicalName(currentCollections, collectionName);
    }

    rehydrateProtectedMemberships(currentCollections, protectedMemberships);

    collections.set(appId, currentCollections);
  }

  nextDocument['user-collections.hidden'] = rewriteMembershipValue(nextDocument['user-collections.hidden'], hidden);

  const collectionNames = uniqueCollectionNames(new Set([...Object.values(snapshot.collectionsByApp).flat(), ...[...collections.values()].flatMap((set) => [...set]) ]));
  const appsByCollection = new Map<string, Set<string>>();

  for (const [appId, collectionSet] of collections.entries()) {
    for (const collectionName of collectionSet) {
      const current = appsByCollection.get(collectionName) ?? new Set<string>();
      current.add(appId);
      appsByCollection.set(collectionName, current);
    }
  }

  for (const collectionName of collectionNames) {
    const backendKey = resolveBackendKey(collectionName, snapshot);
    const existingValue = nextDocument[backendKey];
    nextDocument[backendKey] = rewriteNamedCollectionValue(existingValue, collectionName, appsByCollection.get(collectionName) ?? new Set<string>());
  }

  return nextDocument;
}

function resolveSnapshotCollectionName(collectionName: string, snapshot: CollectionSnapshot): string {
  return snapshot.rawMetadata.displayNameMap[normalizeCollectionName(collectionName)] ?? collectionName.trim();
}

function resolveBackendKey(collectionName: string, snapshot: CollectionSnapshot): string {
  return snapshot.rawMetadata.backendKeyMap[normalizeCollectionName(collectionName)] ?? `user-collections.uc-${slugify(collectionName)}`;
}

function getProtectedMemberships(currentCollections: Set<string>, protectedGroups: Set<string>): string[] {
  if (protectedGroups.size === 0) {
    return [];
  }

  return [...currentCollections].filter((collectionName) => protectedGroups.has(normalizeCollectionName(collectionName)));
}

function rehydrateProtectedMemberships(currentCollections: Set<string>, protectedMemberships: string[]): void {
  for (const collectionName of protectedMemberships) {
    currentCollections.add(collectionName);
  }
}

function deleteCollectionByCanonicalName(currentCollections: Set<string>, collectionName: string): void {
  const normalizedCollectionName = normalizeCollectionName(collectionName);
  for (const existingCollectionName of currentCollections) {
    if (normalizeCollectionName(existingCollectionName) === normalizedCollectionName) {
      currentCollections.delete(existingCollectionName);
      return;
    }
  }
}

function rewriteMembershipValue(original: unknown, members: Set<string>): unknown {
  const sortedMembers = uniqueStrings(members);
  const normalizedOriginal = unwrapCollectionValue(original);

  if (isWrappedCloudStorageEntry(original)) {
    const nextPayload = rewriteMembershipPayload(normalizedOriginal, sortedMembers);
    const { is_deleted, ...rest } = original;
    return {
      ...rest,
      value: JSON.stringify(nextPayload)
    };
  }

  if (Array.isArray(normalizedOriginal)) {
    return sortedMembers;
  }

  if (isRecord(normalizedOriginal)) {
    const numericKeys = Object.keys(normalizedOriginal).filter((key) => /^\d+$/.test(key));
    if (numericKeys.length > 0) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(normalizedOriginal)) {
        if (!/^\d+$/.test(key)) {
          result[key] = value;
        }
      }

      for (const member of sortedMembers) {
        result[member] = member in normalizedOriginal ? normalizedOriginal[member] : true;
      }

      return result;
    }

    for (const nestedKey of ['apps', 'appids', 'items', 'entries']) {
      if (nestedKey in normalizedOriginal) {
        return {
          ...normalizedOriginal,
          [nestedKey]: rewriteMembershipValue(normalizedOriginal[nestedKey], members)
        };
      }
    }

    if ('added' in normalizedOriginal || 'removed' in normalizedOriginal) {
      return rewriteMembershipPayload(normalizedOriginal, sortedMembers);
    }
  }

  return sortedMembers;
}

function rewriteNamedCollectionValue(original: unknown, collectionName: string, members: Set<string>): unknown {
  const sortedMembers = uniqueStrings(members);
  const normalizedOriginal = unwrapCollectionValue(original);

  if (isWrappedCloudStorageEntry(original)) {
    const nextPayload = rewriteNamedCollectionPayload(normalizedOriginal, collectionName, sortedMembers, original.key);
    const { is_deleted, ...rest } = original;
    return {
      ...rest,
      value: JSON.stringify(nextPayload)
    };
  }

  if (isRecord(normalizedOriginal)) {
    for (const nestedKey of ['apps', 'appids', 'items', 'entries']) {
      if (nestedKey in normalizedOriginal) {
        return {
          ...normalizedOriginal,
          name: typeof normalizedOriginal.name === 'string' ? normalizedOriginal.name : collectionName,
          [nestedKey]: rewriteMembershipValue(normalizedOriginal[nestedKey], members)
        };
      }
    }

    const numericKeys = Object.keys(normalizedOriginal).filter((key) => /^\d+$/.test(key));
    if (numericKeys.length > 0) {
      return rewriteMembershipValue({ ...normalizedOriginal, name: normalizedOriginal.name ?? collectionName }, members);
    }

    if ('added' in normalizedOriginal || 'removed' in normalizedOriginal) {
      return rewriteNamedCollectionPayload(normalizedOriginal, collectionName, sortedMembers);
    }

    return {
      ...normalizedOriginal,
      name: typeof normalizedOriginal.name === 'string' ? normalizedOriginal.name : collectionName,
      apps: sortedMembers
    };
  }

  return {
    name: collectionName,
    apps: sortedMembers
  };
}

function rewriteMembershipPayload(original: unknown, sortedMembers: string[]): unknown {
  if (isRecord(original) && ('added' in original || 'removed' in original)) {
    return {
      ...original,
      added: serializeMembershipArray(sortedMembers, true),
      removed: []
    };
  }

  return rewriteMembershipValue(original, new Set(sortedMembers));
}

function rewriteNamedCollectionPayload(
  original: unknown,
  collectionName: string,
  sortedMembers: string[],
  wrapperKey?: string
): unknown {
  if (isRecord(original) && ('added' in original || 'removed' in original)) {
    const derivedId = typeof original.id === 'string'
      ? original.id
      : wrapperKey?.replace('user-collections.', '') ?? `uc-${slugify(collectionName)}`;

    return {
      ...original,
      id: derivedId,
      name: typeof original.name === 'string' ? original.name : collectionName,
      added: serializeMembershipArray(sortedMembers, true),
      removed: []
    };
  }

  return {
    id: wrapperKey?.replace('user-collections.', '') ?? `uc-${slugify(collectionName)}`,
    name: collectionName,
    added: serializeMembershipArray(sortedMembers, true),
    removed: []
  };
}

function serializeMembershipArray(sortedMembers: string[], preferNumeric = false): Array<string | number> {
  if (preferNumeric && sortedMembers.every((member) => /^\d+$/.test(member))) {
    return sortedMembers.map((member) => Number(member));
  }

  return sortedMembers;
}

export const cloudStorageJsonInternals = {
  buildSnapshot,
  membershipFromValue,
  normalizeDocument,
  serializeDocument,
  updateDocument,
  stableStringify
};
