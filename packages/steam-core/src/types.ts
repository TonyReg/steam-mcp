export type DeckStatus = 'verified' | 'playable' | 'unsupported' | 'unknown';
export type PlanMode = 'add-only' | 'merge' | 'replace';
export type ExportFormat = 'json' | 'markdown';

export interface SteamLinks {
  store: string;
  community: string;
  library: string;
  launch: string;
}

export interface GameRecord {
  appId: number;
  name: string;
  playtimeMinutes?: number;
  lastPlayedAt?: string;
  installed?: boolean;
  hidden?: boolean;
  favorite?: boolean;
  collections?: string[];
  deckStatus?: DeckStatus;
  genres?: string[];
  categories?: string[];
  tags?: string[];
  developers?: string[];
  publishers?: string[];
  shortDescription?: string;
  headerImage?: string;
  storeUrl?: string;
  steamLinks?: SteamLinks;
}

export interface CollectionPlanAppOperation {
  appId: number;
  hidden?: boolean;
  collectionsToAdd?: string[];
  collectionsToRemove?: string[];
  collectionsSet?: string[];
}

export interface CollectionPlanPolicies {
  readOnlyCollections: string[];
  ignoreCollections: string[];
}

export interface CollectionPlan {
  planId: string;
  createdAt: string;
  backendId: string;
  steamId: string;
  snapshotHash: string;
  mode: PlanMode;
  operations: Record<string, CollectionPlanAppOperation>;
  collectionDeletes: string[];
  policies: CollectionPlanPolicies;
  warnings: string[];
  sourceRequest?: string;
  planPath: string;
  expectedDirtySnapshotHash?: string;
  restartSteamAfterFinalize?: boolean;
}

export interface CollectionSnapshot {
  backendId: string;
  sourcePath: string;
  steamId: string;
  snapshotHash: string;
  collectionsByApp: Record<string, string[]>;
  favoritesByApp: Record<string, boolean>;
  hiddenByApp: Record<string, boolean>;
  rawMetadata: {
    backendKeyMap: Record<string, string>;
    displayNameMap: Record<string, string>;
    collectionStateMap: Record<string, 'live' | 'tombstone'>;
    tombstoneKeyMap: Record<string, string[]>;
  };
}

export interface CollectionRule {
  appIds?: number[];
  query?: string;
  collection?: string;
  addToCollections?: string[];
  removeFromCollections?: string[];
  setCollections?: string[];
  deleteCollections?: string[];
  hidden?: boolean;
}

export interface CollectionPlanRequest {
  mode?: PlanMode;
  request?: string;
  rules?: CollectionRule[];
  readOnlyCollections?: string[];
  ignoreCollections?: string[];
}

export interface CollectionPlanPreview {
  plan: CollectionPlan;
  matchedGames: GameRecord[];
  destructive: boolean;
}

export interface CollectionApplyOptions {
  dryRun?: boolean;
  requireSteamClosed?: boolean;
  finalize?: true;
}

export interface CollectionApplyResult {
  planId: string;
  dryRun: boolean;
  backendId: string;
  appliedOperationCount: number;
  backupPath?: string;
  rollbackPath?: string;
  warnings: string[];
  skipped: string[];
}

export interface StoreSearchCandidate {
  appId: number;
  name: string;
  type?: 'game' | 'software' | 'dlc';
  price?: string;
  isFree?: boolean;
  releaseDate?: string;
  comingSoon?: boolean;
  headerImage?: string;
  developers?: string[];
  publishers?: string[];
  genres?: string[];
  categories?: string[];
  tags?: string[];
  shortDescription?: string;
  storeUrl: string;
  deckStatus?: DeckStatus;
}

export interface LibraryListOptions {
  includeStoreMetadata?: boolean;
  includeDeckStatus?: boolean;
  installedOnly?: boolean;
  hidden?: boolean;
  favorite?: boolean;
  collections?: string[];
  played?: boolean;
  deckStatuses?: DeckStatus[];
  ignoreCollections?: string[];
  sortBy?: 'name' | 'playtime' | 'lastPlayed';
  limit?: number;
}

export interface LibraryListResult {
  games: GameRecord[];
  warnings: string[];
  summary: {
    total: number;
    returned: number;
    installed: number;
    favorites: number;
    hidden: number;
  };
}

export interface LibrarySearchOptions {
  query: string;
  favorite?: boolean;
  hidden?: boolean;
  collections?: string[];
  played?: boolean;
  deckStatuses?: DeckStatus[];
  ignoreCollections?: string[];
  limit?: number;
}

export interface SearchMatch<T> {
  item: T;
  score: number;
  reasons: string[];
}

export interface SimilarRequest {
  seedAppIds?: number[];
  query?: string;
  scope?: 'library' | 'store' | 'both';
  deckStatuses?: DeckStatus[];
  limit?: number;
  ignoreCollections?: string[];
}

export interface ExportResult {
  format: ExportFormat;
  content: string;
  metadata: {
    itemCount: number;
    source: string;
  };
}

export interface SteamStateDirectories {
  root: string;
  plansDir: string;
  backupsDir: string;
  logsDir: string;
  metadataDir: string;
}

export interface SteamRuntimeConfig {
  steamId?: string;
  steamWebApiKey?: string;
  installDirOverride?: string;
  userdataDirOverride?: string;
  stateDirectories: SteamStateDirectories;
  storeAppDetailsCacheTtlMs: number;
  collectionWritesEnabled: boolean;
  windowsOrchestrationEnabled: boolean;
  defaultReadOnlyCollections: string[];
  defaultIgnoreCollections: string[];
}

export interface SteamDiscoveryResult {
  installDir?: string;
  userdataDir?: string;
  userIds: string[];
  selectedUserId?: string;
  selectedUserDir?: string;
  libraryFolders: string[];
  collectionBackendId?: string;
  collectionSourcePath?: string;
  localConfigPath?: string;
  warnings: string[];
}

export interface SteamStatusResult {
  installDir?: string;
  userIds: string[];
  selectedUserId?: string;
  steamRunning: boolean;
  steamWebApiKeyAvailable: boolean;
  collectionBackendId?: string;
  collectionSourcePath?: string;
  collectionApplyEnabled: boolean;
  collectionApplySafe: boolean;
  windowsOrchestrationEnabled: boolean;
  windowsOrchestrationSupported: boolean;
  stateDirectories: SteamStateDirectories;
  libraryFolders: string[];
  warnings: string[];
}

export interface StoreSearchOptions {
  query: string;
  freeToPlay?: boolean;
  deckStatuses?: DeckStatus[];
  limit?: number;
}

export interface StoreAppDetails {
  appId: number;
  name: string;
  type?: 'game' | 'software' | 'dlc';
  releaseDate?: string;
  comingSoon?: boolean;
  developers: string[];
  publishers: string[];
  genres: string[];
  categories: string[];
  tags: string[];
  shortDescription?: string;
  headerImage?: string;
  storeUrl: string;
}

export interface OfficialStoreTopReleasesPage {
  pageId: number;
  pageName?: string;
  appIds: number[];
}

export interface OfficialStoreTopReleasesPagesResult {
  pages: OfficialStoreTopReleasesPage[];
}

export interface OfficialStoreItemsOptions {
  appIds: number[];
  language?: string;
  countryCode?: string;
}

export interface OfficialStoreQueryItemsOptions {
  limit?: number;
  types?: Array<'game' | 'software' | 'dlc'>;
  language?: string;
  countryCode?: string;
  comingSoonOnly?: boolean;
  freeToPlay?: boolean;
  tagIdsMustMatch?: number[];
  tagIds?: number[];
  tagIdsExclude?: number[];
}

export interface OfficialStoreItemSummary {
  appId: number;
  name: string;
  type?: 'game' | 'software' | 'dlc';
  releaseDate?: string;
  comingSoon?: boolean;
  freeToPlay?: boolean;
  developers?: string[];
  publishers?: string[];
  shortDescription?: string;
  headerImage?: string;
  categoryIds?: number[];
  tagIds?: number[];
  storeUrl: string;
}

export interface OfficialStoreItemsResult {
  items: OfficialStoreItemSummary[];
}

export interface OfficialStoreQueryItemsResult {
  items: OfficialStoreItemSummary[];
}

export interface OfficialStorePrioritizeAppsOptions {
  appIds: number[];
  steamId?: string;
  countryCode?: string;
  includeOwnedGames?: boolean;
}

export interface OfficialStorePrioritizedAppSummary {
  appId: number;
}

export interface OfficialStorePrioritizeAppsResult {
  apps: OfficialStorePrioritizedAppSummary[];
}

export interface OfficialStoreAppSummary {
  appId: number;
  name: string;
  lastModified?: number;
  priceChangeNumber?: number;
}

export interface OfficialStoreAppListOptions {
  limit?: number;
  lastAppId?: number;
  ifModifiedSince?: number;
  includeGames?: boolean;
  includeDlc?: boolean;
  includeSoftware?: boolean;
}

export interface OfficialStoreAppListResult {
  apps: OfficialStoreAppSummary[];
  haveMoreResults: boolean;
  lastAppId?: number;
}

export interface OfficialOwnedGamesOptions {
  steamId: string;
  includeAppInfo: boolean;
  includePlayedFreeGames: boolean;
  includeFreeSub: boolean;
  appIdsFilter?: number[];
}

export interface OfficialOwnedGameSummary {
  appId: number;
  name?: string;
  playtimeForever?: number;
  iconUrl?: string;
  hasCommunityVisibleStats?: boolean;
}

export interface OfficialOwnedGamesResult {
  gameCount: number;
  games: OfficialOwnedGameSummary[];
}

export interface OfficialRecentlyPlayedGamesOptions {
  steamId: string;
}

export interface OfficialRecentlyPlayedGameSummary {
  appId: number;
  name?: string;
  playtimeTwoWeeks?: number;
  playtimeForever?: number;
  iconUrl?: string;
}

export interface OfficialRecentlyPlayedGamesResult {
  totalCount: number;
  games: OfficialRecentlyPlayedGameSummary[];
}

export interface SteamReleaseScoutResult {
  appId: number;
  name: string;
  type: 'game' | 'software' | 'dlc';
  releaseDate?: string;
  comingSoon: boolean;
  freeToPlay?: boolean;
  source: 'query' | 'charts';
  ordering: 'query' | 'charts';
  filtersApplied: string[];
  storeUrl: string;
}
