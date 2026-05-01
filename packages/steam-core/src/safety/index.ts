import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

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
    await mkdir(backupsDir, { recursive: true });
    const backupPath = path.join(backupsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${path.basename(sourcePath)}`);
    await copyFile(sourcePath, backupPath);
    return backupPath;
  }

  async atomicWrite(targetPath: string, content: string): Promise<void> {
    const tempPath = `${targetPath}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, targetPath);
  }

  async rollback(targetPath: string, backupPath: string): Promise<void> {
    const content = await readFile(backupPath, 'utf8');
    await this.atomicWrite(targetPath, content);
  }
}
