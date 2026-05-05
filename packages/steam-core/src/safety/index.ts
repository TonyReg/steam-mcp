import { copyFile, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { ensurePathInsideRoot, normalizeAbsolutePath } from '../utils.js';

const execFile = promisify(execFileCallback);
const COLLECTION_FILE_NAMES = new Set(['cloud-storage-namespace-1.json', 'cloud-storage-namespace-1.modified.json', 'cloud-storage-namespaces.json']);

export class SafetyService {
  constructor(private readonly steamRunningDetector?: () => Promise<boolean>) {}

  protected async resolveCanonicalPath(targetPath: string): Promise<string> {
    return normalizeAbsolutePath(await realpath(normalizeAbsolutePath(targetPath)));
  }

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

  async createBackups(sourcePaths: string[], backupsDir: string): Promise<Record<string, string | null>> {
    const backups = await Promise.all(sourcePaths.map(async (sourcePath) => {
      const normalizedSourcePath = normalizeAbsolutePath(sourcePath);

      try {
        const backupPath = await this.createBackup(normalizedSourcePath, backupsDir);
        return [normalizedSourcePath, backupPath] as const;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }

        return [normalizedSourcePath, null] as const;
      }
    }));

    return Object.fromEntries(backups);
  }

  async atomicWrite(targetPath: string, content: string): Promise<void> {
    const normalizedTargetPath = normalizeAbsolutePath(targetPath);
    const tempPath = `${normalizedTargetPath}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, normalizedTargetPath);
  }

  async atomicWriteMany(writes: Array<{ targetPath: string; content: string }>): Promise<string[]> {
    const writtenTargetPaths: string[] = [];

    try {
      for (const write of writes) {
        await this.atomicWrite(write.targetPath, write.content);
        writtenTargetPaths.push(normalizeAbsolutePath(write.targetPath));
      }
    } catch (error) {
      (error as Error & { writtenTargetPaths?: string[] }).writtenTargetPaths = writtenTargetPaths;
      throw error;
    }

    return writtenTargetPaths;
  }

  async rollback(targetPath: string, backupPath: string | null, writtenTargetPaths?: Set<string>): Promise<void> {
    const normalizedTargetPath = normalizeAbsolutePath(targetPath);

    if (backupPath === null) {
      if (!writtenTargetPaths?.has(normalizedTargetPath)) {
        return;
      }

      await rm(normalizedTargetPath, { force: true });
      return;
    }

    const content = await readFile(normalizeAbsolutePath(backupPath), 'utf8');
    await this.atomicWrite(normalizedTargetPath, content);
  }

  async rollbackMany(backupsByTargetPath: Record<string, string | null>, writtenTargetPaths?: Iterable<string>): Promise<void> {
    const normalizedWrittenTargetPaths = writtenTargetPaths ? new Set([...writtenTargetPaths].map((targetPath) => normalizeAbsolutePath(targetPath))) : undefined;
    const rollbackErrors: Error[] = [];

    for (const [targetPath, backupPath] of Object.entries(backupsByTargetPath)) {
      try {
        await this.rollback(targetPath, backupPath, normalizedWrittenTargetPaths);
      } catch (error) {
        rollbackErrors.push(error as Error);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError(rollbackErrors, `Collection rollback failed for ${rollbackErrors.length} target(s).`);
    }
  }

  async assertCollectionWriteTarget(targetPath: string, selectedUserDir: string): Promise<string> {
    const normalizedUserDir = normalizeAbsolutePath(selectedUserDir);
    const canonicalUserDir = await this.resolveCanonicalPath(normalizedUserDir);
    const expectedDirectory = ensurePathInsideRoot(
      path.join(normalizedUserDir, 'config', 'cloudstorage'),
      normalizedUserDir,
      'Steam cloudstorage directory'
    );
    const canonicalExpectedDirectory = await this.resolveCanonicalPath(expectedDirectory);
    ensurePathInsideRoot(canonicalExpectedDirectory, canonicalUserDir, 'Steam cloudstorage directory real path');
    const normalizedTargetPath = ensurePathInsideRoot(targetPath, expectedDirectory, 'Steam collection target');
    const targetFileName = path.basename(normalizedTargetPath).toLowerCase();

    if (!COLLECTION_FILE_NAMES.has(targetFileName)) {
      throw new Error(`Steam collection writes are limited to ${[...COLLECTION_FILE_NAMES].join(', ')}.`);
    }

    const canonicalTargetDirectory = await this.resolveCanonicalPath(path.dirname(normalizedTargetPath));
    ensurePathInsideRoot(canonicalTargetDirectory, canonicalExpectedDirectory, 'Steam collection target real path');
    return normalizeAbsolutePath(path.join(canonicalTargetDirectory, path.basename(normalizedTargetPath)));
  }

  async assertCollectionWriteTargets(targetPaths: string[], selectedUserDir: string): Promise<string[]> {
    return Promise.all(targetPaths.map((targetPath) => this.assertCollectionWriteTarget(targetPath, selectedUserDir)));
  }
}
