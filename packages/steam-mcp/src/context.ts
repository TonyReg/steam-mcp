import {
  CloudStorageJsonCollectionBackend,
  CollectionBackendRegistry,
  CollectionService,
  ConfigService,
  DeckStatusProvider,
  ExportService,
  LibraryService,
  LinkService,
  RecommendService,
  SafetyService,
  SearchService,
  StatusService,
  SteamDiscoveryService,
  StoreClient
} from '@steam-mcp/steam-core';

export interface SteamMcpContext {
  configService: ConfigService;
  discoveryService: SteamDiscoveryService;
  statusService: StatusService;
  storeClient: StoreClient;
  deckStatusProvider: DeckStatusProvider;
  libraryService: LibraryService;
  collectionService: CollectionService;
  searchService: SearchService;
  recommendService: RecommendService;
  exportService: ExportService;
  linkService: LinkService;
  safetyService: SafetyService;
}

export function createSteamMcpContext(env: NodeJS.ProcessEnv = process.env): SteamMcpContext {
  const configService = new ConfigService(env);
  const config = configService.resolve();
  const discoveryService = new SteamDiscoveryService(config);
  const deckStatusProvider = new DeckStatusProvider();
  const linkService = new LinkService();
  const storeClient = new StoreClient(fetch, deckStatusProvider);

  const backendRegistry = new CollectionBackendRegistry([], {
    'cloudstorage-json': (sourcePath, steamId) => new CloudStorageJsonCollectionBackend(sourcePath, steamId)
  });
  const safetyService = new SafetyService();
  const searchService = new SearchService();
  const libraryService = new LibraryService(discoveryService, backendRegistry, storeClient, deckStatusProvider, linkService);
  const collectionService = new CollectionService(configService, discoveryService, backendRegistry, libraryService, searchService, safetyService);
  const recommendService = new RecommendService();
  const exportService = new ExportService();
  const statusService = new StatusService(configService, discoveryService, safetyService);

  return {
    configService,
    discoveryService,
    statusService,
    storeClient,
    deckStatusProvider,
    libraryService,
    collectionService,
    searchService,
    recommendService,
    exportService,
    linkService,
    safetyService
  };
}
