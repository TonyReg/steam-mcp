import { resolveSteamWebApiSteamId } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';

export type SelectedSteamUserResult =
  | { ok: true; steamId: string }
  | { ok: false; error: string };

export async function resolveSelectedSteamUserSteamId(
  context: Pick<SteamMcpContext, 'discoveryService'>,
  toolName: string
): Promise<SelectedSteamUserResult> {
  const discovery = await context.discoveryService.discover();
  const selectedUserId = discovery.selectedUserId;
  if (!selectedUserId) {
    return {
      ok: false,
      error: `No selected Steam user was found; ${toolName} requires a discoverable selected user.`
    };
  }

  const steamId = resolveSteamWebApiSteamId(selectedUserId);
  if (!steamId) {
    return {
      ok: false,
      error: `The selected Steam user could not be resolved to a SteamID64; ${toolName} requires a valid SteamID64.`
    };
  }

  return { ok: true, steamId };
}
