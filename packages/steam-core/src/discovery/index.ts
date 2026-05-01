import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@node-steam/vdf';
import type { SteamDiscoveryResult, SteamRuntimeConfig } from '../types.js';
import { isRecord } from '../utils.js';

export class SteamDiscoveryService {
  constructor(private readonly config: SteamRuntimeConfig) {}

  async discover(): Promise<SteamDiscoveryResult> {
    const warnings: string[] = [];
    const installDir = await this.resolveInstallDir();
    const userdataDir = this.config.userdataDirOverride ?? (installDir ? path.join(installDir, 'userdata') : undefined);
    const userIds = userdataDir ? await this.readSteamUserIds(userdataDir) : [];

    const selectedUserId = this.selectUserId(userIds, warnings);
    const selectedUserDir = selectedUserId && userdataDir ? path.join(userdataDir, selectedUserId) : undefined;
    const libraryFolders = installDir ? await this.readLibraryFolders(installDir, warnings) : [];

    const collectionSourcePath = selectedUserDir
      ? path.join(selectedUserDir, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json')
      : undefined;
    const collectionBackendId = collectionSourcePath && await exists(collectionSourcePath) ? 'cloudstorage-json' : undefined;
    const localConfigPath = selectedUserDir ? path.join(selectedUserDir, 'config', 'localconfig.vdf') : undefined;

    if (!installDir) {
      warnings.push('Steam install directory could not be detected. Set STEAM_INSTALL_DIR for deterministic discovery.');
    }

    if (!selectedUserId && userIds.length > 1) {
      warnings.push('Multiple Steam userdata directories detected. Set STEAM_ID to disambiguate.');
    }

    if (!collectionBackendId && selectedUserDir) {
      warnings.push('No writable cloudstorage-json collection backend detected for the selected user.');
    }

    return {
      installDir,
      userdataDir,
      userIds,
      selectedUserId,
      selectedUserDir,
      libraryFolders,
      collectionBackendId,
      collectionSourcePath,
      localConfigPath,
      warnings
    };
  }

  private async resolveInstallDir(): Promise<string | undefined> {
    if (this.config.installDirOverride && await exists(this.config.installDirOverride)) {
      return this.config.installDirOverride;
    }

    const candidates = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam'
    ];

    for (const candidate of candidates) {
      if (await exists(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private async readSteamUserIds(userdataDir: string): Promise<string[]> {
    if (!await exists(userdataDir)) {
      return [];
    }

    const entries = await readdir(userdataDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  }

  private selectUserId(userIds: string[], warnings: string[]): string | undefined {
    if (this.config.steamId) {
      if (userIds.includes(this.config.steamId)) {
        return this.config.steamId;
      }

      warnings.push(`Configured STEAM_ID ${this.config.steamId} was not found under userdata.`);
      return undefined;
    }

    if (userIds.length === 1) {
      return userIds[0];
    }

    return undefined;
  }

  private async readLibraryFolders(installDir: string, warnings: string[]): Promise<string[]> {
    const libraryFoldersPath = path.join(installDir, 'steamapps', 'libraryfolders.vdf');
    if (!await exists(libraryFoldersPath)) {
      warnings.push('libraryfolders.vdf was not found.');
      return [installDir];
    }

    const text = await readFile(libraryFoldersPath, 'utf8');
    const raw = parse(text) as unknown;
    const record = isRecord(raw) && isRecord(raw.libraryfolders) ? raw.libraryfolders : isRecord(raw) ? raw : undefined;
    if (!record) {
      warnings.push('libraryfolders.vdf could not be parsed as an object.');
      return [installDir];
    }

    const folders = new Set<string>([installDir]);
    for (const [key, value] of Object.entries(record)) {
      if (!/^\d+$/.test(key)) {
        continue;
      }

      if (typeof value === 'string') {
        folders.add(value);
        continue;
      }

      if (isRecord(value) && typeof value.path === 'string') {
        folders.add(value.path);
      }
    }

    return [...folders];
  }
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
