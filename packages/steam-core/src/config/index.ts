import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { SteamRuntimeConfig, SteamStateDirectories } from '../types.js';
import { normalizeAbsolutePath, normalizeOptionalAbsolutePath, uniqueCollectionNames } from '../utils.js';

export class ConfigService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  resolve(): SteamRuntimeConfig {
    const steamWebApiKey = normalizeOptionalEnvValue(this.env.STEAM_API_KEY ?? this.env.STEAM_WEB_API_KEY);

    return {
      steamId: this.env.STEAM_ID,
      steamWebApiKey,
      installDirOverride: normalizeOptionalAbsolutePath(this.env.STEAM_INSTALL_DIR),
      userdataDirOverride: normalizeOptionalAbsolutePath(this.env.STEAM_USERDATA_DIR),
      stateDirectories: this.resolveStateDirectories(),
      collectionWritesEnabled: this.env.STEAM_ENABLE_COLLECTION_WRITES === '1',
      windowsOrchestrationEnabled: this.env.STEAM_ENABLE_WINDOWS_ORCHESTRATION === '1',
      defaultReadOnlyCollections: this.parseDefaultCollectionEnv('STEAM_DEFAULT_READ_ONLY_COLLECTIONS'),
      defaultIgnoreCollections: this.parseDefaultCollectionEnv('STEAM_DEFAULT_IGNORE_COLLECTIONS')
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

  private parseDefaultCollectionEnv(name: 'STEAM_DEFAULT_READ_ONLY_COLLECTIONS' | 'STEAM_DEFAULT_IGNORE_COLLECTIONS'): string[] {
    const rawValue = this.env[name];
    if (!rawValue || rawValue.trim() === '') {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      throw new Error(`${name} must be a JSON array of strings.`);
    }

    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
      throw new Error(`${name} must be a JSON array of strings.`);
    }

    return uniqueCollectionNames(parsed);
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

function normalizeOptionalEnvValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
