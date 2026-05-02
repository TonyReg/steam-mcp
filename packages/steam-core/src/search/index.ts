import type { GameRecord, LibrarySearchOptions, SearchMatch } from '../types.js';
import { normalizeCollectionName, normalizeWhitespace } from '../utils.js';

export class SearchService {
  searchLibrary(games: GameRecord[], options: LibrarySearchOptions): SearchMatch<GameRecord>[] {
    const query = normalizeWhitespace(options.query).toLowerCase();
    const results = games
      .filter((game) => this.filterGame(game, options))
      .map((game) => {
        const reasons: string[] = [];
        let score = 0;
        const normalizedName = game.name.toLowerCase();

        if (normalizedName === query) {
          score += 100;
          reasons.push('exact name match');
        } else if (normalizedName.startsWith(query)) {
          score += 80;
          reasons.push('prefix name match');
        } else if (normalizedName.includes(query)) {
          score += 60;
          reasons.push('name contains query');
        }

        const collections = game.collections ?? [];
        if (collections.some((collection) => collection.toLowerCase().includes(query))) {
          score += 20;
          reasons.push('collection match');
        }

        const tags = game.tags ?? [];
        if (tags.some((tag) => tag.toLowerCase().includes(query))) {
          score += 15;
          reasons.push('tag match');
        }

        return { item: game, score, reasons } satisfies SearchMatch<GameRecord>;
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name));

    return results.slice(0, options.limit ?? 20);
  }

  private filterGame(game: GameRecord, options: LibrarySearchOptions): boolean {
    if (options.favorite !== undefined && game.favorite !== options.favorite) {
      return false;
    }

    if (options.hidden !== undefined && game.hidden !== options.hidden) {
      return false;
    }

    if (options.played !== undefined) {
      const played = (game.playtimeMinutes ?? 0) > 0;
      if (played !== options.played) {
        return false;
      }
    }

    if (options.collections?.length) {
      const collectionSet = new Set((game.collections ?? []).map((collection) => normalizeCollectionName(collection)));
      if (!options.collections.every((collection) => collectionSet.has(normalizeCollectionName(collection)))) {
        return false;
      }
    }

    if (options.deckStatuses?.length && (!game.deckStatus || !options.deckStatuses.includes(game.deckStatus))) {
      return false;
    }

    return true;
  }
}
