import path from 'node:path';
import { createHash } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function normalizeAbsolutePath(value: string): string {
  return path.normalize(path.resolve(value));
}

export function normalizeOptionalAbsolutePath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : normalizeAbsolutePath(trimmed);
}

export function ensurePathInsideRoot(targetPath: string, rootDir: string, label = 'Path'): string {
  const normalizedTarget = normalizeAbsolutePath(targetPath);
  const normalizedRoot = normalizeAbsolutePath(rootDir);
  const relative = path.relative(normalizedRoot, normalizedTarget);

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return normalizedTarget;
  }

  throw new Error(`${label} ${normalizedTarget} escapes root ${normalizedRoot}.`);
}

export function normalizeUuid(value: string, label = 'value'): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a UUID.`);
  }

  return normalized;
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no'].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

export function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normalizeCollectionName(value: string): string {
  return value.trim().toLowerCase();
}

export function toCollectionNameSet(values: Iterable<string> | undefined): Set<string> {
  const result = new Set<string>();

  for (const value of values ?? []) {
    const normalized = normalizeCollectionName(value);
    if (normalized !== '') {
      result.add(normalized);
    }
  }

  return result;
}

export function uniqueCollectionNames(values: Iterable<string>): string[] {
  const byCanonical = new Map<string, string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === '') {
      continue;
    }

    const canonical = normalizeCollectionName(trimmed);
    if (!byCanonical.has(canonical)) {
      byCanonical.set(canonical, trimmed);
    }
  }

  return [...byCanonical.values()].sort((left, right) => left.localeCompare(right));
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function slugify(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'collection';
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function appIdString(appId: number): string {
  return String(appId);
}

export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
