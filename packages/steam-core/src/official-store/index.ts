import type {
  OfficialOwnedGameSummary,
  OfficialOwnedGamesOptions,
  OfficialOwnedGamesResult,
  OfficialRecentlyPlayedGameSummary,
  OfficialRecentlyPlayedGamesOptions,
  OfficialRecentlyPlayedGamesResult,
  OfficialStoreAppListOptions,
  OfficialStoreAppListResult,
  OfficialStoreAppSummary,
  OfficialStoreItemsOptions,
  OfficialStoreItemsResult,
  OfficialStoreItemSummary,
  OfficialStoreQueryItemsOptions,
  OfficialStoreQueryItemsResult,
  OfficialStoreTopReleasesPage,
  OfficialStoreTopReleasesPagesResult
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

  async getTopReleasesPages(): Promise<OfficialStoreTopReleasesPagesResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/ISteamChartsService/GetTopReleasesPages/v1/',
      {},
      'Steam Web API key is required for official top releases access. Set STEAM_API_KEY.',
      'Official top releases request failed'
    );
    return normalizeOfficialTopReleasesPages(response);
  }

  async getItems(request: OfficialStoreItemsOptions): Promise<OfficialStoreItemsResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/',
      {
        ids: request.appIds.map((appId) => ({ appid: appId })),
        context: {
          language: request.language ?? 'english',
          country_code: request.countryCode ?? 'US'
        },
        data_request: {
          include_basic_info: true,
          include_release: true,
          include_links: true
        }
      },
      'Steam Web API key is required for official store items access. Set STEAM_API_KEY.',
      'Official store items request failed'
    );
    return normalizeOfficialStoreItems(response);
  }

  async queryItems(request: OfficialStoreQueryItemsOptions): Promise<OfficialStoreQueryItemsResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/IStoreQueryService/Query/v1/',
      {
        query: {
          start: 0,
          count: request.limit ?? 20,
          filters: {
            coming_soon_only: request.comingSoonOnly ?? true,
            only_free_items: request.freeToPlay === true ? true : undefined,
            exclude_free_items: request.freeToPlay === false ? true : undefined,
            type_filters: {
              include_apps: true,
              include_games: request.types === undefined || request.types.includes('game'),
              include_dlc: request.types === undefined || request.types.includes('dlc'),
              include_software: request.types === undefined || request.types.includes('software')
            }
          }
        },
        context: {
          language: request.language ?? 'english',
          country_code: request.countryCode ?? 'US'
        },
        data_request: {
          include_basic_info: true,
          include_release: true,
          include_links: true
        }
      },
      'Steam Web API key is required for official store query access. Set STEAM_API_KEY.',
      'Official store query request failed'
    );
    return normalizeOfficialStoreItems(response);
  }

  async getAppList(request: OfficialStoreAppListOptions = {}): Promise<OfficialStoreAppListResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/IStoreService/GetAppList/v1/',
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

  async getRecentlyPlayedGames(request: OfficialRecentlyPlayedGamesOptions): Promise<OfficialRecentlyPlayedGamesResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/',
      {
        steamid: request.steamId
      },
      'Steam Web API key is required for official recently-played access. Set STEAM_API_KEY.',
      'Official recently-played request failed'
    );
    return normalizeOfficialRecentlyPlayedGames(response);
  }

  private async fetchServiceInterfaceJson(
    endpoint: string,
    requestPayload: Record<string, unknown>,
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

function normalizeOfficialTopReleasesPages(payload: unknown): OfficialStoreTopReleasesPagesResult {
  if (!isRecord(payload) || !isRecord(payload.response)) {
    return { pages: [] };
  }

  const response = payload.response;
  const pages = Array.isArray(response.pages)
    ? response.pages.flatMap((entry) => normalizeOfficialTopReleasesPage(entry))
    : [];

  return { pages };
}

function normalizeOfficialStoreItems(payload: unknown): OfficialStoreItemsResult {
  if (!isRecord(payload) || !isRecord(payload.response)) {
    return { items: [] };
  }

  const response = payload.response;
  const items = Array.isArray(response.store_items)
    ? response.store_items.flatMap((entry) => normalizeOfficialStoreItem(entry))
    : [];

  return { items };
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

function normalizeOfficialRecentlyPlayedGames(payload: unknown): OfficialRecentlyPlayedGamesResult {
  if (!isRecord(payload) || !isRecord(payload.response)) {
    return { totalCount: 0, games: [] };
  }

  const response = payload.response;
  const games = Array.isArray(response.games)
    ? response.games.flatMap((entry) => normalizeOfficialRecentlyPlayedGame(entry))
    : [];

  return {
    totalCount: toNumber(response.total_count) ?? games.length,
    games
  };
}

function normalizeOfficialTopReleasesPage(payload: unknown): OfficialStoreTopReleasesPage[] {
  if (!isRecord(payload)) {
    return [];
  }

  const pageName = typeof payload.name === 'string' && payload.name.trim() !== ''
    ? payload.name
    : typeof payload.page_name === 'string' && payload.page_name.trim() !== ''
      ? payload.page_name
      : undefined;
  const pageId = toNumber(payload.start_of_month) ?? toNumber(payload.page_id);
  const itemIds = Array.isArray(payload.item_ids)
    ? payload.item_ids
    : Array.isArray(payload.appids)
      ? payload.appids
      : [];
  const appIds = itemIds.flatMap((entry) => {
    const appId = isRecord(entry) ? toNumber(entry.appid) : toNumber(entry);
    return appId ? [appId] : [];
  });

  if (!pageId || appIds.length === 0) {
    return [];
  }

  return [{
    pageId,
    pageName,
    appIds
  } satisfies OfficialStoreTopReleasesPage];
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

function normalizeOfficialStoreItem(payload: unknown): OfficialStoreItemSummary[] {
  if (!isRecord(payload)) {
    return [];
  }

  const appId = toNumber(payload.appid);
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const rawType = toNumber(payload.type);
  const type = rawType === 0
    ? 'game'
    : rawType === 4
      ? 'dlc'
      : rawType === 6
        ? 'software'
        : payload.type === 'game' || payload.type === 'software' || payload.type === 'dlc'
          ? payload.type
          : undefined;
  const release = isRecord(payload.release) ? payload.release : undefined;
  const storeUrlPath = typeof payload.store_url_path === 'string' && payload.store_url_path.trim() !== ''
    ? payload.store_url_path.trim()
    : undefined;
  const storeUrl = storeUrlPath
    ? `https://store.steampowered.com/${storeUrlPath.replace(/^\/+/, '')}`
    : appId
      ? `https://store.steampowered.com/app/${String(appId)}/`
      : '';

  if (!appId || name === '' || storeUrl === '') {
    return [];
  }

  const steamReleaseDate = toNumber(release?.steam_release_date);
  const releaseDate = typeof release?.custom_release_date_message === 'string' && release.custom_release_date_message.trim() !== ''
    ? release.custom_release_date_message
    : steamReleaseDate
      ? new Date(steamReleaseDate * 1000).toISOString()
      : undefined;
  const comingSoon = release?.is_coming_soon === true || release?.is_coming_soon === 1
    ? true
    : release?.is_coming_soon === false || release?.is_coming_soon === 0
      ? false
      : payload.is_coming_soon === true || payload.is_coming_soon === 1
        ? true
        : payload.is_coming_soon === false || payload.is_coming_soon === 0
          ? false
          : undefined;
  const bestPurchaseOption = isRecord(payload.best_purchase_option) ? payload.best_purchase_option : undefined;
  const finalPriceInCents = toNumber(bestPurchaseOption?.final_price_in_cents);
  const freeToPlay = payload.is_free === true || payload.is_free === 1
    ? true
    : payload.is_free === false || payload.is_free === 0
      ? false
      : finalPriceInCents !== undefined && finalPriceInCents > 0
        ? false
        : undefined;

  return [{
    appId,
    name,
    type,
    releaseDate,
    comingSoon,
    ...(freeToPlay === undefined ? {} : { freeToPlay }),
    storeUrl
  } satisfies OfficialStoreItemSummary];
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

function normalizeOfficialRecentlyPlayedGame(payload: unknown): OfficialRecentlyPlayedGameSummary[] {
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
    playtimeTwoWeeks: toNumber(payload.playtime_2weeks),
    playtimeForever: toNumber(payload.playtime_forever),
    iconUrl
  } satisfies OfficialRecentlyPlayedGameSummary];
}
