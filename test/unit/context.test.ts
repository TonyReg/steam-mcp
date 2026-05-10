import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createSteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import { materializeSteamFixture } from '../support/fixture-steam.js';

test('shared MCP context store client does not fall back to owned-game names for appdetails', async () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..'));
  const fixture = await materializeSteamFixture(repoRoot);
  fixture.env.STEAM_API_KEY = 'test-key';

  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requestedUrls.push(url.toString());

    if (url.hostname === 'store.steampowered.com' && url.pathname === '/api/appdetails') {
      return new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } }) as Response;
    }

    if (url.hostname === 'api.steampowered.com' && url.pathname === '/IPlayerService/GetOwnedGames/v1/') {
      return new Response(JSON.stringify({
        response: {
          games: [
            {
              appid: 2051120,
              name: 'Owned Fallback Name',
              playtime_forever: 0
            }
          ]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const context = createSteamMcpContext(fixture.env);
    const details = await context.storeClient.getAppDetails(2051120);

    assert.equal(details, undefined);
    assert.ok(requestedUrls.some((entry) => entry.includes('/api/appdetails')));
    assert.equal(requestedUrls.some((entry) => entry.includes('IPlayerService/GetOwnedGames')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
