import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { SteamRuntimeConfig, SteamStateDirectories } from '../types.js';
import { normalizeAbsolutePath, normalizeOptionalAbsolutePath } from '../utils.js';

export class ConfigService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  resolve(): SteamRuntimeConfig {
    return {
      steamId: this.env.STEAM_ID,
      installDirOverride: normalizeOptionalAbsolutePath(this.env.STEAM_INSTALL_DIR),
      userdataDirOverride: normalizeOptionalAbsolutePath(this.env.STEAM_USERDATA_DIR),
      stateDirectories: this.resolveStateDirectories(),
      collectionWritesEnabled: this.env.STEAM_ENABLE_COLLECTION_WRITES === '1'
    };
  }

  async ensureStateDirectories(): Promise<SteamStateDirectories> {
    const directories = this.resolveStateDirectories();
    await Promise.all([
      mkdir(directories.root, { recursive: true }),
      mkdir(directories.plansDir, { recursive: true }),
      mkdir(directories.backupsDir, { recursive: true }),
      mkdir(directories.logsDir, { recursive: true })
    ]);
    return directories;
  }

  private resolveStateDirectories(): SteamStateDirectories {
    const configuredRoot = normalizeOptionalAbsolutePath(this.env.STEAM_MCP_STATE_DIR);
    const localAppData = normalizeOptionalAbsolutePath(this.env.LOCALAPPDATA)
      ?? normalizeAbsolutePath(path.join(this.env.HOME ?? process.cwd(), 'AppData', 'Local'));
    const root = configuredRoot ?? normalizeAbsolutePath(path.join(localAppData, 'steam-mcp'));

    return {
      root,
      plansDir: normalizeAbsolutePath(path.join(root, 'plans')),
      backupsDir: normalizeAbsolutePath(path.join(root, 'backups')),
      logsDir: normalizeAbsolutePath(path.join(root, 'logs'))
    };
  }
}
