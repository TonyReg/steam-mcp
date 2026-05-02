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
  readOnlyGroups: string[];
  ignoreGroups: string[];
}

export interface CollectionPlan {
  planId: string;
  createdAt: string;
  backendId: string;
  steamId: string;
  snapshotHash: string;
  mode: PlanMode;
  operations: Record<string, CollectionPlanAppOperation>;
  policies: CollectionPlanPolicies;
  warnings: string[];
  sourceRequest?: string;
  planPath: string;
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
  };
}

export interface CollectionRule {
  appIds?: number[];
  query?: string;
  collection?: string;
  addToCollections?: string[];
  removeFromCollections?: string[];
  setCollections?: string[];
  hidden?: boolean;
}

export interface CollectionPlanRequest {
  mode?: PlanMode;
  request?: string;
  rules?: CollectionRule[];
  readOnlyGroups?: string[];
  ignoreGroups?: string[];
}

export interface CollectionPlanPreview {
  plan: CollectionPlan;
  matchedGames: GameRecord[];
  destructive: boolean;
}

export interface CollectionApplyOptions {
  dryRun?: boolean;
  requireSteamClosed?: boolean;
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
  price?: string;
  isFree?: boolean;
  headerImage?: string;
  developers?: string[];
  publishers?: string[];
  genres?: string[];
  tags?: string[];
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
  ignoreGroups?: string[];
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
}

export interface SteamRuntimeConfig {
  steamId?: string;
  installDirOverride?: string;
  userdataDirOverride?: string;
  stateDirectories: SteamStateDirectories;
  collectionWritesEnabled: boolean;
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
  collectionBackendId?: string;
  collectionSourcePath?: string;
  collectionApplyEnabled: boolean;
  collectionApplySafe: boolean;
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
  developers: string[];
  publishers: string[];
  genres: string[];
  categories: string[];
  tags: string[];
  shortDescription?: string;
  headerImage?: string;
  storeUrl: string;
}
