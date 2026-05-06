import { copyFile, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { ensurePathInsideRoot, normalizeAbsolutePath } from '../utils.js';

const execFile = promisify(execFileCallback);
const COLLECTION_FILE_NAMES = new Set(['cloud-storage-namespace-1.json', 'cloud-storage-namespace-1.modified.json', 'cloud-storage-namespaces.json']);

type ExecResult = Awaited<ReturnType<typeof execFile>>;

type ShutdownAttemptResult = {

  attempted: boolean;
  forced: boolean;
  succeeded: boolean;
  detail: string;
};

export class SafetyService {
  private lastSteamDetectorObservation: string | null = null;
  private lastSteamShutdownAttempt: string | null = null;

  constructor(private readonly steamRunningDetector?: () => Promise<boolean>) {}

  protected async resolveCanonicalPath(targetPath: string): Promise<string> {
    return normalizeAbsolutePath(await realpath(normalizeAbsolutePath(targetPath)));
  }

  isWindowsOrchestrationSupported(): boolean {
    return os.platform() === 'win32';
  }

  describeLastSteamShutdownAttempt(): string | null {
    return this.lastSteamShutdownAttempt;
  }

  protected async runExecFile(file: string, args: string[]): Promise<ExecResult> {
    return execFile(file, args);
  }

  private parseTasklistCsv(stdout: string, imageName: string): boolean {
    const normalizedImageName = imageName.toLowerCase();

    return stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .some((line) => {
        const [taskName] = this.parseCsvLine(line);
        return taskName?.toLowerCase() === normalizedImageName;
      });
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];

      if (character === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
          continue;
        }

        inQuotes = !inQuotes;
        continue;
      }

      if (character === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }

      current += character;
    }

    values.push(current);
    return values;
  }

  private stringifyExecOutput(output: string | NodeJS.ArrayBufferView | undefined): string {
    if (output === undefined) {
      return '';
    }

    return typeof output === 'string' ? output : Buffer.from(output.buffer, output.byteOffset, output.byteLength).toString('utf8');
  }

  private formatExecDetail(error: unknown, fallbackResult?: ExecResult): string {
    const errorWithStreams = error as NodeJS.ErrnoException & Partial<ExecResult> & { code?: number | string; signal?: NodeJS.Signals };
    const stderr = this.stringifyExecOutput(errorWithStreams.stderr).trim() || this.stringifyExecOutput(fallbackResult?.stderr).trim();
    if (stderr) {
      return stderr;
    }

    const stdout = this.stringifyExecOutput(errorWithStreams.stdout).trim() || this.stringifyExecOutput(fallbackResult?.stdout).trim();
    if (stdout) {
      return stdout;
    }

    if (typeof errorWithStreams.code === 'number' || typeof errorWithStreams.code === 'string') {
      return `exit ${String(errorWithStreams.code)}`;
    }

    if (errorWithStreams.signal) {
      return `signal ${errorWithStreams.signal}`;
    }

    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message.trim();
    }

    return 'unknown error';
  }

  private async runTaskkill(forced: boolean): Promise<ShutdownAttemptResult> {
    const args = ['/IM', 'steam.exe', '/T'];
    if (forced) {
      args.push('/F');
    }

    try {
      const result = await this.runExecFile('taskkill', args);
      const detail = this.stringifyExecOutput(result.stdout).trim() || this.stringifyExecOutput(result.stderr).trim() || 'ok';
      return { attempted: true, forced, succeeded: true, detail };
    } catch (error) {
      return {
        attempted: true,
        forced,
        succeeded: false,
        detail: this.formatExecDetail(error)
      };
    }
  }

  private formatShutdownAttempt(result: ShutdownAttemptResult): string {
    const mode = result.forced ? 'forced taskkill' : 'graceful taskkill';
    return result.succeeded ? `${mode} succeeded` : `${mode} failed: ${result.detail}`;
  }

  private summarizeShutdownAttempt(graceful: ShutdownAttemptResult, forced: ShutdownAttemptResult | null): string {
    const forcedSummary = forced
      ? forced.succeeded
        ? 'yes (succeeded)'
        : `yes (failed: ${forced.detail})`
      : 'no';

    return `${this.formatShutdownAttempt(graceful)}; forced taskkill attempted: ${forcedSummary}; last detector output: ${this.lastSteamDetectorObservation ?? 'unavailable'}`;
  }

  async isSteamRunning(): Promise<boolean> {
    if (this.steamRunningDetector) {
      const running = await this.steamRunningDetector();
      this.lastSteamDetectorObservation = running ? 'custom detector reported steam.exe present' : 'custom detector reported steam.exe absent';
      return running;
    }

    if (!this.isWindowsOrchestrationSupported()) {
      this.lastSteamDetectorObservation = 'steam detection unsupported on this runtime';
      return false;
    }

    try {
      const result = await this.runExecFile('tasklist', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq steam.exe']);
      const running = this.parseTasklistCsv(this.stringifyExecOutput(result.stdout), 'steam.exe');
      this.lastSteamDetectorObservation = running ? 'steam.exe still present' : 'steam.exe absent';
      return running;
    } catch (error) {
      this.lastSteamDetectorObservation = `tasklist failed: ${this.formatExecDetail(error)}`;
      return false;
    }
  }

  async stopSteamBestEffort(): Promise<boolean> {
    this.lastSteamShutdownAttempt = null;

    if (!this.isWindowsOrchestrationSupported()) {
      return false;
    }

    if (!(await this.isSteamRunning())) {
      this.lastSteamShutdownAttempt = 'Steam was already stopped before shutdown orchestration.';
      return true;
    }

    const gracefulAttempt = await this.runTaskkill(false);
    if (gracefulAttempt.succeeded) {
      await delay(2_000);
    }

    if (!(await this.isSteamRunning())) {
      this.lastSteamShutdownAttempt = this.summarizeShutdownAttempt(gracefulAttempt, null);
      return true;
    }

    const forcedAttempt = await this.runTaskkill(true);
    const stopped = !(await this.isSteamRunning());
    this.lastSteamShutdownAttempt = this.summarizeShutdownAttempt(gracefulAttempt, forcedAttempt);
    return stopped;
  }

  async waitForSteamStopped(timeoutMs = 20_000, pollIntervalMs = 250): Promise<boolean> {
    return this.waitForSteamState(false, timeoutMs, pollIntervalMs);
  }

  async startSteamBestEffort(timeoutMs = 5_000, pollIntervalMs = 250): Promise<boolean> {
    if (!this.isWindowsOrchestrationSupported()) {
      return false;
    }

    if (await this.isSteamRunning()) {
      return true;
    }

    try {
      await execFile('cmd', ['/c', 'start', '', 'steam://open/main']);
    } catch {
      return false;
    }

    return this.waitForSteamStarted(timeoutMs, pollIntervalMs);
  }

  async waitForSteamStarted(timeoutMs = 5_000, pollIntervalMs = 250): Promise<boolean> {
    return this.waitForSteamState(true, timeoutMs, pollIntervalMs);
  }

  protected async waitForSteamState(targetRunning: boolean, timeoutMs: number, pollIntervalMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      if (await this.isSteamRunning() === targetRunning) {
        return true;
      }

      if (Date.now() >= deadline) {
        return false;
      }

      await delay(Math.max(1, pollIntervalMs));
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
