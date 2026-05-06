import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CollectionPlan, CollectionSnapshot } from '../../../types.js';
import { appIdString, hashValue, isRecord, normalizeAbsolutePath, normalizeCollectionName, parseJson, slugify, stableStringify, toBoolean, toCollectionNameSet, uniqueCollectionNames, uniqueStrings } from '../../../utils.js';
import type { CollectionBackendAdapter, CollectionBackendApplyDraft } from '../../types.js';

type CloudStorageDocument = Record<string, unknown>;
type CloudStorageDocumentFormat = 'object' | 'pair-array';
type WrappedVersionMode = 'current' | 'dirty' | 'final';

interface SerializeDocumentOptions {
  wrappedVersionMode?: WrappedVersionMode;
  forceWrappedKeys?: Set<string>;
}

const RESERVED_DOCUMENT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

interface ParsedCloudStorageDocument {
  document: CloudStorageDocument;
  format: CloudStorageDocumentFormat;
  keyOrder: string[];
}

interface ParsedCloudStorageNamespaceDocument {
  values: Array<[number, string]>;
  valueByNamespace: Map<number, string>;
}

const COLLECTION_NAMESPACE_ID = 1;

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

  async applyPlan(plan: CollectionPlan, snapshot: CollectionSnapshot, options: { finalize?: true } = {}): Promise<CollectionBackendApplyDraft> {
    const parsedDocument = await this.readDocument();
    if (parsedDocument.format !== 'pair-array') {
      throw new Error('Staged collection sync requires pair-array cloudstorage format.');
    }

    const nextDocument = updateDocument(parsedDocument.document, plan, snapshot);
    const nextSnapshot = buildSnapshot(nextDocument, this.sourcePath, this.steamId, this.backendId);
    const documentChanged = stableStringify(nextDocument) !== stableStringify(parsedDocument.document);
    const namespacePath = resolveNamespaceMetadataPath(this.sourcePath);
    const modifiedPath = resolveModifiedMetadataPath(this.sourcePath);
    const parsedNamespaces = await this.readNamespacesDocument(namespacePath);
    const currentNamespaceValue = parsedNamespaces.valueByNamespace.get(COLLECTION_NAMESPACE_ID);

    if (options.finalize !== true) {
      if (!documentChanged) {
        return {
          dirtyWrites: [],
          finalizeWrites: [],
          expectedDirtySnapshotHash: nextSnapshot.snapshotHash,
          expectedFinalSnapshotHash: nextSnapshot.snapshotHash
        };
      }

      const nextNamespaceValue = currentNamespaceValue === undefined ? '1' : bumpNamespaceValue(currentNamespaceValue);
      const modifiedKeys = resolveModifiedCollectionKeys(parsedDocument.document, nextDocument);
      const forcedWrappedKeys = new Set(modifiedKeys);
      const nextNamespacesDocument = updateNamespacesDocument(parsedNamespaces.values, nextNamespaceValue);
      const namespaceChanged = stableStringify(nextNamespacesDocument) !== stableStringify(parsedNamespaces.values);
      const dirtyWrites = modifiedKeys.length === 0
        ? []
        : [
            {
              targetPath: this.sourcePath,
              content: serializeDocument(parsedDocument.document, nextDocument, parsedDocument.format, parsedDocument.keyOrder, nextNamespaceValue, {
                wrappedVersionMode: 'dirty',
                forceWrappedKeys: forcedWrappedKeys
              })
            },
            {
              targetPath: modifiedPath,
              content: serializeModifiedKeysDocument(modifiedKeys)
            },
            ...(namespaceChanged
              ? [{
                  targetPath: namespacePath,
                  content: serializeNamespacesDocument(nextNamespacesDocument)
                }]
              : [])
          ];
      const finalizeWrites = modifiedKeys.length === 0
        ? []
        : [
            {
              targetPath: this.sourcePath,
              content: serializeDocument(nextDocument, nextDocument, parsedDocument.format, parsedDocument.keyOrder, nextNamespaceValue, {
                wrappedVersionMode: 'final',
                forceWrappedKeys: forcedWrappedKeys
              })
            },
            {
              targetPath: modifiedPath,
              content: serializeModifiedKeysDocument([])
            },
            {
              targetPath: namespacePath,
              content: serializeNamespacesDocument(nextNamespacesDocument)
            }
          ];

      return {
        dirtyWrites,
        finalizeWrites,
        expectedDirtySnapshotHash: nextSnapshot.snapshotHash,
        expectedFinalSnapshotHash: nextSnapshot.snapshotHash,
        finalizeWarnings: modifiedKeys.length === 0 ? undefined : ['Dirty stage applied; call steam_collection_apply with finalize=true to finalize.']
      };
    }

    const modifiedKeys = await readModifiedKeysDocument(modifiedPath);
    const forcedWrappedKeys = new Set(modifiedKeys);
    const dirtyWrappedKeys = resolveDirtyWrappedCollectionKeys(parsedDocument.document);
    if (modifiedKeys.length === 0) {
      if (dirtyWrappedKeys.length > 0) {
        throw new Error(`Finalize cannot continue because staged state appears corrupted: modified sidecar is empty while dirty wrapped entries remain (${dirtyWrappedKeys.join(', ')}).`);
      }

      return {
        dirtyWrites: [],
        finalizeWrites: [],
        expectedFinalSnapshotHash: snapshot.snapshotHash
      };
    }

    if (currentNamespaceValue === undefined) {
      throw new Error('Finalize cannot continue because namespace metadata is missing for a dirty staged state.');
    }

    const finalizedNamespaceValue = validateFinalizedNamespaceValue(currentNamespaceValue);

    const normalizedModifiedKeys = uniqueStrings(modifiedKeys);
    const normalizedDirtyWrappedKeys = uniqueStrings(dirtyWrappedKeys);
    if (
      normalizedModifiedKeys.length !== normalizedDirtyWrappedKeys.length
      || normalizedModifiedKeys.some((key, index) => key !== normalizedDirtyWrappedKeys[index])
    ) {
      throw new Error(
        `Finalize cannot continue because staged state appears corrupted: modified sidecar keys (${normalizedModifiedKeys.join(', ')}) do not match dirty wrapped entries (${normalizedDirtyWrappedKeys.join(', ')}).`
      );
    }

    const nextNamespacesDocument = updateNamespacesDocument(parsedNamespaces.values, finalizedNamespaceValue);
    const namespaceChanged = stableStringify(nextNamespacesDocument) !== stableStringify(parsedNamespaces.values);

    return {
      dirtyWrites: [],
      finalizeWrites: [
        {
          targetPath: this.sourcePath,
          content: serializeDocument(parsedDocument.document, nextDocument, parsedDocument.format, parsedDocument.keyOrder, finalizedNamespaceValue, {
            wrappedVersionMode: 'final',
            forceWrappedKeys: forcedWrappedKeys
          })
        },
        {
          targetPath: modifiedPath,
          content: serializeModifiedKeysDocument([])
        },
        ...(namespaceChanged
          ? [{
              targetPath: namespacePath,
              content: serializeNamespacesDocument(nextNamespacesDocument)
            }]
          : [])
      ],
      expectedFinalSnapshotHash: nextSnapshot.snapshotHash
    };
  }

  private async readDocument(): Promise<ParsedCloudStorageDocument> {
    const text = await readFile(this.sourcePath, 'utf8');
    const parsed = parseJson(text);
    return normalizeDocument(parsed, this.sourcePath);
  }

  private async readNamespacesDocument(namespacePath: string): Promise<ParsedCloudStorageNamespaceDocument> {
    const text = await readFile(namespacePath, 'utf8');
    const parsed = parseJson(text);
    return normalizeNamespacesDocument(parsed, namespacePath);
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

function normalizeNamespacesDocument(parsed: unknown, sourcePath: string): ParsedCloudStorageNamespaceDocument {
  if (!Array.isArray(parsed)) {
    throw new Error(`Collection namespace file ${sourcePath} is not a supported JSON document.`);
  }

  const values: Array<[number, string]> = [];
  const valueByNamespace = new Map<number, string>();

  for (const [index, entry] of parsed.entries()) {
    if (!Array.isArray(entry) || entry.length < 2 || typeof entry[0] !== 'number' || typeof entry[1] !== 'string') {
      throw new Error(`Collection namespace file ${sourcePath} contains an unsupported array entry shape at index ${index}.`);
    }

    values.push([entry[0], entry[1]]);
    valueByNamespace.set(entry[0], entry[1]);
  }

  return {
    values,
    valueByNamespace
  };
}

function serializeDocument(
  previousDocument: CloudStorageDocument,
  document: CloudStorageDocument,
  format: CloudStorageDocumentFormat,
  keyOrder: string[],
  nextNamespaceValue?: string,
  options: SerializeDocumentOptions = {}
): string {
  if (format === 'object') {
    return `${JSON.stringify(document, null, 2)}\n`;
  }

  const seen = new Set<string>();
  const entries: Array<[string, unknown]> = [];

  for (const key of keyOrder) {
    if (Object.hasOwn(document, key)) {
      entries.push([key, wrapPairArrayValue(key, document[key], previousDocument[key], nextNamespaceValue, options)]);
      seen.add(key);
    }
  }

  for (const key of Object.keys(document)) {
    if (!seen.has(key)) {
      entries.push([key, wrapPairArrayValue(key, document[key], previousDocument[key], nextNamespaceValue, options)]);
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

function wrapPairArrayValue(
  key: string,
  value: unknown,
  previousValue?: unknown,
  nextNamespaceValue?: string,
  options: SerializeDocumentOptions = {}
): unknown {
  if (!key.startsWith('user-collections.')) {
    return value;
  }

  const payload = buildPairArrayPayload(key, value);
  const nextValue = JSON.stringify(payload);

  const wrappedVersionMode = options.wrappedVersionMode ?? 'current';
  const shouldForceWrappedValue = options.forceWrappedKeys?.has(key) ?? false;

  if (isWrappedCloudStorageEntry(value)) {
    if (!shouldForceWrappedValue && !didCollectionPayloadChange(previousValue, value)) {
      return value;
    }

    return refreshWrappedCloudStorageValue(value, nextValue, nextNamespaceValue, wrappedVersionMode);
  }

  return {
    key,
    timestamp: Math.floor(Date.now() / 1000),
    value: nextValue,
    version: wrappedVersionMode === 'dirty' ? null : nextNamespaceValue ?? '1'
  };
}

function didCollectionPayloadChange(previousValue: unknown, nextValue: unknown): boolean {
  if (previousValue === undefined) {
    return true;
  }

  return stableStringify(unwrapCollectionValue(previousValue)) !== stableStringify(unwrapCollectionValue(nextValue));
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
  const protectedCollections = new Set<string>([
    ...toCollectionNameSet(plan.policies.readOnlyCollections),
    ...toCollectionNameSet(plan.policies.ignoreCollections)
  ]);

  for (const [appId, collectionNames] of Object.entries(snapshot.collectionsByApp)) {
    collections.set(appId, new Set(collectionNames));
  }

  for (const operation of Object.values(plan.operations)) {
    const appId = appIdString(operation.appId);
    const currentCollections = collections.get(appId) ?? new Set<string>();
    const protectedMemberships = getProtectedMemberships(currentCollections, protectedCollections);

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
        if (protectedCollections.has(normalizeCollectionName(collectionName))) {
          continue;
        }

        currentCollections.add(resolveSnapshotCollectionName(collectionName, snapshot));
      }

      rehydrateProtectedMemberships(currentCollections, protectedMemberships);
    }

    for (const collectionName of operation.collectionsToAdd ?? []) {
      if (protectedCollections.has(normalizeCollectionName(collectionName))) {
        continue;
      }

      currentCollections.add(resolveSnapshotCollectionName(collectionName, snapshot));
    }

    for (const collectionName of operation.collectionsToRemove ?? []) {
      if (protectedCollections.has(normalizeCollectionName(collectionName))) {
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

function resolveNamespaceMetadataPath(sourcePath: string): string {
  return path.join(path.dirname(sourcePath), 'cloud-storage-namespaces.json');
}

function resolveModifiedMetadataPath(sourcePath: string): string {
  return path.join(path.dirname(sourcePath), 'cloud-storage-namespace-1.modified.json');
}

async function readModifiedKeysDocument(modifiedPath: string): Promise<string[]> {
  try {
    const text = await readFile(modifiedPath, 'utf8');
    const parsed = parseJson(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`Collection modified key file ${modifiedPath} is not a supported JSON document.`);
    }

    if (!parsed.every((entry) => typeof entry === 'string')) {
      throw new Error(`Collection modified key file ${modifiedPath} must contain only string keys.`);
    }

    return [...parsed];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function serializeModifiedKeysDocument(keys: string[]): string {
  return `${JSON.stringify(keys, null, 2)}\n`;
}

function resolveModifiedCollectionKeys(previousDocument: CloudStorageDocument, nextDocument: CloudStorageDocument): string[] {
  const keys = new Set<string>([
    ...Object.keys(previousDocument),
    ...Object.keys(nextDocument)
  ]);

  return [...keys].filter((key) => {
    if (key !== 'user-collections.hidden' && !key.startsWith('user-collections.uc-')) {
      return false;
    }

    return didCollectionPayloadChange(previousDocument[key], nextDocument[key]);
  });
}

function resolveDirtyWrappedCollectionKeys(document: CloudStorageDocument): string[] {
  return Object.entries(document)
    .flatMap(([key, value]) => {
      if (key !== 'user-collections.hidden' && !key.startsWith('user-collections.uc-')) {
        return [];
      }

      return isWrappedCloudStorageEntry(value) && value.version === null ? [key] : [];
    });
}

function bumpNamespaceValue(value: string | undefined): string {
  const numericValue = Number(value ?? '0');
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new Error(`Collection namespace value ${value ?? '<missing>'} is not a supported non-negative integer string.`);
  }

  return String(numericValue + 1);
}

function validateFinalizedNamespaceValue(value: string): string {
  if (/^\d+$/.test(value)) {
    return String(Number(value));
  }

  throw new Error(`Finalize cannot continue because namespace metadata is invalid (${value}).`);
}

function updateNamespacesDocument(values: Array<[number, string]>, nextNamespaceValue: string): Array<[number, string]> {
  let sawCollectionNamespace = false;

  const nextValues = values.map(([namespaceId, value]) => {
    if (namespaceId !== COLLECTION_NAMESPACE_ID) {
      return [namespaceId, value] as [number, string];
    }

    sawCollectionNamespace = true;
    return [namespaceId, nextNamespaceValue] as [number, string];
  });

  if (!sawCollectionNamespace) {
    nextValues.push([COLLECTION_NAMESPACE_ID, nextNamespaceValue]);
  }

  return nextValues;
}

function serializeNamespacesDocument(values: Array<[number, string]>): string {
  return `${JSON.stringify(values, null, 2)}\n`;
}

function resolveSnapshotCollectionName(collectionName: string, snapshot: CollectionSnapshot): string {
  return snapshot.rawMetadata.displayNameMap[normalizeCollectionName(collectionName)] ?? collectionName.trim();
}

function resolveBackendKey(collectionName: string, snapshot: CollectionSnapshot): string {
  return snapshot.rawMetadata.backendKeyMap[normalizeCollectionName(collectionName)] ?? `user-collections.uc-${slugify(collectionName)}`;
}

function getProtectedMemberships(currentCollections: Set<string>, protectedCollections: Set<string>): string[] {
  if (protectedCollections.size === 0) {
    return [];
  }

  return [...currentCollections].filter((collectionName) => protectedCollections.has(normalizeCollectionName(collectionName)));
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
    return refreshWrappedCloudStorageValue(original, JSON.stringify(nextPayload));
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
    return refreshWrappedCloudStorageValue(original, JSON.stringify(nextPayload));
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

function refreshWrappedCloudStorageValue(
  original: Record<string, unknown> & { key: string },
  nextValue: string,
  nextVersion?: string,
  wrappedVersionMode: WrappedVersionMode = 'current'
): unknown {
  const resolvedVersion = wrappedVersionMode === 'dirty'
    ? null
    : normalizeWrappedVersion(nextVersion ?? original.version);

  if (original.value === nextValue && original.version === resolvedVersion) {
    return original;
  }

  return {
    ...original,
    timestamp: Math.floor(Date.now() / 1000),
    value: nextValue,
    version: resolvedVersion
  };
}

function normalizeWrappedVersion(version: unknown): string {
  if (typeof version === 'string' && /^\d+$/.test(version)) {
    return version;
  }

  if (typeof version === 'number' && Number.isInteger(version) && version >= 0) {
    return String(version);
  }

  return '1';
}

function serializeMembershipArray(sortedMembers: string[], preferNumeric = false): Array<string | number> {
  if (preferNumeric && sortedMembers.every((member) => /^\d+$/.test(member))) {
    return sortedMembers.map((member) => Number(member));
  }

  return sortedMembers;
}

export const cloudStorageJsonInternals = {
  buildSnapshot,
  bumpNamespaceValue,
  membershipFromValue,
  normalizeDocument,
  normalizeNamespacesDocument,
  refreshWrappedCloudStorageValue,
  resolveNamespaceMetadataPath,
  serializeDocument,
  serializeNamespacesDocument,
  updateNamespacesDocument,
  updateDocument,
  stableStringify
};
