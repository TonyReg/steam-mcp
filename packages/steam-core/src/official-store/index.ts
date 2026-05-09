import type {
  OfficialOwnedGameSummary,
  OfficialOwnedGamesOptions,
  OfficialOwnedGamesResult,
  OfficialStoreAppListOptions,
  OfficialStoreAppListResult,
  OfficialStoreAppSummary
} from '../types.js';
import { isRecord, toNumber } from '../utils.js';

const STEAM_ID64_OFFSET = 76561197960265728n;

export interface OfficialStoreClientOptions {
  steamWebApiKey?: string;
  fetchImpl?: typeof fetch;
}

export function resolveSteamWebApiSteamId(selectedUserId: string | undefined): string | undefined {
  if (!selectedUserId || !/^\d+$/.test(selectedUserId)) {
    return undefined;
  }

  if (selectedUserId.length >= 17) {
    return selectedUserId;
  }

  return String(STEAM_ID64_OFFSET + BigInt(selectedUserId));
}

export class OfficialStoreClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OfficialStoreClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getAppList(request: OfficialStoreAppListOptions = {}): Promise<OfficialStoreAppListResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://partner.steam-api.com/IStoreService/GetAppList/v1/',
      {
        max_results: request.limit,
        last_appid: request.lastAppId,
        if_modified_since: request.ifModifiedSince,
        include_games: request.includeGames,
        include_dlc: request.includeDlc,
        include_software: request.includeSoftware
      },
      'Steam Web API key is required for official store catalog access. Set STEAM_API_KEY.',
      'Official store catalog request failed'
    );
    return normalizeOfficialStoreAppList(response);
  }

  async getOwnedGames(request: OfficialOwnedGamesOptions): Promise<OfficialOwnedGamesResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/',
      {
        steamid: request.steamId,
        include_appinfo: request.includeAppInfo,
        include_played_free_games: request.includePlayedFreeGames,
        include_free_sub: request.includeFreeSub,
        appids_filter: request.appIdsFilter?.length ? request.appIdsFilter : undefined
      },
      'Steam Web API key is required for official owned-games access. Set STEAM_API_KEY.',
      'Official owned-games request failed'
    );
    return normalizeOfficialOwnedGames(response);
  }

  private async fetchServiceInterfaceJson(
    endpoint: string,
    requestPayload: Record<string, boolean | number | number[] | string | undefined>,
    missingKeyMessage: string,
    failurePrefix: string
  ): Promise<unknown> {
    const apiKey = this.options.steamWebApiKey?.trim();
    if (!apiKey) {
      throw new Error(missingKeyMessage);
    }

    const url = new URL(endpoint);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('format', 'json');

    const payload = Object.fromEntries(
      Object.entries(requestPayload).filter(([, value]) => value !== undefined)
    );
    if (Object.keys(payload).length > 0) {
      url.searchParams.set('input_json', JSON.stringify(payload));
    }

    const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`${failurePrefix} with status ${response.status}.`);
    }

    return await response.json() as unknown;
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

function normalizeOfficialOwnedGames(payload: unknown): OfficialOwnedGamesResult {
  if (!isRecord(payload) || !isRecord(payload.response)) {
    return { gameCount: 0, games: [] };
  }

  const response = payload.response;
  const games = Array.isArray(response.games)
    ? response.games.flatMap((entry) => normalizeOfficialOwnedGame(entry))
    : [];

  return {
    gameCount: toNumber(response.game_count) ?? games.length,
    games
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

function normalizeOfficialOwnedGame(payload: unknown): OfficialOwnedGameSummary[] {
  if (!isRecord(payload)) {
    return [];
  }

  const appId = toNumber(payload.appid);
  if (!appId) {
    return [];
  }

  const name = typeof payload.name === 'string' && payload.name.trim() !== '' ? payload.name : undefined;
  const iconUrl = typeof payload.img_icon_url === 'string' && payload.img_icon_url.trim() !== '' ? payload.img_icon_url : undefined;

  return [{
    appId,
    name,
    playtimeForever: toNumber(payload.playtime_forever),
    iconUrl,
    hasCommunityVisibleStats: payload.has_community_visible_stats === true ? true : undefined
  } satisfies OfficialOwnedGameSummary];
}
