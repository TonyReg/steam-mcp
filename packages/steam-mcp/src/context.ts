import path from 'node:path';
import {
  CloudStorageJsonCollectionBackend,
  CollectionBackendRegistry,
  CollectionService,
  ConfigService,
  DeckStatusProvider,
  ExportService,
  LibraryService,
  LinkService,
  OfficialStoreClient,
  RecommendService,
  SafetyService,
  SearchService,
  StatusService,
  SteamDiscoveryService,
  StoreClient,
  WishlistEnrichmentService,
  WishlistSaleService,
  WishlistService
} from '@steam-mcp/steam-core';

export interface SteamMcpContext {
  configService: ConfigService;
  discoveryService: SteamDiscoveryService;
  statusService: StatusService;
  storeClient: StoreClient;
  officialStoreClient: OfficialStoreClient;
  deckStatusProvider: DeckStatusProvider;
  libraryService: LibraryService;
  collectionService: CollectionService;
  searchService: SearchService;
  recommendService: RecommendService;
  exportService: ExportService;
  linkService: LinkService;
  safetyService: SafetyService;
  wishlistService: WishlistService;
  wishlistEnrichmentService: WishlistEnrichmentService;
  wishlistSaleService: WishlistSaleService;
}

export function createSteamMcpContext(env: NodeJS.ProcessEnv = process.env): SteamMcpContext {
  const configService = new ConfigService(env);
  const config = configService.resolve();
  const discoveryService = new SteamDiscoveryService(config);
  const deckStatusProvider = new DeckStatusProvider();
  const linkService = new LinkService();
  const officialStoreClient = new OfficialStoreClient({
    steamWebApiKey: config.steamWebApiKey,
    fetchImpl: fetch
  });
  const storeClient = new StoreClient(fetch, deckStatusProvider, {
    cacheDir: path.join(config.stateDirectories.metadataDir, 'store-appdetails'),
    cacheTtlMs: config.storeAppDetailsCacheTtlMs
  });

  const backendRegistry = new CollectionBackendRegistry([], {
    'cloudstorage-json': (sourcePath, steamId) => new CloudStorageJsonCollectionBackend(sourcePath, steamId)
  });
  const safetyService = new SafetyService();
  const searchService = new SearchService();
  const libraryService = new LibraryService(discoveryService, backendRegistry, storeClient, officialStoreClient, deckStatusProvider, linkService);
  const collectionService = new CollectionService(configService, discoveryService, backendRegistry, libraryService, searchService, safetyService);
  const recommendService = new RecommendService();
  const exportService = new ExportService();
  const statusService = new StatusService(configService, discoveryService, safetyService);
  const wishlistService = new WishlistService(officialStoreClient);
  const wishlistEnrichmentService = new WishlistEnrichmentService(wishlistService, storeClient, deckStatusProvider);
  const wishlistSaleService = new WishlistSaleService(wishlistService, storeClient);

  return {
    configService,
    discoveryService,
    statusService,
    storeClient,
    officialStoreClient,
    deckStatusProvider,
    libraryService,
    collectionService,
    searchService,
    recommendService,
    exportService,
    linkService,
    safetyService,
    wishlistService,
    wishlistEnrichmentService,
    wishlistSaleService
  };
}
