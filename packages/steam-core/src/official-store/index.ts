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
  OfficialStoreCuratorListSummary,
  OfficialStoreItemsOptions,
  OfficialStoreItemsResult,
  OfficialStoreItemsToFeatureOptions,
  OfficialStoreItemsToFeatureResult,
  OfficialStoreItemSummary,
  OfficialStoreListsOptions,
  OfficialStoreListsResult,
  OfficialStorePrioritizeAppsOptions,
  OfficialStorePrioritizeAppsResult,
  OfficialStorePrioritizedAppSummary,
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
          include_links: true,
          include_assets: true,
          include_tag_count: true
        }
      },
      'Steam Web API key is required for official store items access. Set STEAM_API_KEY.',
      'Official store items request failed'
    );
    return normalizeOfficialStoreItems(response);
  }

  async getItemsToFeature(request: OfficialStoreItemsToFeatureOptions = {}): Promise<OfficialStoreItemsToFeatureResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/IStoreMarketingService/GetItemsToFeature/v1/',
      {
        context: {
          language: request.language ?? 'english',
          country_code: request.countryCode ?? 'US'
        }
      },
      'Steam Web API key is required for official store marketing access. Set STEAM_API_KEY.',
      'Official store marketing request failed'
    );
    return normalizeOfficialStoreItemsToFeature(response);
  }

  async getLists(request: OfficialStoreListsOptions = {}): Promise<OfficialStoreListsResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/IStoreCurationService/GetLists/v1/',
      {
        count: request.count,
        start: request.start,
        return_metadata_only: request.returnMetadataOnly
      },
      'Steam Web API key is required for official store curation access. Set STEAM_API_KEY.',
      'Official store curation request failed'
    );
    return normalizeOfficialStoreLists(response);
  }

  async queryItems(request: OfficialStoreQueryItemsOptions): Promise<OfficialStoreQueryItemsResult> {
    const filters: Record<string, unknown> = {
      coming_soon_only: request.comingSoonOnly ?? true,
      only_free_items: request.freeToPlay === true ? true : undefined,
      exclude_free_items: request.freeToPlay === false ? true : undefined,
      type_filters: {
        include_apps: true,
        include_games: request.types === undefined || request.types.includes('game'),
        include_dlc: request.types === undefined || request.types.includes('dlc'),
        include_software: request.types === undefined || request.types.includes('software')
      }
    };

    // Add tag filters if provided
    if (request.tagIdsMustMatch && request.tagIdsMustMatch.length > 0) {
      filters.tagids_must_match = request.tagIdsMustMatch.map(id => ({ tagid: id }));
    }
    if (request.tagIds && request.tagIds.length > 0) {
      filters.tagids = request.tagIds;
    }
    if (request.tagIdsExclude && request.tagIdsExclude.length > 0) {
      filters.tagids_exclude = request.tagIdsExclude;
    }

    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/IStoreQueryService/Query/v1/',
      {
        query: {
          start: 0,
          count: request.limit ?? 20,
          filters
        },
        context: {
          language: request.language ?? 'english',
          country_code: request.countryCode ?? 'US'
        },
        data_request: {
          include_basic_info: true,
          include_release: true,
          include_links: true,
          include_assets: true,
          include_tag_count: true
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

  async prioritizeAppsForUser(request: OfficialStorePrioritizeAppsOptions): Promise<OfficialStorePrioritizeAppsResult> {
    const response = await this.fetchServiceInterfaceJson(
      'https://api.steampowered.com/IStoreAppSimilarityService/PrioritizeAppsForUser/v1/',
      {
        ids: request.appIds.map((appId) => ({ appid: appId })),
        steamid: request.steamId,
        country_code: request.countryCode,
        include_owned_games: request.includeOwnedGames
      },
      'Steam Web API key is required for official store similarity access. Set STEAM_API_KEY.',
      'Official store similarity request failed'
    );
    return normalizeOfficialStorePrioritizeApps(response);
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

function normalizeOfficialStoreItemsToFeature(payload: unknown): OfficialStoreItemsToFeatureResult {
  if (!isRecord(payload) || !isRecord(payload.response)) {
    return {
      spotlights: [],
      daily_deals: [],
      specials: [],
      purchase_recommendations: []
    };
  }

  const response = payload.response;
  return {
    spotlights: normalizeOfficialStoreFeaturedFamily(response.spotlights),
    daily_deals: normalizeOfficialStoreFeaturedFamily(response.daily_deals),
    specials: normalizeOfficialStoreFeaturedFamily(response.specials),
    purchase_recommendations: normalizeOfficialStoreFeaturedFamily(response.purchase_recommendations)
  };
}

function normalizeOfficialStoreLists(payload: unknown): OfficialStoreListsResult {
  if (!isRecord(payload) || !isRecord(payload.response)) {
    return { lists: [] };
  }

  const response = payload.response;
  const lists = Array.isArray(response.lists)
    ? response.lists.flatMap((entry) => normalizeOfficialStoreCuratorList(entry))
    : [];

  return { lists };
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

function normalizeOfficialStoreCuratorList(payload: unknown): OfficialStoreCuratorListSummary[] {
  if (!isRecord(payload)) {
    return [];
  }

  const listId = readOfficialStoreStringId(payload.listid)
    ?? readOfficialStoreStringId(payload.list_id)
    ?? readOfficialStoreStringId(payload.id);
  const title = readOfficialStoreTrimmedString(payload.title)
    ?? readOfficialStoreTrimmedString(payload.name);

  if (!listId || !title) {
    return [];
  }

  const creator = isRecord(payload.creator) ? payload.creator : undefined;
  const curatorName = readOfficialStoreTrimmedString(payload.curator_name)
    ?? readOfficialStoreTrimmedString(payload.creator_name)
    ?? readOfficialStoreTrimmedString(creator?.name);
  const curatorSteamId = readOfficialStoreStringId(payload.curator_steamid)
    ?? readOfficialStoreStringId(payload.curator_steam_id)
    ?? readOfficialStoreStringId(creator?.steamid)
    ?? readOfficialStoreStringId(creator?.steam_id);
  const description = readOfficialStoreTrimmedString(payload.description)
    ?? readOfficialStoreTrimmedString(payload.blurb);
  const appCount = toNumber(payload.app_count) ?? toNumber(payload.item_count);

  return [{
    listId,
    title,
    ...(curatorName === undefined ? {} : { curatorName }),
    ...(curatorSteamId === undefined ? {} : { curatorSteamId }),
    ...(description === undefined ? {} : { description }),
    ...(appCount === undefined ? {} : { appCount })
  } satisfies OfficialStoreCuratorListSummary];
}

function normalizeOfficialStoreFeaturedFamily(payload: unknown): number[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const appIds: number[] = [];
  const seenAppIds = new Set<number>();

  for (const entry of payload) {
    const appId = readOfficialStoreFeaturedAppId(entry);
    if (!appId || seenAppIds.has(appId)) {
      continue;
    }

    seenAppIds.add(appId);
    appIds.push(appId);
  }

  return appIds;
}

function readOfficialStoreFeaturedAppId(payload: unknown): number | undefined {
  if (typeof payload === 'number') {
    return payload > 0 ? payload : undefined;
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  const directAppId = toNumber(payload.appid)
    ?? toNumber(payload.app_id)
    ?? toNumber(payload.id);
  if (directAppId) {
    return directAppId;
  }

  if (isRecord(payload.item)) {
    return toNumber(payload.item.appid)
      ?? toNumber(payload.item.app_id)
      ?? toNumber(payload.item.id);
  }

  return undefined;
}

function readOfficialStoreTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized === '' ? undefined : normalized;
}

function readOfficialStoreStringId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized === '' ? undefined : normalized;
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === 'bigint' && value > 0n) {
    return value.toString();
  }

  return undefined;
}

function readOfficialStoreNamedStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const names = value.flatMap((entry) => {
    if (typeof entry === 'string') {
      const normalized = entry.trim();
      return normalized === '' ? [] : [normalized];
    }

    if (!isRecord(entry) || typeof entry.name !== 'string') {
      return [];
    }

    const normalized = entry.name.trim();
    return normalized === '' ? [] : [normalized];
  });

  return names.length > 0 ? Array.from(new Set(names)) : undefined;
}

function readOfficialStoreNumberList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.flatMap((entry) => {
    const numberValue = toNumber(entry);
    return numberValue ? [numberValue] : [];
  });

  return values.length > 0 ? Array.from(new Set(values)) : undefined;
}

function readOfficialStoreCategoryIds(value: unknown): number[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const categoryIds = Object.values(value).flatMap((entry) => readOfficialStoreNumberList(entry) ?? []);
  return categoryIds.length > 0 ? Array.from(new Set(categoryIds)) : undefined;
}

function readOfficialStoreTagIds(payload: Record<string, unknown>): number[] | undefined {
  const tagIds = [
    ...(readOfficialStoreNumberList(payload.tagids) ?? []),
    ...(readOfficialStoreNumberList(payload.tag_ids) ?? []),
    ...(Array.isArray(payload.tags)
      ? payload.tags.flatMap((entry) => {
          const tagId = isRecord(entry) ? toNumber(entry.tagid) : undefined;
          return tagId ? [tagId] : [];
        })
      : [])
  ];

  return tagIds.length > 0 ? Array.from(new Set(tagIds)) : undefined;
}

function resolveOfficialStoreAssetUrl(assets: unknown, assetKey: string): string | undefined {
  if (!isRecord(assets)) {
    return undefined;
  }

  const assetUrlFormat = typeof assets.asset_url_format === 'string' && assets.asset_url_format.trim() !== ''
    ? assets.asset_url_format.trim()
    : undefined;
  const assetPath = typeof assets[assetKey] === 'string' && assets[assetKey].trim() !== ''
    ? assets[assetKey].trim()
    : undefined;

  if (!assetUrlFormat || !assetPath) {
    return undefined;
  }

  const relativePath = assetUrlFormat.replace('${FILENAME}', assetPath).replace(/^\/+/, '');
  return new URL(relativePath, 'https://shared.steamstatic.com/store_item_assets/').toString();
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
  const basicInfo = isRecord(payload.basic_info) ? payload.basic_info : undefined;
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
  const developers = readOfficialStoreNamedStrings(basicInfo?.developers);
  const publishers = readOfficialStoreNamedStrings(basicInfo?.publishers);
  const shortDescription = typeof basicInfo?.short_description === 'string' && basicInfo.short_description.trim() !== ''
    ? basicInfo.short_description.trim()
    : undefined;
  const headerImage = resolveOfficialStoreAssetUrl(payload.assets, 'header');
  const categoryIds = readOfficialStoreCategoryIds(payload.categories);
  const tagIds = readOfficialStoreTagIds(payload);

  return [{
    appId,
    name,
    type,
    releaseDate,
    comingSoon,
    ...(freeToPlay === undefined ? {} : { freeToPlay }),
    ...(developers === undefined ? {} : { developers }),
    ...(publishers === undefined ? {} : { publishers }),
    ...(shortDescription === undefined ? {} : { shortDescription }),
    ...(headerImage === undefined ? {} : { headerImage }),
    ...(categoryIds === undefined ? {} : { categoryIds }),
    ...(tagIds === undefined || tagIds.length === 0 ? {} : { tagIds }),
    storeUrl
  } satisfies OfficialStoreItemSummary];
}

function normalizeOfficialStorePrioritizeApps(payload: unknown): OfficialStorePrioritizeAppsResult {
  if (!isRecord(payload) || !isRecord(payload.response)) {
    return { apps: [] };
  }

  const response = payload.response;
  const apps = Array.isArray(response.ids)
    ? response.ids.flatMap((entry) => normalizeOfficialStorePrioritizedApp(entry))
    : [];

  return { apps };
}

function normalizeOfficialStorePrioritizedApp(payload: unknown): OfficialStorePrioritizedAppSummary[] {
  if (!isRecord(payload)) {
    return [];
  }

  const appId = toNumber(payload.appid);
  if (!appId) {
    return [];
  }

  return [{ appId } satisfies OfficialStorePrioritizedAppSummary];
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
