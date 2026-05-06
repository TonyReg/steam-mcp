import type { GameRecord, LibrarySearchOptions, SearchMatch } from '../types.js';
import { normalizeCollectionName, normalizeWhitespace } from '../utils.js';

export class SearchService {
  searchLibrary(games: GameRecord[], options: LibrarySearchOptions): SearchMatch<GameRecord>[] {
    const query = normalizeWhitespace(options.query).toLowerCase();
    const ignoredCollections = new Set((options.ignoreCollections ?? []).map((group) => normalizeCollectionName(group)));
    const results = games
      .filter((game) => this.filterGame(game, options, ignoredCollections))
      .map((game) => scoreLibraryQueryMatch(game, query))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name));

    return results.slice(0, options.limit ?? 20);
  }

  private filterGame(game: GameRecord, options: LibrarySearchOptions, ignoredCollections: Set<string>): boolean {
    if (ignoredCollections.size > 0 && (game.collections ?? []).some((collection) => ignoredCollections.has(normalizeCollectionName(collection)))) {
      return false;
    }

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

export function scoreLibraryQueryMatch(game: GameRecord, rawQuery: string): SearchMatch<GameRecord> {
  const query = normalizeWhitespace(rawQuery).toLowerCase();
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

  if ((game.collections ?? []).some((collection) => collection.toLowerCase().includes(query))) {
    score += 20;
    reasons.push('collection match');
  }

  if ((game.tags ?? []).some((tag) => tag.toLowerCase().includes(query))) {
    score += 15;
    reasons.push('tag match');
  }

  if ((game.genres ?? []).some((genre) => genre.toLowerCase().includes(query))) {
    score += 15;
    reasons.push('genre match');
  }

  if ((game.categories ?? []).some((category) => category.toLowerCase().includes(query))) {
    score += 15;
    reasons.push('category match');
  }

  return { item: game, score, reasons } satisfies SearchMatch<GameRecord>;
}
