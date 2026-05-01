import type { SteamLinks } from '../types.js';

export class LinkService {
  generate(appId: number): SteamLinks {
    return {
      store: `https://store.steampowered.com/app/${appId}/`,
      community: `https://steamcommunity.com/app/${appId}`,
      library: `steam://nav/games/details/${appId}`,
      launch: `steam://run/${appId}`
    };
  }

  generateMany(appIds: number[]): Record<string, SteamLinks> {
    return Object.fromEntries(appIds.map((appId) => [String(appId), this.generate(appId)]));
  }
}
