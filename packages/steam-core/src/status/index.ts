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
    const [config, discovery, steamRunning] = await Promise.all([
      this.configService.ensureStateDirectories(),
      this.discoveryService.discover(),
      this.safetyService.isSteamRunning()
    ]);

    const applyEnabled = discovery.collectionBackendId === 'cloudstorage-json' && runtimeConfig.collectionWritesEnabled;
    const warnings = [...discovery.warnings];

    if (!runtimeConfig.steamWebApiKey) {
      warnings.push('Steam Web API key not available in MCP runtime; owned non-installed game names may remain "Unknown App ..." when storefront metadata is unreachable.');
    } else if (!discovery.selectedUserId) {
      warnings.push('Steam Web API key is available, but no Steam user is selected; owned-game metadata fallback is inactive until discovery resolves a user.');
    }

    return {
      installDir: discovery.installDir,
      userIds: discovery.userIds,
      selectedUserId: discovery.selectedUserId,
      steamRunning,
      steamWebApiKeyAvailable: Boolean(runtimeConfig.steamWebApiKey),
      collectionBackendId: discovery.collectionBackendId,
      collectionSourcePath: discovery.collectionSourcePath,
      collectionApplyEnabled: applyEnabled,
      collectionApplySafe: applyEnabled && !steamRunning,
      stateDirectories: config,
      libraryFolders: discovery.libraryFolders,
      warnings: uniqueStrings(warnings)
    };
  }
}
