import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeckStatusProvider } from '../deck/index.js';
import type { StoreAppDetails, StoreSearchCandidate, StoreSearchOptions } from '../types.js';
import { isRecord, uniqueStrings } from '../utils.js';

interface CachedAppDetails {
  details: StoreAppDetails;
  updatedAtMs: number;
}

interface PersistedAppDetailsCacheEntry {
  updatedAt: string;
  details: StoreAppDetails;
}

export interface StoreClientOptions {
  cacheDir?: string;
  cacheTtlMs?: number;
  now?: () => Date;
}

const DEFAULT_APP_DETAILS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class StoreClient {
  private readonly detailCache = new Map<number, CachedAppDetails>();
  private readonly deckStatusProvider?: DeckStatusProvider;
  private readonly cacheDir?: string;
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    deckStatusProviderOrOptions?: DeckStatusProvider | StoreClientOptions,
    options: StoreClientOptions = {}
  ) {
    if (isStoreClientOptions(deckStatusProviderOrOptions)) {
      this.deckStatusProvider = undefined;
      this.cacheDir = deckStatusProviderOrOptions.cacheDir;
      this.cacheTtlMs = deckStatusProviderOrOptions.cacheTtlMs ?? DEFAULT_APP_DETAILS_CACHE_TTL_MS;
      this.now = deckStatusProviderOrOptions.now ?? (() => new Date());
      return;
    }

    this.deckStatusProvider = deckStatusProviderOrOptions;
    this.cacheDir = options.cacheDir;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_APP_DETAILS_CACHE_TTL_MS;
    this.now = options.now ?? (() => new Date());
  }

  async search(options: StoreSearchOptions): Promise<StoreSearchCandidate[]> {
    const url = new URL('https://store.steampowered.com/api/storesearch/');
    url.searchParams.set('term', options.query);
    url.searchParams.set('l', 'english');
    url.searchParams.set('cc', 'us');

    const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as unknown;
    const items = readStoreItems(payload);
    const limitedItems = items.slice(0, options.limit ?? 20);
    const deckStatuses = options.deckStatuses;

    const results = await Promise.all(limitedItems.map(async (item) => {
      const deckStatus = this.deckStatusProvider ? await this.deckStatusProvider.getStatus(item.appId) : undefined;
      return {
        ...item,
        deckStatus
      } satisfies StoreSearchCandidate;
    }));

    return results
      .filter((candidate) => (options.freeToPlay === undefined ? true : candidate.isFree === options.freeToPlay))
      .filter((candidate) => (deckStatuses?.length ? candidate.deckStatus !== undefined && deckStatuses.includes(candidate.deckStatus) : true));
  }

  async getAppDetails(appId: number): Promise<StoreAppDetails | undefined> {
    const cached = await this.getCachedDetails(appId);
    if (cached && !this.isExpired(cached)) {
      return cached.details;
    }

    const refreshed = await this.fetchAppDetails(appId);
    if (refreshed) {
      if (isCacheableAppDetails(refreshed.details)) {
        this.detailCache.set(appId, refreshed);
        await this.persistCacheEntry(appId, refreshed);
      }

      return refreshed.details;
    }

    return cached?.details;
  }

  async getCacheableAppDetails(appId: number): Promise<StoreAppDetails | undefined> {
    const cached = await this.getCachedDetails(appId);
    if (cached && !this.isExpired(cached) && isCacheableAppDetails(cached.details)) {
      return cached.details;
    }

    const refreshed = await this.fetchAppDetails(appId);
    if (refreshed && isCacheableAppDetails(refreshed.details)) {
      this.detailCache.set(appId, refreshed);
      await this.persistCacheEntry(appId, refreshed);
      return refreshed.details;
    }

    if (cached && isCacheableAppDetails(cached.details)) {
      return cached.details;
    }

    return undefined;
  }

  private async getCachedDetails(appId: number): Promise<CachedAppDetails | undefined> {
    const cached = this.detailCache.get(appId);
    if (cached) {
      return cached;
    }

    const persisted = await this.readPersistedCacheEntry(appId);
    if (persisted) {
      this.detailCache.set(appId, persisted);
    }

    return persisted;
  }

  private isExpired(entry: CachedAppDetails): boolean {
    return this.now().getTime() - entry.updatedAtMs >= this.cacheTtlMs;
  }

  private async fetchAppDetails(appId: number): Promise<CachedAppDetails | undefined> {
    const url = new URL('https://store.steampowered.com/api/appdetails');
    url.searchParams.set('appids', String(appId));
    url.searchParams.set('l', 'english');
    url.searchParams.set('cc', 'us');

    const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as unknown;
    const details = normalizeAppDetails(appId, payload);
    if (!details) {
      return undefined;
    }

    return {
      details,
      updatedAtMs: this.now().getTime()
    };
  }

  private async readPersistedCacheEntry(appId: number): Promise<CachedAppDetails | undefined> {
    if (!this.cacheDir) {
      return undefined;
    }

    try {
      const payload = JSON.parse(await readFile(this.getCacheEntryPath(appId), 'utf8')) as unknown;
      return readPersistedCacheEntry(payload, appId);
    } catch {
      return undefined;
    }
  }

  private async persistCacheEntry(appId: number, entry: CachedAppDetails): Promise<void> {
    if (!this.cacheDir) {
      return;
    }

    await mkdir(this.cacheDir, { recursive: true });
    const payload: PersistedAppDetailsCacheEntry = {
      updatedAt: new Date(entry.updatedAtMs).toISOString(),
      details: entry.details
    };
    await writeFile(this.getCacheEntryPath(appId), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  private getCacheEntryPath(appId: number): string {
    return path.join(this.cacheDir ?? '', `${appId}.json`);
  }
}

function isStoreClientOptions(value: DeckStatusProvider | StoreClientOptions | undefined): value is StoreClientOptions {
  return value !== undefined && !('getStatus' in value);
}

function readStoreItems(payload: unknown): StoreSearchCandidate[] {
  if (!isRecord(payload)) {
    return [];
  }

  const items = payload.items;
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const appId = typeof entry.id === 'number' ? entry.id : typeof entry.id === 'string' ? Number.parseInt(entry.id, 10) : undefined;
    const name = typeof entry.name === 'string' ? entry.name : undefined;
    if (!appId || !name) {
      return [];
    }

    const developers = readStringArray(entry.developers);
    const publishers = readStringArray(entry.publishers);
    const genres = readStringArray(entry.genres);
    const tags = readStringArray(entry.tags);

    return [{
      appId,
      name,
      price: typeof entry.price === 'string' ? entry.price : undefined,
      isFree: typeof entry.is_free === 'boolean' ? entry.is_free : undefined,
      headerImage: typeof entry.tiny_image === 'string' ? entry.tiny_image : undefined,
      developers,
      publishers,
      genres,
      tags,
      storeUrl: `https://store.steampowered.com/app/${appId}/`
    } satisfies StoreSearchCandidate];
  });
}

function normalizeAppDetails(appId: number, payload: unknown): StoreAppDetails | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const raw = payload[String(appId)];
  if (!isRecord(raw) || raw.success !== true || !isRecord(raw.data)) {
    return undefined;
  }

  const data = raw.data;
  const name = typeof data.name === 'string' ? data.name : undefined;
  if (!name) {
    return undefined;
  }

  return {
    appId,
    name,
    type: readStoreAppType(data.type),
    releaseDate: readReleaseDate(data.release_date)?.date,
    comingSoon: readReleaseDate(data.release_date)?.comingSoon,
    developers: uniqueStrings(readObjectNameArray(data.developers)),
    publishers: uniqueStrings(readObjectNameArray(data.publishers)),
    genres: uniqueStrings(readObjectNameArray(data.genres)),
    categories: uniqueStrings(readObjectNameArray(data.categories)),
    tags: uniqueStrings(readObjectNameArray(data.tags)),
    shortDescription: typeof data.short_description === 'string' ? data.short_description : undefined,
    headerImage: typeof data.header_image === 'string' ? data.header_image : undefined,
    storeUrl: `https://store.steampowered.com/app/${appId}/`
  };
}

function readPersistedCacheEntry(payload: unknown, appId: number): CachedAppDetails | undefined {
  if (!isRecord(payload) || typeof payload.updatedAt !== 'string') {
    return undefined;
  }

  const updatedAtMs = Date.parse(payload.updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return undefined;
  }

  const details = readPersistedAppDetails(payload.details, appId);
  if (!details) {
    return undefined;
  }

  return {
    details,
    updatedAtMs
  };
}

function readPersistedAppDetails(value: unknown, appId: number): StoreAppDetails | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const persistedAppId = typeof value.appId === 'number' ? value.appId : undefined;
  const name = typeof value.name === 'string' ? value.name : undefined;
  if (persistedAppId !== appId || !name) {
    return undefined;
  }

  const details: StoreAppDetails = {
    appId,
    name,
    type: readStoreAppType(value.type),
    releaseDate: typeof value.releaseDate === 'string' ? value.releaseDate : undefined,
    comingSoon: typeof value.comingSoon === 'boolean' ? value.comingSoon : undefined,
    developers: readStringArray(value.developers),
    publishers: readStringArray(value.publishers),
    genres: readStringArray(value.genres),
    categories: readStringArray(value.categories),
    tags: readStringArray(value.tags),
    shortDescription: typeof value.shortDescription === 'string' ? value.shortDescription : undefined,
    headerImage: typeof value.headerImage === 'string' ? value.headerImage : undefined,
    storeUrl: typeof value.storeUrl === 'string' ? value.storeUrl : `https://store.steampowered.com/app/${appId}/`
  };

  return isCacheableAppDetails(details) ? details : undefined;
}

function isCacheableAppDetails(details: StoreAppDetails): boolean {
  if (!details.name.trim()) {
    return false;
  }

  return hasNonBlankEntries(details.developers)
    || hasNonBlankEntries(details.publishers)
    || hasNonBlankEntries(details.genres)
    || hasNonBlankEntries(details.categories)
    || hasNonBlankEntries(details.tags)
    || hasNonBlankValue(details.releaseDate)
    || details.comingSoon !== undefined
    || details.type !== undefined
    || hasNonBlankValue(details.shortDescription)
    || hasNonBlankValue(details.headerImage);
}

function readStoreAppType(value: unknown): StoreAppDetails['type'] {
  return value === 'game' || value === 'software' || value === 'dlc'
    ? value
    : undefined;
}

function readReleaseDate(value: unknown): { date?: string; comingSoon?: boolean } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const date = typeof value.date === 'string' ? value.date : undefined;
  const comingSoon = typeof value.coming_soon === 'boolean' ? value.coming_soon : undefined;
  if (date === undefined && comingSoon === undefined) {
    return undefined;
  }

  return { date, comingSoon };
}

function hasNonBlankEntries(values: string[]): boolean {
  return values.some((value) => value.trim().length > 0);
}

function hasNonBlankValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(value.filter((entry): entry is string => typeof entry === 'string'));
}

function readObjectNameArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === 'string') {
        return [entry];
      }

      if (isRecord(entry) && typeof entry.description === 'string') {
        return [entry.description];
      }

      return [];
    });
  }

  if (isRecord(value)) {
    return Object.values(value).flatMap((entry) => {
      if (typeof entry === 'string') {
        return [entry];
      }

      if (isRecord(entry) && typeof entry.description === 'string') {
        return [entry.description];
      }

      return [];
    });
  }

  return [];
}
