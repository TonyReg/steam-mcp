import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OfficialRecentlyPlayedGamesResult } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { registerSteamRecentlyPlayedTool } from '../../packages/steam-mcp/src/tools/steam-recently-played.js';

type ToolResult = {
  content?: Array<{
    type: string;
    text?: string;
  }>;
};

type RegisteredToolHandler = (rawArgs: unknown) => ToolResult | Promise<ToolResult>;

function parseFirstTextContent(result: ToolResult): unknown {
  const firstContent = result.content?.[0];
  assert.ok(firstContent);
  assert.equal(firstContent.type, 'text');
  assert.equal(typeof firstContent.text, 'string');
  return JSON.parse(firstContent.text);
}

function createContext(options: {
  selectedUserId?: string;
  recentlyPlayedResult?: OfficialRecentlyPlayedGamesResult;
  recentlyPlayedError?: Error;
}) {
  const calls = {
    discover: 0,
    getRecentlyPlayedGames: [] as Array<unknown>
  };

  const context = {
    discoveryService: {
      discover: async () => {
        calls.discover += 1;
        return {
          userIds: options.selectedUserId ? [options.selectedUserId] : [],
          selectedUserId: options.selectedUserId,
          warnings: [],
          libraryFolders: []
        };
      }
    },
    officialStoreClient: {
      getRecentlyPlayedGames: async (request: unknown) => {
        calls.getRecentlyPlayedGames.push(request);
        if (options.recentlyPlayedError) {
          throw options.recentlyPlayedError;
        }

        return options.recentlyPlayedResult ?? { totalCount: 0, games: [] };
      }
    }
  } as unknown as SteamMcpContext;

  let handler: RegisteredToolHandler | undefined;
  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredToolHandler) {
      if (name === 'steam_recently_played') {
        handler = cb;
      }
    }
  } as unknown as McpServer;

  registerSteamRecentlyPlayedTool(server, context);
  assert.ok(handler);

  return {
    calls,
    invoke: (rawArgs: unknown) => handler(rawArgs)
  };
}

test('steam recently played returns totalCount and slices upstream-ordered games by limit', async () => {
  const harness = createContext({
    selectedUserId: '76561198000000000',
    recentlyPlayedResult: {
      totalCount: 3,
      games: [
        { appId: 620, name: 'Portal 2', playtimeTwoWeeks: 45, playtimeForever: 240, iconUrl: 'icon-620' },
        { appId: 440, name: 'Team Fortress 2', playtimeTwoWeeks: 30, playtimeForever: 1200, iconUrl: 'icon-440' },
        { appId: 570, name: 'Dota 2', playtimeTwoWeeks: 15, playtimeForever: 5000, iconUrl: 'icon-570' }
      ]
    }
  });

  const result = await harness.invoke({ limit: 2 });

  assert.deepEqual(parseFirstTextContent(result), {
    totalCount: 3,
    games: [
      { appId: 620, name: 'Portal 2', playtimeTwoWeeks: 45, playtimeForever: 240, iconUrl: 'icon-620' },
      { appId: 440, name: 'Team Fortress 2', playtimeTwoWeeks: 30, playtimeForever: 1200, iconUrl: 'icon-440' }
    ]
  });
  assert.deepEqual(harness.calls.getRecentlyPlayedGames, [{ steamId: '76561198000000000' }]);
});


test('steam recently played preserves fixed item keys when upstream omits optional fields', async () => {
  const harness = createContext({
    selectedUserId: '76561198000000000',
    recentlyPlayedResult: {
      totalCount: 1,
      games: [
        { appId: 440 }
      ]
    }
  });

  const result = await harness.invoke({});

  assert.deepEqual(parseFirstTextContent(result), {
    totalCount: 1,
    games: [
      {
        appId: 440,
        name: null,
        playtimeTwoWeeks: null,
        playtimeForever: null,
        iconUrl: null
      }
    ]
  });
});

test('steam recently played converts 32-bit selected user id to SteamID64 before fetching', async () => {
  const harness = createContext({
    selectedUserId: '12345',
    recentlyPlayedResult: {
      totalCount: 1,
      games: [{ appId: 620, name: 'Portal 2', playtimeTwoWeeks: 45, playtimeForever: 240, iconUrl: 'icon-620' }]
    }
  });

  await harness.invoke({});

  assert.deepEqual(harness.calls.getRecentlyPlayedGames, [{ steamId: '76561197960278073' }]);
});

test('steam recently played reports explicit error when no selected user is available', async () => {
  const harness = createContext({});

  const result = await harness.invoke({ limit: 5 });

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'No selected Steam user was found; steam_recently_played requires a discoverable selected user.'
  });
  assert.deepEqual(harness.calls.getRecentlyPlayedGames, []);
});

test('steam recently played reports explicit error when selected user cannot be resolved to SteamID64', async () => {
  const harness = createContext({
    selectedUserId: 'invalid-user'
  });

  const result = await harness.invoke({});

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'The selected Steam user could not be resolved to a SteamID64; steam_recently_played requires a valid SteamID64.'
  });
  assert.deepEqual(harness.calls.getRecentlyPlayedGames, []);
});

test('steam recently played surfaces upstream client errors including missing-key failures', async () => {
  const harness = createContext({
    selectedUserId: '76561198000000000',
    recentlyPlayedError: new Error('Steam Web API key is required for official recently-played access. Set STEAM_API_KEY.')
  });

  const result = await harness.invoke({});

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Steam Web API key is required for official recently-played access. Set STEAM_API_KEY.'
  });
});

test('steam recently played surfaces generic upstream failures', async () => {
  const harness = createContext({
    selectedUserId: '76561198000000000',
    recentlyPlayedError: new Error('Official recently-played request failed with status 503.')
  });

  const result = await harness.invoke({});

  assert.deepEqual(parseFirstTextContent(result), {
    error: 'Official recently-played request failed with status 503.'
  });
});
