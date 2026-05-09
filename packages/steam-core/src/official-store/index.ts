import type {
  OfficialStoreAppListOptions,
  OfficialStoreAppListResult,
  OfficialStoreAppSummary
} from '../types.js';
import { isRecord, toNumber } from '../utils.js';

export interface OfficialStoreClientOptions {
  steamWebApiKey?: string;
  fetchImpl?: typeof fetch;
}

export class OfficialStoreClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OfficialStoreClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getAppList(request: OfficialStoreAppListOptions = {}): Promise<OfficialStoreAppListResult> {
    const apiKey = this.options.steamWebApiKey?.trim();
    if (!apiKey) {
      throw new Error('Steam Web API key is required for official store catalog access. Set STEAM_API_KEY.');
    }

    const url = new URL('https://partner.steam-api.com/IStoreService/GetAppList/v1/');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('format', 'json');

    if (request.limit !== undefined) {
      url.searchParams.set('max_results', String(request.limit));
    }

    if (request.lastAppId !== undefined) {
      url.searchParams.set('last_appid', String(request.lastAppId));
    }

    if (request.ifModifiedSince !== undefined) {
      url.searchParams.set('if_modified_since', String(request.ifModifiedSince));
    }

    if (request.includeGames !== undefined) {
      url.searchParams.set('include_games', String(request.includeGames));
    }

    if (request.includeDlc !== undefined) {
      url.searchParams.set('include_dlc', String(request.includeDlc));
    }

    if (request.includeSoftware !== undefined) {
      url.searchParams.set('include_software', String(request.includeSoftware));
    }

    const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Official store catalog request failed with status ${response.status}.`);
    }

    const payload = await response.json() as unknown;
    return normalizeOfficialStoreAppList(payload);
  }
}

function normalizeOfficialStoreAppList(payload: unknown): OfficialStoreAppListResult {
  if (!isRecord(payload) || !isRecord(payload.response)) {
    return { apps: [], haveMoreResults: false, lastAppId: undefined };
  }

  const response = payload.response;
  const apps = Array.isArray(response.apps)
    ? response.apps.flatMap((entry) => normalizeOfficialStoreApp(entry))
    : [];

  return {
    apps,
    haveMoreResults: response.have_more_results === true,
    lastAppId: toNumber(response.last_appid)
  };
}

function normalizeOfficialStoreApp(payload: unknown): OfficialStoreAppSummary[] {
  if (!isRecord(payload)) {
    return [];
  }

  const appId = toNumber(payload.appid);
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!appId || name === '') {
    return [];
  }

  return [{
    appId,
    name,
    lastModified: toNumber(payload.last_modified),
    priceChangeNumber: toNumber(payload.price_change_number)
  } satisfies OfficialStoreAppSummary];
}
