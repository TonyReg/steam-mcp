import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigService } from '@steam-mcp/steam-core';

function createEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LOCALAPPDATA: path.join(os.tmpdir(), 'steam-mcp-config-service-test'),
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
