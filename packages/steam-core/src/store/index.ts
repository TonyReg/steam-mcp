import type { DeckStatusProvider } from '../deck/index.js';
import type { DeckStatus, StoreAppDetails, StoreSearchCandidate, StoreSearchOptions } from '../types.js';
import { isRecord, uniqueStrings } from '../utils.js';

export class StoreClient {
  private readonly detailCache = new Map<number, StoreAppDetails | undefined>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly deckStatusProvider?: DeckStatusProvider
  ) {}

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
    if (this.detailCache.has(appId)) {
      return this.detailCache.get(appId);
    }

    const url = new URL('https://store.steampowered.com/api/appdetails');
    url.searchParams.set('appids', String(appId));
    url.searchParams.set('l', 'english');
    url.searchParams.set('cc', 'us');

    const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      this.detailCache.set(appId, undefined);
      return undefined;
    }

    const payload = (await response.json()) as unknown;
    const details = normalizeAppDetails(appId, payload);
    this.detailCache.set(appId, details);
    return details;
  }
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
