import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '../../packages/steam-core/src/config/index.js';
import { SafetyService } from '../../packages/steam-core/src/safety/index.js';
import { StatusService } from '../../packages/steam-core/src/status/index.js';
import type { SteamDiscoveryResult } from '../../packages/steam-core/src/types.js';

class TestSafetyService extends SafetyService {
  constructor(
    steamRunning: boolean,
    private readonly supported: boolean
  ) {
    super(async () => steamRunning);
  }

  override isWindowsOrchestrationSupported(): boolean {
    return this.supported;
  }
}

function createConfig(overrides: NodeJS.ProcessEnv = {}) {
  return new ConfigService({
    ...process.env,
    LOCALAPPDATA: 'C:/temp/steam-mcp-status-test',
    STEAM_MCP_STATE_DIR: 'C:/temp/steam-mcp-status-test/state',
    STEAM_ENABLE_COLLECTION_WRITES: '1',
    STEAM_API_KEY: 'test-key',
    ...overrides
  });
}

function createDiscovery(): SteamDiscoveryResult {
  return {
    installDir: 'C:/Program Files (x86)/Steam',
    userdataDir: 'C:/Program Files (x86)/Steam/userdata',
    userIds: ['76561198000000000'],
    selectedUserId: '76561198000000000',
    selectedUserDir: 'C:/Program Files (x86)/Steam/userdata/76561198000000000',
    libraryFolders: ['C:/Program Files (x86)/Steam/steamapps'],
    collectionBackendId: 'cloudstorage-json',
    collectionSourcePath: 'C:/Program Files (x86)/Steam/userdata/76561198000000000/config/cloudstorage/cloud-storage-namespace-1.json',
    warnings: []
  };
}

test('status service keeps collectionApplySafe false when Steam is running without orchestration', async () => {
  const configService = createConfig();
  const discoveryService = { discover: async () => createDiscovery() };
  const safetyService = new TestSafetyService(true, true);
  const statusService = new StatusService(configService, discoveryService as never, safetyService);

  const status = await statusService.getStatus();

  assert.equal(status.collectionApplyEnabled, true);
  assert.equal(status.collectionApplySafe, false);
  assert.equal(status.windowsOrchestrationEnabled, false);
  assert.equal(status.windowsOrchestrationSupported, true);
});

test('status service reports collectionApplySafe true when orchestration is enabled and supported', async () => {
  const configService = createConfig({
    STEAM_ENABLE_WINDOWS_ORCHESTRATION: '1'
  });
  const discoveryService = { discover: async () => createDiscovery() };
  const safetyService = new TestSafetyService(true, true);
  const statusService = new StatusService(configService, discoveryService as never, safetyService);

  const status = await statusService.getStatus();

  assert.equal(status.collectionApplySafe, true);
  assert.equal(status.windowsOrchestrationEnabled, true);
  assert.equal(status.windowsOrchestrationSupported, true);
});

test('status service warns when orchestration is enabled on an unsupported platform', async () => {
  const configService = createConfig({
    STEAM_ENABLE_WINDOWS_ORCHESTRATION: '1'
  });
  const discoveryService = { discover: async () => createDiscovery() };
  const safetyService = new TestSafetyService(false, false);
  const statusService = new StatusService(configService, discoveryService as never, safetyService);

  const status = await statusService.getStatus();

  assert.equal(status.collectionApplySafe, false);
  assert.equal(status.windowsOrchestrationEnabled, true);
  assert.equal(status.windowsOrchestrationSupported, false);
  assert.ok(status.warnings.some((warning) => warning.includes('Windows orchestration is enabled, but this runtime is not supported')));
});


test('status service warns when STEAM_API_KEY is missing for API-authoritative membership', async () => {
  const configService = createConfig({
    STEAM_API_KEY: ''
  });
  const discoveryService = { discover: async () => createDiscovery() };
  const safetyService = new TestSafetyService(false, true);
  const statusService = new StatusService(configService, discoveryService as never, safetyService);

  const status = await statusService.getStatus();

  assert.ok(status.warnings.some((warning) => warning.includes('GetOwnedGames is the authoritative source for owned-game membership') && warning.includes('Library enumeration and collection planning')));
});

test('status service warns when no Steam user is selected for API-authoritative membership', async () => {
  const configService = createConfig();
  const discoveryService = {
    discover: async () => ({
      ...createDiscovery(),
      selectedUserId: undefined,
      selectedUserDir: undefined
    })
  };
  const safetyService = new TestSafetyService(false, true);
  const statusService = new StatusService(configService, discoveryService as never, safetyService);

  const status = await statusService.getStatus();

  assert.ok(status.warnings.some((warning) => warning.includes('no Steam user is selected') && warning.includes('GetOwnedGames')));
});
