import type { GameRecord, SearchMatch, SimilarRequest, StoreSearchCandidate } from '../types.js';
import { scoreLibraryQueryMatch } from '../search/index.js';
import { normalizeCollectionName, toCollectionNameSet, uniqueStrings } from '../utils.js';

export class RecommendService {
  rankSimilarLibraryGames(games: GameRecord[], request: SimilarRequest): SearchMatch<GameRecord>[] {
    const ignoredCollections = toCollectionNameSet(request.ignoreCollections);
    const seedGames = this.resolveSeedGames(games, request, ignoredCollections);
    if (seedGames.length === 0) {
      return [];
    }

    const seedSignals = collectSignals(seedGames);

    return games
      .filter((game) => !seedGames.some((seed) => seed.appId === game.appId))
      .filter((game) => !isIgnoredByCollections(game, ignoredCollections))
      .filter((game) => !request.deckStatuses?.length || (game.deckStatus !== undefined && request.deckStatuses.includes(game.deckStatus)))
      .map((game) => {
        const reasons: string[] = [];
        let score = 0;

        for (const [label, values] of Object.entries({
          genre: game.genres,
          tag: game.tags,
          developer: game.developers,
          publisher: game.publishers,
          category: game.categories
        })) {
          for (const value of values ?? []) {
            if (seedSignals.has(value.toLowerCase())) {
              score += 10;
              reasons.push(`${label} overlap: ${value}`);
            }
          }
        }

        return { item: game, score, reasons: uniqueStrings(reasons) } satisfies SearchMatch<GameRecord>;
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
      .slice(0, request.limit ?? 10);
  }

  rankSimilarStoreCandidates(seedGames: GameRecord[], candidates: StoreSearchCandidate[]): SearchMatch<StoreSearchCandidate>[] {
    if (seedGames.length === 0) {
      return [];
    }

    const seedSignals = collectSignals(seedGames);

    return candidates
      .map((candidate) => {
        const reasons: string[] = [];
        let score = 0;

        for (const [label, values] of Object.entries({
          genre: candidate.genres,
          tag: candidate.tags,
          developer: candidate.developers,
          publisher: candidate.publishers
        })) {
          for (const value of values ?? []) {
            if (seedSignals.has(value.toLowerCase())) {
              score += 10;
              reasons.push(`${label} overlap: ${value}`);
            }
          }
        }

        return { item: candidate, score, reasons: uniqueStrings(reasons) } satisfies SearchMatch<StoreSearchCandidate>;
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name));
  }

  private resolveSeedGames(games: GameRecord[], request: SimilarRequest, ignoredCollections: Set<string>): GameRecord[] {
    if (request.seedAppIds?.length) {
      return games
        .filter((game) => request.seedAppIds?.includes(game.appId))
        .filter((game) => !isIgnoredByCollections(game, ignoredCollections));
    }

    if (request.query) {
      return games
        .filter((game) => !isIgnoredByCollections(game, ignoredCollections))
        .map((game) => scoreLibraryQueryMatch(game, request.query ?? ''))
        .filter((match) => match.score > 0)
        .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
        .slice(0, 3)
        .map((match) => match.item);
    }

    return [];
  }
}

function isIgnoredByCollections(game: GameRecord, ignoredCollections: Set<string>): boolean {
  if (ignoredCollections.size === 0) {
    return false;
  }

  return (game.collections ?? []).some((collection) => ignoredCollections.has(normalizeCollectionName(collection)));
}

function collectSignals(games: GameRecord[]): Set<string> {
  const values = new Set<string>();

  for (const game of games) {
    for (const entry of [
      ...(game.genres ?? []),
      ...(game.tags ?? []),
      ...(game.developers ?? []),
      ...(game.publishers ?? []),
      ...(game.categories ?? [])
    ]) {
      values.add(entry.toLowerCase());
    }
  }

  return values;
}
