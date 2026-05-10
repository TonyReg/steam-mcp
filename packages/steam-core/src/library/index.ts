import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@node-steam/vdf';
import type { CollectionSnapshot, GameRecord, LibraryListOptions, LibraryListResult, OfficialOwnedGameSummary, StoreAppDetails } from '../types.js';
import type { DeckStatusProvider } from '../deck/index.js';
import type { SteamDiscoveryService } from '../discovery/index.js';
import { resolveSteamWebApiSteamId } from '../official-store/index.js';
import type { OfficialStoreClient } from '../official-store/index.js';
import type { LinkService } from '../links/index.js';
import type { CollectionBackendRegistry } from '../collections/backend-registry/index.js';
import type { StoreClient } from '../store/index.js';
import { appIdString, isRecord, normalizeCollectionName, toNumber, uniqueStrings } from '../utils.js';

interface LocalAppState {
  playtimeMinutes?: number;
  lastPlayedAt?: string;
}

interface InstalledAppState {
  appId: number;
  name: string;
}

export class LibraryService {
  constructor(
    private readonly discoveryService: SteamDiscoveryService,
    private readonly backendRegistry: CollectionBackendRegistry,
    private readonly storeClient: StoreClient,
    private readonly officialStoreClient: OfficialStoreClient,
    private readonly deckStatusProvider: DeckStatusProvider,
    private readonly linkService: LinkService
  ) {}

  async list(options: LibraryListOptions = {}): Promise<LibraryListResult> {
    const discovery = await this.discoveryService.discover();
    const warnings = [...discovery.warnings];
    const shouldIncludeDeckStatus = Boolean(options.includeDeckStatus || options.deckStatuses?.length);
    const installedApps = await this.readInstalledApps(discovery.libraryFolders, warnings);
    const localAppState = discovery.localConfigPath ? await this.readLocalAppState(discovery.localConfigPath, warnings) : new Map<string, LocalAppState>();
    const backend = discovery.collectionBackendId && discovery.collectionSourcePath && discovery.selectedUserId
      ? this.backendRegistry.resolve(discovery.collectionBackendId, discovery.collectionSourcePath, discovery.selectedUserId)
      : undefined;
    const snapshot = backend ? await backend.readSnapshot() : undefined;
    const ownedGames = await this.readOwnedGames(discovery.selectedUserId, warnings);
    const staleWarnings = snapshot ? buildStaleSnapshotWarnings(snapshot, ownedGames) : [];
    warnings.push(...staleWarnings);

    const games = await Promise.all([...ownedGames.values()].map(async (owned) => {
      const appId = appIdString(owned.appId);
      const installed = installedApps.get(appId);
      const local = localAppState.get(appId);
      const storeMetadata = options.includeStoreMetadata ? await this.safeGetAppDetails(owned.appId, warnings) : undefined;
      const record = buildGameRecord(appId, owned, installed, local, snapshot, storeMetadata, this.linkService);

      if (shouldIncludeDeckStatus) {
        try {
          record.deckStatus = await this.deckStatusProvider.getStatus(owned.appId);
        } catch (error) {
          warnings.push(`Deck status lookup failed for ${record.name}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }

      return record;
    }));

    const filtered = games
      .filter((game) => filterGame(game, options))
      .sort((left, right) => compareGames(left, right, options.sortBy ?? 'name'));

    const limited = filtered.slice(0, options.limit ?? 100);

    return {
      games: limited,
      warnings: uniqueStrings(warnings),
      summary: {
        total: games.length,
        returned: limited.length,
        installed: games.filter((game) => game.installed).length,
        favorites: games.filter((game) => game.favorite).length,
        hidden: games.filter((game) => game.hidden).length
      }
    };
  }

  private async readInstalledApps(libraryFolders: string[], warnings: string[]): Promise<Map<string, InstalledAppState>> {
    const result = new Map<string, InstalledAppState>();

    for (const libraryFolder of libraryFolders) {
      const steamAppsPath = path.join(libraryFolder, 'steamapps');
      try {
        const entries = await readdir(steamAppsPath, { withFileTypes: true });
        const manifests = entries.filter((entry) => entry.isFile() && /^appmanifest_\d+\.acf$/.test(entry.name));
        for (const manifest of manifests) {
          const manifestPath = path.join(steamAppsPath, manifest.name);
          const parsed = parse((await readFile(manifestPath, 'utf8'))) as unknown;
          const appState = isRecord(parsed) && isRecord(parsed.AppState) ? parsed.AppState : undefined;
          if (!appState) {
            continue;
          }

          const appId = toNumber(appState.appid);
          const name = typeof appState.name === 'string' ? appState.name : undefined;
          if (!appId || !name) {
            continue;
          }

          result.set(appIdString(appId), { appId, name });
        }
      } catch (error) {
        warnings.push(`Failed to read library folder ${libraryFolder}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    return result;
  }

  private async readLocalAppState(localConfigPath: string, warnings: string[]): Promise<Map<string, LocalAppState>> {
    try {
      const parsed = parse((await readFile(localConfigPath, 'utf8'))) as unknown;
      const root = isRecord(parsed) ? parsed : undefined;
      const apps = root
        && isRecord(root.UserLocalConfigStore)
        && isRecord(root.UserLocalConfigStore.Software)
        && isRecord(root.UserLocalConfigStore.Software.Valve)
        && isRecord(root.UserLocalConfigStore.Software.Valve.Steam)
        && isRecord(root.UserLocalConfigStore.Software.Valve.Steam.apps)
        ? root.UserLocalConfigStore.Software.Valve.Steam.apps
        : undefined;

      if (!apps) {
        return new Map<string, LocalAppState>();
      }

      const result = new Map<string, LocalAppState>();
      for (const [appId, value] of Object.entries(apps)) {
        if (!/^\d+$/.test(appId) || !isRecord(value)) {
          continue;
        }

        const playtimeMinutes = toNumber(value.Playtime);
        const lastPlayed = toNumber(value.LastPlayed);
        result.set(appId, {
          playtimeMinutes,
          lastPlayedAt: lastPlayed ? new Date(lastPlayed * 1000).toISOString() : undefined
        });
      }

      return result;
    } catch (error) {
      warnings.push(`Failed to read localconfig.vdf: ${error instanceof Error ? error.message : 'unknown error'}`);
      return new Map<string, LocalAppState>();
    }
  }

  private async readOwnedGames(selectedUserId: string | undefined, warnings: string[]): Promise<Map<string, OfficialOwnedGameSummary>> {
    if (!selectedUserId) {
      warnings.push('No Steam user is selected; GetOwnedGames cannot enumerate the owned library until discovery resolves a user.');
      return new Map<string, OfficialOwnedGameSummary>();
    }

    const steamId = resolveSteamWebApiSteamId(selectedUserId);
    if (!steamId) {
      warnings.push('The selected Steam user could not be resolved to a SteamID64; GetOwnedGames cannot enumerate the owned library until discovery resolves a valid user.');
      return new Map<string, OfficialOwnedGameSummary>();
    }

    try {
      const response = await this.officialStoreClient.getOwnedGames({
        steamId,
        includeAppInfo: true,
        includePlayedFreeGames: true,
        includeFreeSub: true
      });
      return new Map(response.games.map((game) => [appIdString(game.appId), game]));
    } catch (error) {
      warnings.push(`GetOwnedGames is the authoritative source for owned-game membership. Library enumeration and collection planning are unavailable until owned games can be fetched: ${error instanceof Error ? error.message : 'unknown error'}`);
      return new Map<string, OfficialOwnedGameSummary>();
    }
  }

  private async safeGetAppDetails(appId: number, warnings: string[]): Promise<StoreAppDetails | undefined> {
    try {
      return await this.storeClient.getCacheableAppDetails(appId);
    } catch (error) {
      warnings.push(`Store metadata lookup failed for ${appId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      return undefined;
    }
  }
}

function buildGameRecord(
  appId: string,
  owned: OfficialOwnedGameSummary,
  installed: InstalledAppState | undefined,
  local: LocalAppState | undefined,
  snapshot: CollectionSnapshot | undefined,
  storeMetadata: StoreAppDetails | undefined,
  linkService: LinkService
): GameRecord {
  const numericAppId = Number.parseInt(appId, 10);
  const collections = snapshot?.collectionsByApp[appId] ?? [];

  return {
    appId: numericAppId,
    name: storeMetadata?.name ?? owned.name ?? installed?.name ?? `Unknown App ${appId}`,
    playtimeMinutes: local?.playtimeMinutes ?? owned.playtimeForever,
    lastPlayedAt: local?.lastPlayedAt,
    installed: installed !== undefined,
    hidden: snapshot?.hiddenByApp[appId] ?? false,
    favorite: snapshot?.favoritesByApp[appId] ?? false,
    collections,
    genres: storeMetadata?.genres,
    categories: storeMetadata?.categories,
    tags: storeMetadata?.tags,
    developers: storeMetadata?.developers,
    publishers: storeMetadata?.publishers,
    shortDescription: storeMetadata?.shortDescription,
    headerImage: storeMetadata?.headerImage,
    storeUrl: storeMetadata?.storeUrl,
    steamLinks: linkService.generate(numericAppId)
  };
}


function buildStaleSnapshotWarnings(
  snapshot: CollectionSnapshot,
  ownedGames: Map<string, OfficialOwnedGameSummary>
): string[] {
  const warnings: string[] = [];
  const staleAppIds = new Set<string>([
    ...Object.keys(snapshot.favoritesByApp ?? {}),
    ...Object.keys(snapshot.hiddenByApp ?? {}),
    ...Object.keys(snapshot.collectionsByApp ?? {})
  ]);

  for (const appId of staleAppIds) {
    if (ownedGames.has(appId)) {
      continue;
    }

    const collectionNames = snapshot.collectionsByApp[appId] ?? [];
    const labels = [
      snapshot.favoritesByApp[appId] ? 'Favorites' : undefined,
      snapshot.hiddenByApp[appId] ? 'Hidden' : undefined,
      ...collectionNames
    ].filter((label): label is string => Boolean(label));
    const labelSummary = labels.length > 0 ? labels.join(', ') : 'snapshot metadata';
    warnings.push(`Stale snapshot reference for app ${appId} remains visible in ${labelSummary} but is not actionable because it was not returned by GetOwnedGames.`);
  }

  return warnings;
}

function filterGame(game: GameRecord, options: LibraryListOptions): boolean {
  if (options.ignoreCollections?.length) {
    const ignoredCollections = new Set(options.ignoreCollections.map((group) => normalizeCollectionName(group)));
    if ((game.collections ?? []).some((collection) => ignoredCollections.has(normalizeCollectionName(collection)))) {
      return false;
    }
  }

  if (options.installedOnly && !game.installed) {
    return false;
  }

  if (options.hidden !== undefined && game.hidden !== options.hidden) {
    return false;
  }

  if (options.favorite !== undefined && game.favorite !== options.favorite) {
    return false;
  }

  if (options.played !== undefined) {
    const played = (game.playtimeMinutes ?? 0) > 0;
    if (played !== options.played) {
      return false;
    }
  }

  if (options.collections?.length) {
    const collections = new Set((game.collections ?? []).map((collection) => normalizeCollectionName(collection)));
    if (!options.collections.every((collection) => collections.has(normalizeCollectionName(collection)))) {
      return false;
    }
  }

  if (options.deckStatuses?.length) {
    if (!game.deckStatus || !options.deckStatuses.includes(game.deckStatus)) {
      return false;
    }
  }

  return true;
}

function compareGames(left: GameRecord, right: GameRecord, sortBy: NonNullable<LibraryListOptions['sortBy']>): number {
  switch (sortBy) {
    case 'playtime':
      return (right.playtimeMinutes ?? 0) - (left.playtimeMinutes ?? 0) || left.name.localeCompare(right.name);
    case 'lastPlayed':
      return (right.lastPlayedAt ?? '').localeCompare(left.lastPlayedAt ?? '') || left.name.localeCompare(right.name);
    default:
      return left.name.localeCompare(right.name);
  }
}
