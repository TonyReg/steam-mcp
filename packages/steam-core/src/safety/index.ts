import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { ensurePathInsideRoot, normalizeAbsolutePath } from '../utils.js';

const execFile = promisify(execFileCallback);
const COLLECTION_FILE_NAMES = new Set(['cloud-storage-namespace-1.json', 'cloud-storage-namespaces.json']);

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

  async createBackups(sourcePaths: string[], backupsDir: string): Promise<Record<string, string>> {
    const backups = await Promise.all(sourcePaths.map(async (sourcePath) => {
      const backupPath = await this.createBackup(sourcePath, backupsDir);
      return [normalizeAbsolutePath(sourcePath), backupPath] as const;
    }));

    return Object.fromEntries(backups);
  }

  async atomicWrite(targetPath: string, content: string): Promise<void> {
    const normalizedTargetPath = normalizeAbsolutePath(targetPath);
    const tempPath = `${normalizedTargetPath}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, normalizedTargetPath);
  }

  async atomicWriteMany(writes: Array<{ targetPath: string; content: string }>): Promise<void> {
    for (const write of writes) {
      await this.atomicWrite(write.targetPath, write.content);
    }
  }

  async rollback(targetPath: string, backupPath: string): Promise<void> {
    const content = await readFile(normalizeAbsolutePath(backupPath), 'utf8');
    await this.atomicWrite(normalizeAbsolutePath(targetPath), content);
  }

  async rollbackMany(backupsByTargetPath: Record<string, string>): Promise<void> {
    for (const [targetPath, backupPath] of Object.entries(backupsByTargetPath)) {
      await this.rollback(targetPath, backupPath);
    }
  }

  assertCollectionWriteTarget(targetPath: string, selectedUserDir: string): string {
    const normalizedUserDir = normalizeAbsolutePath(selectedUserDir);
    const expectedDirectory = ensurePathInsideRoot(
      path.join(normalizedUserDir, 'config', 'cloudstorage'),
      normalizedUserDir,
      'Steam cloudstorage directory'
    );
    const normalizedTargetPath = ensurePathInsideRoot(targetPath, expectedDirectory, 'Steam collection target');
    const targetFileName = path.basename(normalizedTargetPath).toLowerCase();

    if (!COLLECTION_FILE_NAMES.has(targetFileName)) {
      throw new Error(`Steam collection writes are limited to ${[...COLLECTION_FILE_NAMES].join(', ')}.`);
    }

    return normalizedTargetPath;
  }

  assertCollectionWriteTargets(targetPaths: string[], selectedUserDir: string): string[] {
    return targetPaths.map((targetPath) => this.assertCollectionWriteTarget(targetPath, selectedUserDir));
  }
}
