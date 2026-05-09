const STEAM_ID64_OFFSET = 76561197960265728n;

interface StoreAppDetailsFallbackOptions {
  fetchImpl?: typeof fetch;
  steamWebApiKey?: string;
  getSelectedUserId: () => Promise<string | undefined>;
}

export function createStoreAppDetailsFallbackFetch(options: StoreAppDetailsFallbackOptions): typeof fetch {
  const fetchImpl = options.fetchImpl ?? fetch;
  // Cache the resolved Steam Web API steamid for the lifetime of this MCP server instance.
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
      const fallbackResponse = await fetchOwnedGameName(appId, options.steamWebApiKey, getSteamId, fetchImpl);
      if (fallbackResponse) {
        return fallbackResponse;
      }

      throw error;
    }

    const fallbackResponse = await fetchOwnedGameName(appId, options.steamWebApiKey, getSteamId, fetchImpl);
    return fallbackResponse ?? storefrontResponse ?? fetchImpl(input, init);
  };
}

function isStoreAppDetailsRequest(url: URL): boolean {
  return url.origin === 'https://store.steampowered.com' && url.pathname === '/api/appdetails';
}

function resolveSteamWebApiSteamId(selectedUserId: string | undefined): string | undefined {
  if (!selectedUserId || !/^\d+$/.test(selectedUserId)) {
    return undefined;
  }

  // SteamID64 values are 17 digits; shorter numeric userdata folder names are treated as account IDs.
  if (selectedUserId.length >= 17) {
    return selectedUserId;
  }

  return String(STEAM_ID64_OFFSET + BigInt(selectedUserId));
}

async function fetchOwnedGameName(
  appId: string,
  steamWebApiKey: string | undefined,
  getSteamId: () => Promise<string | undefined>,
  fetchImpl: typeof fetch
): Promise<Response | undefined> {
  if (!steamWebApiKey) {
    return undefined;
  }

  try {
    const steamId = await getSteamId();
    if (!steamId) {
      return undefined;
    }

    const numericAppId = Number.parseInt(appId, 10);
    const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/');
    url.searchParams.set('key', steamWebApiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set(
      'input_json',
      `{"steamid":${steamId},"include_appinfo":true,"include_played_free_games":true,"appids_filter":[${numericAppId}]}`
    );

    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as unknown;
    const name = readOwnedGameName(payload, Number.parseInt(appId, 10));
    if (!name) {
      return undefined;
    }

    return new Response(JSON.stringify({
      [appId]: {
        success: true,
        data: {
          steam_appid: Number.parseInt(appId, 10),
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

function readOwnedGameName(payload: unknown, appId: number): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.response) || !Array.isArray(payload.response.games)) {
    return undefined;
  }

  for (const game of payload.response.games) {
    if (!isRecord(game) || game.appid !== appId || typeof game.name !== 'string' || game.name.trim() === '') {
      continue;
    }

    return game.name;
  }

  return undefined;
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
