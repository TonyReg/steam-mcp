import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigService } from '../../packages/steam-core/src/config/index.js';

function createEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LOCALAPPDATA: path.join(os.tmpdir(), 'steam-mcp-config-service-test'),
    STEAM_API_KEY: undefined,
    ...overrides
  };
}

test('config service parses default protected collections from JSON arrays', () => {
  const config = new ConfigService(createEnv({
    STEAM_DEFAULT_READ_ONLY_COLLECTIONS: '[" Play ", "Completed", "play"]',
    STEAM_DEFAULT_IGNORE_COLLECTIONS: '["Disliked", " Never Again "]'
  })).resolve();

  assert.deepEqual(config.defaultReadOnlyCollections, ['Completed', 'Play']);
  assert.deepEqual(config.defaultIgnoreCollections, ['Disliked', 'Never Again']);
});

test('config service rejects invalid default protected collection env values', () => {
  assert.throws(
    () => new ConfigService(createEnv({
      STEAM_DEFAULT_READ_ONLY_COLLECTIONS: '{"group":"Puzzle"}'
    })).resolve(),
    /STEAM_DEFAULT_READ_ONLY_COLLECTIONS must be a JSON array of strings\./
  );

  assert.throws(
    () => new ConfigService(createEnv({
      STEAM_DEFAULT_IGNORE_COLLECTIONS: '["Puzzle", 42]'
    })).resolve(),
    /STEAM_DEFAULT_IGNORE_COLLECTIONS must be a JSON array of strings\./
  );
});

test('config service resolves Steam Web API key from STEAM_API_KEY', () => {
  const config = new ConfigService(createEnv({
    STEAM_API_KEY: '  primary-key  '
  })).resolve();

  assert.equal(config.steamWebApiKey, 'primary-key');
});

test('config service trims blank Steam Web API key values to undefined', () => {
  const config = new ConfigService(createEnv({
    STEAM_API_KEY: '   '
  })).resolve();

  assert.equal(config.steamWebApiKey, undefined);
});

test('config service parses Windows orchestration flag from env', () => {
  assert.equal(new ConfigService(createEnv({
    STEAM_ENABLE_WINDOWS_ORCHESTRATION: '1'
  })).resolve().windowsOrchestrationEnabled, true);

  assert.equal(new ConfigService(createEnv({
    STEAM_ENABLE_WINDOWS_ORCHESTRATION: '0'
  })).resolve().windowsOrchestrationEnabled, false);

  assert.equal(new ConfigService(createEnv()).resolve().windowsOrchestrationEnabled, false);
});

test('config service resolves metadata state directory under the MCP root', () => {
  const config = new ConfigService(createEnv({
    STEAM_MCP_STATE_DIR: path.join(os.tmpdir(), 'steam-mcp-config-service-root')
  })).resolve();

  assert.equal(config.stateDirectories.metadataDir, path.join(config.stateDirectories.root, 'metadata'));
});

test('config service defaults store metadata ttl to 30 days and parses explicit day values', () => {
  const defaultConfig = new ConfigService(createEnv()).resolve();
  assert.equal(defaultConfig.storeAppDetailsCacheTtlMs, 30 * 24 * 60 * 60 * 1000);

  const blankConfig = new ConfigService(createEnv({
    STEAM_STORE_TTL_DAYS: '   '
  })).resolve();
  assert.equal(blankConfig.storeAppDetailsCacheTtlMs, 30 * 24 * 60 * 60 * 1000);

  const configured = new ConfigService(createEnv({
    STEAM_STORE_TTL_DAYS: ' 45 '
  })).resolve();
  assert.equal(configured.storeAppDetailsCacheTtlMs, 45 * 24 * 60 * 60 * 1000);
});

test('config service rejects invalid store metadata ttl env values', () => {
  for (const value of ['0', '-1', '1.5', 'abc', '12days', '9007199254740991']) {
    assert.throws(
      () => new ConfigService(createEnv({
        STEAM_STORE_TTL_DAYS: value
      })).resolve(),
      /STEAM_STORE_TTL_DAYS must be a positive integer number of days\./
    );
  }
});
