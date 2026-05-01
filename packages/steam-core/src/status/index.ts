import type { ConfigService } from '../config/index.js';
import type { SteamDiscoveryService } from '../discovery/index.js';
import type { SafetyService } from '../safety/index.js';
import type { SteamStatusResult } from '../types.js';

export class StatusService {
  constructor(
    private readonly configService: ConfigService,
    private readonly discoveryService: SteamDiscoveryService,
    private readonly safetyService: SafetyService
  ) {}

  async getStatus(): Promise<SteamStatusResult> {
    const [config, discovery, steamRunning] = await Promise.all([
      this.configService.ensureStateDirectories(),
      this.discoveryService.discover(),
      this.safetyService.isSteamRunning()
    ]);

    const applyEnabled = discovery.collectionBackendId === 'cloudstorage-json' && this.configService.resolve().collectionWritesEnabled;

    return {
      installDir: discovery.installDir,
      userIds: discovery.userIds,
      selectedUserId: discovery.selectedUserId,
      steamRunning,
      collectionBackendId: discovery.collectionBackendId,
      collectionSourcePath: discovery.collectionSourcePath,
      collectionApplyEnabled: applyEnabled,
      collectionApplySafe: applyEnabled && !steamRunning,
      stateDirectories: config,
      libraryFolders: discovery.libraryFolders,
      warnings: discovery.warnings
    };
  }
}
