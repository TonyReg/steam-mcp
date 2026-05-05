import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortAppIds(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => Number(left) - Number(right));
}

function arrayMembership(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => (typeof entry === 'string' || typeof entry === 'number') ? [String(entry)] : []);
}

function objectMembership(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value)
    .filter(([key, entry]) => /^\d+$/.test(key) && entry !== false)
    .map(([key]) => key);
}

function buildLiveStylePayload(key: string, value: unknown): unknown {
  if (key === 'user-collections.favorite') {
    return {
      id: 'favorite',
      name: 'Favorites',
      added: sortAppIds(arrayMembership(value)).map(Number),
      removed: []
    };
  }

  if (key === 'user-collections.hidden') {
    return {
      id: 'hidden',
      name: 'Hidden',
      added: sortAppIds(objectMembership(value)).map(Number),
      removed: []
    };
  }

  if (key.startsWith('user-collections.uc-') && isRecord(value)) {
    const name = typeof value.name === 'string'
      ? value.name
      : typeof value.title === 'string'
        ? value.title
        : key.replace('user-collections.', '');
    const apps = arrayMembership(value.apps);
    const appids = objectMembership(value.appids);
    const added = apps.length > 0 ? apps : appids;

    return {
      id: key.replace('user-collections.', ''),
      name,
      added: sortAppIds(added).map(Number),
      removed: []
    };
  }

  return value;
}

export async function rewriteCloudstorageAsPairArray(sourcePath: string): Promise<void> {
  const parsed = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Expected object-shaped cloudstorage fixture at ${sourcePath}.`);
  }

  const namespaceVersion = await readNamespaceVersion(sourcePath);
  const entries = Object.entries(parsed).map(([key, value]) => [
    key,
    {
      key,
      timestamp: 1,
      value: JSON.stringify(buildLiveStylePayload(key, value)),
      version: namespaceVersion
    }
  ]);

  await writeFile(sourcePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

async function readNamespaceVersion(sourcePath: string): Promise<string> {
  const namespacePath = path.join(path.dirname(sourcePath), 'cloud-storage-namespaces.json');

  try {
    const parsed = JSON.parse(await readFile(namespacePath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      return '1';
    }

    const namespaceEntry = parsed.find((entry) => Array.isArray(entry) && entry[0] === 1 && typeof entry[1] === 'string');
    return Array.isArray(namespaceEntry) && typeof namespaceEntry[1] === 'string' ? namespaceEntry[1] : '1';
  } catch {
    return '1';
  }
}

export async function readPairArrayDocument(sourcePath: string): Promise<Array<[string, unknown]>> {
  const parsed = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected pair-array cloudstorage document at ${sourcePath}.`);
  }

  return parsed.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 2 || typeof entry[0] !== 'string') {
      throw new Error(`Malformed pair-array entry at index ${index}.`);
    }

    return [entry[0], entry[1]] satisfies [string, unknown];
  });
}

export function readPairArrayWrapper(entries: Array<[string, unknown]>, key: string): Record<string, unknown> {
  const entry = entries.find(([entryKey]) => entryKey === key);
  if (!entry) {
    throw new Error(`Missing pair-array entry for ${key}.`);
  }

  if (!isRecord(entry[1])) {
    throw new Error(`Expected wrapped pair-array entry for ${key}.`);
  }

  return entry[1];
}

export async function readModifiedKeys(sourcePath: string): Promise<string[]> {
  const modifiedPath = path.join(path.dirname(sourcePath), 'cloud-storage-namespace-1.modified.json');

  try {
    const parsed = JSON.parse(await readFile(modifiedPath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected modified key array at ${modifiedPath}.`);
    }

    return parsed.flatMap((entry) => typeof entry === 'string' ? [entry] : []);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

export function readPairArrayPayload(entries: Array<[string, unknown]>, key: string): unknown {
  const entry = entries.find(([entryKey]) => entryKey === key);
  if (!entry) {
    throw new Error(`Missing pair-array entry for ${key}.`);
  }

  const value = entry[1];
  if (isRecord(value) && typeof value.value === 'string') {
    return JSON.parse(value.value) as unknown;
  }

  return value;
}
