import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { ensurePathInsideRoot, normalizeAbsolutePath } from '../utils.js';

const execFile = promisify(execFileCallback);
const COLLECTION_FILE_NAME = 'cloud-storage-namespace-1.json';

export class SafetyService {
  constructor(private readonly steamRunningDetector?: () => Promise<boolean>) {}

  async isSteamRunning(): Promise<boolean> {
    if (this.steamRunningDetector) {
      return this.steamRunningDetector();
    }

    if (os.platform() !== 'win32') {
      return false;
    }

    try {
      const result = await execFile('tasklist', ['/FI', 'IMAGENAME eq steam.exe']);
      return result.stdout.toLowerCase().includes('steam.exe');
    } catch {
      return false;
    }
  }

  async createBackup(sourcePath: string, backupsDir: string): Promise<string> {
    const normalizedSourcePath = normalizeAbsolutePath(sourcePath);
    const normalizedBackupsDir = normalizeAbsolutePath(backupsDir);

    await mkdir(normalizedBackupsDir, { recursive: true });
    const backupPath = path.join(normalizedBackupsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${path.basename(normalizedSourcePath)}`);
    await copyFile(normalizedSourcePath, backupPath);
    return backupPath;
  }

  async atomicWrite(targetPath: string, content: string): Promise<void> {
    const normalizedTargetPath = normalizeAbsolutePath(targetPath);
    const tempPath = `${normalizedTargetPath}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, normalizedTargetPath);
  }

  async rollback(targetPath: string, backupPath: string): Promise<void> {
    const content = await readFile(normalizeAbsolutePath(backupPath), 'utf8');
    await this.atomicWrite(normalizeAbsolutePath(targetPath), content);
  }

  assertCollectionWriteTarget(targetPath: string, selectedUserDir: string): string {
    const normalizedUserDir = normalizeAbsolutePath(selectedUserDir);
    const expectedDirectory = ensurePathInsideRoot(
      path.join(normalizedUserDir, 'config', 'cloudstorage'),
      normalizedUserDir,
      'Steam cloudstorage directory'
    );
    const normalizedTargetPath = ensurePathInsideRoot(targetPath, expectedDirectory, 'Steam collection target');

    if (path.basename(normalizedTargetPath).toLowerCase() !== COLLECTION_FILE_NAME) {
      throw new Error(`Steam collection writes are limited to ${COLLECTION_FILE_NAME}.`);
    }

    return normalizedTargetPath;
  }
}
