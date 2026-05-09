import type { ConfigService } from '../config/index.js';
import type { SteamDiscoveryService } from '../discovery/index.js';
import type { SafetyService } from '../safety/index.js';
import type { SteamStatusResult } from '../types.js';
import { uniqueStrings } from '../utils.js';

export class StatusService {
  constructor(
    private readonly configService: ConfigService,
    private readonly discoveryService: SteamDiscoveryService,
    private readonly safetyService: SafetyService
  ) {}

  async getStatus(): Promise<SteamStatusResult> {
    const runtimeConfig = this.configService.resolve();
    const windowsOrchestrationSupported = this.safetyService.isWindowsOrchestrationSupported();
    const [config, discovery, steamRunning] = await Promise.all([
      this.configService.ensureStateDirectories(),
      this.discoveryService.discover(),
      this.safetyService.isSteamRunning()
    ]);

    const applyEnabled = discovery.collectionBackendId === 'cloudstorage-json' && runtimeConfig.collectionWritesEnabled;
    const warnings = [...discovery.warnings];

    if (!runtimeConfig.steamWebApiKey) {
      warnings.push('GetOwnedGames is the authoritative source for owned-game membership. Library enumeration and collection planning are unavailable until STEAM_API_KEY is configured.');
    } else if (!discovery.selectedUserId) {
      warnings.push('Steam Web API access is configured, but no Steam user is selected. GetOwnedGames cannot enumerate the owned library until discovery resolves a user.');
    }

    if (runtimeConfig.windowsOrchestrationEnabled && !windowsOrchestrationSupported) {
      warnings.push('Windows orchestration is enabled, but this runtime is not supported. Close Steam manually before calling steam_collection_apply.');
    }

    const collectionApplySafe = applyEnabled && (
      runtimeConfig.windowsOrchestrationEnabled
        ? windowsOrchestrationSupported
        : !steamRunning
    );

    return {
      installDir: discovery.installDir,
      userIds: discovery.userIds,
      selectedUserId: discovery.selectedUserId,
      steamRunning,
      steamWebApiKeyAvailable: Boolean(runtimeConfig.steamWebApiKey),
      collectionBackendId: discovery.collectionBackendId,
      collectionSourcePath: discovery.collectionSourcePath,
      collectionApplyEnabled: applyEnabled,
      collectionApplySafe,
      windowsOrchestrationEnabled: runtimeConfig.windowsOrchestrationEnabled,
      windowsOrchestrationSupported,
      stateDirectories: config,
      libraryFolders: discovery.libraryFolders,
      warnings: uniqueStrings(warnings)
    };
  }
}
