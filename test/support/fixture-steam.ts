import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface MaterializedSteamFixture {
  rootDir: string;
  installDir: string;
  secondaryLibraryDir: string;
  stateDir: string;
  steamId: string;
  env: NodeJS.ProcessEnv;
}

export async function materializeSteamFixture(repoRoot: string, enableWrites = false): Promise<MaterializedSteamFixture> {
  const fixtureRoot = path.join(repoRoot, 'fixtures', 'steam');
  const rootDir = path.join(os.tmpdir(), `steam-mcp-fixture-${randomUUID()}`);
  const installDir = path.join(rootDir, 'install');
  const secondaryLibraryDir = path.join(rootDir, 'secondary-library');
  const stateDir = path.join(rootDir, 'state');

  await mkdir(rootDir, { recursive: true });
  await cp(path.join(fixtureRoot, 'install'), installDir, { recursive: true });
  await cp(path.join(fixtureRoot, 'secondary-library'), secondaryLibraryDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const libraryFoldersPath = path.join(installDir, 'steamapps', 'libraryfolders.vdf');
  const libraryFolders = await readFile(libraryFoldersPath, 'utf8');
  await writeFile(
    libraryFoldersPath,
    libraryFolders.replaceAll('__INSTALL_DIR__', installDir).replaceAll('__SECOND_LIBRARY__', secondaryLibraryDir),
    'utf8'
  );

  return {
    rootDir,
    installDir,
    secondaryLibraryDir,
    stateDir,
    steamId: '76561198000000000',
    env: {
      ...process.env,
      LOCALAPPDATA: rootDir,
      STEAM_INSTALL_DIR: installDir,
      STEAM_ID: '76561198000000000',
      STEAM_ENABLE_COLLECTION_WRITES: enableWrites ? '1' : '0',
      STEAM_MCP_STATE_DIR: stateDir
    }
  };
}
