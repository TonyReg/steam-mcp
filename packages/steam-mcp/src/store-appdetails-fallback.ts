import { OfficialStoreClient, resolveSteamWebApiSteamId } from '@steam-mcp/steam-core';

interface StoreAppDetailsFallbackOptions {
  fetchImpl?: typeof fetch;
  officialStoreClient: OfficialStoreClient;
  getSelectedUserId: () => Promise<string | undefined>;
}

export function createStoreAppDetailsFallbackFetch(options: StoreAppDetailsFallbackOptions): typeof fetch {
  const fetchImpl = options.fetchImpl ?? fetch;
  let cachedSteamId: Promise<string | undefined> | undefined;

  const getSteamId = async (): Promise<string | undefined> => {
    cachedSteamId ??= options.getSelectedUserId()
      .then((selectedUserId) => resolveSteamWebApiSteamId(selectedUserId))
      .catch(() => undefined);
    return cachedSteamId;
  };

  return async (input: URL | Request | string, init?: RequestInit): Promise<Response> => {
    const requestUrl = new URL(input instanceof Request ? input.url : String(input));
    if (!isStoreAppDetailsRequest(requestUrl)) {
      return fetchImpl(input, init);
    }

    const appId = requestUrl.searchParams.get('appids');
    if (!appId || !/^\d+$/.test(appId)) {
      return fetchImpl(input, init);
    }

    let storefrontResponse: Response | undefined;
    try {
      storefrontResponse = await fetchImpl(input, init);
      if (storefrontResponse.ok) {
        const storefrontPayload = await readJsonSafely(storefrontResponse.clone());
        if (isUsableAppDetailsPayload(appId, storefrontPayload)) {
          return storefrontResponse;
        }
      }
    } catch (error) {
      const fallbackResponse = await fetchOwnedGameName(appId, options.officialStoreClient, getSteamId);
      if (fallbackResponse) {
        return fallbackResponse;
      }

      throw error;
    }

    const fallbackResponse = await fetchOwnedGameName(appId, options.officialStoreClient, getSteamId);
    return fallbackResponse ?? storefrontResponse ?? fetchImpl(input, init);
  };
}

function isStoreAppDetailsRequest(url: URL): boolean {
  return url.origin === 'https://store.steampowered.com' && url.pathname === '/api/appdetails';
}

async function fetchOwnedGameName(
  appId: string,
  officialStoreClient: OfficialStoreClient,
  getSteamId: () => Promise<string | undefined>
): Promise<Response | undefined> {
  try {
    const steamId = await getSteamId();
    if (!steamId) {
      return undefined;
    }

    const numericAppId = Number.parseInt(appId, 10);
    const result = await officialStoreClient.getOwnedGames({
      steamId,
      includeAppInfo: true,
      includePlayedFreeGames: true,
      includeFreeSub: true,
      appIdsFilter: [numericAppId]
    });
    const name = result.games.find((game) => game.appId === numericAppId)?.name;
    if (!name) {
      return undefined;
    }

    return new Response(JSON.stringify({
      [appId]: {
        success: true,
        data: {
          steam_appid: numericAppId,
          name
        }
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }) as Response;
  } catch {
    return undefined;
  }
}

function isUsableAppDetailsPayload(appId: string, payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  const raw = payload[appId];
  return isRecord(raw)
    && raw.success === true
    && isRecord(raw.data)
    && typeof raw.data.name === 'string'
    && raw.data.name.trim() !== '';
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
