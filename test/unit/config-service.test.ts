import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigService } from '@steam-mcp/steam-core';

function createEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LOCALAPPDATA: path.join(os.tmpdir(), 'steam-mcp-config-service-test'),
    STEAM_API_KEY: undefined,
    STEAM_WEB_API_KEY: undefined,
    ...overrides
  };
}

test('config service parses default protected groups from JSON arrays', () => {
  const config = new ConfigService(createEnv({
    STEAM_DEFAULT_READ_ONLY_GROUPS: '[" Play ", "Completed", "play"]',
    STEAM_DEFAULT_IGNORE_GROUPS: '["Disliked", " Never Again "]'
  })).resolve();

  assert.deepEqual(config.defaultReadOnlyGroups, ['Completed', 'Play']);
  assert.deepEqual(config.defaultIgnoreGroups, ['Disliked', 'Never Again']);
});

test('config service rejects invalid default protected group env values', () => {
  assert.throws(
    () => new ConfigService(createEnv({
      STEAM_DEFAULT_READ_ONLY_GROUPS: '{"group":"Puzzle"}'
    })).resolve(),
    /STEAM_DEFAULT_READ_ONLY_GROUPS must be a JSON array of strings\./
  );

  assert.throws(
    () => new ConfigService(createEnv({
      STEAM_DEFAULT_IGNORE_GROUPS: '["Puzzle", 42]'
    })).resolve(),
    /STEAM_DEFAULT_IGNORE_GROUPS must be a JSON array of strings\./
  );
});

test('config service resolves Steam Web API key from MCP env aliases', () => {
  const fromPrimary = new ConfigService(createEnv({
    STEAM_API_KEY: '  primary-key  '
  })).resolve();
  assert.equal(fromPrimary.steamWebApiKey, 'primary-key');

  const fromAlias = new ConfigService(createEnv({
    STEAM_WEB_API_KEY: ' alias-key '
  })).resolve();
  assert.equal(fromAlias.steamWebApiKey, 'alias-key');
});

test('config service trims blank Steam Web API key values to undefined', () => {
  const config = new ConfigService(createEnv({
    STEAM_API_KEY: '   '
  })).resolve();

  assert.equal(config.steamWebApiKey, undefined);
});
