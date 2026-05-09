import { z } from 'zod';
import { resolveSteamWebApiSteamId } from '@steam-mcp/steam-core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamRecentlyPlayedInputShape = {
  limit: z.number().int().min(1).max(100).optional()
};

const steamRecentlyPlayedArgsSchema = z.object(steamRecentlyPlayedInputShape);
const steamRecentlyPlayedInputSchema: Record<string, z.ZodTypeAny> = steamRecentlyPlayedInputShape;

export function registerSteamRecentlyPlayedTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_recently_played',
    {
      title: 'Steam recently played',
      description: 'List recently played games for the selected Steam user via the official Steam Web API. Read-only and Steam Web API key dependent.',
      inputSchema: steamRecentlyPlayedInputSchema
    },
    async (rawArgs) => {
      const args = steamRecentlyPlayedArgsSchema.parse(rawArgs);
      const discovery = await context.discoveryService.discover();
      const selectedUserId = discovery.selectedUserId;
      if (!selectedUserId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'No selected Steam user was found; steam_recently_played requires a discoverable selected user.'
            }, null, 2)
          }]
        };
      }

      const steamId = resolveSteamWebApiSteamId(selectedUserId);
      if (!steamId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'The selected Steam user could not be resolved to a SteamID64; steam_recently_played requires a valid SteamID64.'
            }, null, 2)
          }]
        };
      }

      try {
        const result = await context.officialStoreClient.getRecentlyPlayedGames({ steamId });
        const games = (args.limit === undefined ? result.games : result.games.slice(0, args.limit)).map((game) => ({
          appId: game.appId,
          name: game.name ?? null,
          playtimeTwoWeeks: game.playtimeTwoWeeks ?? null,
          playtimeForever: game.playtimeForever ?? null,
          iconUrl: game.iconUrl ?? null
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalCount: result.totalCount,
              games
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown steam_recently_played failure.'
            }, null, 2)
          }]
        };
      }
    }
  );
}
