import assert from 'node:assert/strict';
import test from 'node:test';
import { RecommendService, type GameRecord } from '@steam-mcp/steam-core';

test('recommend service ignores collections case-insensitively for seed ids and results', () => {
  const games: GameRecord[] = [
    {
      appId: 1,
      name: 'Portal 2',
      collections: ['Disliked'],
      genres: ['Puzzle'],
      tags: ['Co-op']
    },
    {
      appId: 2,
      name: 'The Talos Principle',
      collections: ['Backlog'],
      genres: ['Puzzle'],
      tags: ['First-Person']
    },
    {
      appId: 3,
      name: 'The Witness',
      collections: ['DISLIKED'],
      genres: ['Puzzle'],
      tags: ['First-Person']
    },
    {
      appId: 4,
      name: 'Superliminal',
      collections: ['Backlog'],
      genres: ['Puzzle'],
      tags: ['First-Person']
    }
  ];

  const service = new RecommendService();
  const matches = service.rankSimilarLibraryGames(games, {
    seedAppIds: [1, 2],
    ignoreCollections: [' disliked '],
    limit: 10
  });

  assert.deepEqual(matches.map((match) => match.item.appId), [4]);
});

test('recommend service ignores query-based seeds from ignored collections', () => {
  const games: GameRecord[] = [
    {
      appId: 1,
      name: 'Portal 2',
      collections: ['Disliked'],
      genres: ['Puzzle'],
      tags: ['Co-op']
    },
    {
      appId: 2,
      name: 'Portal Stories: Mel',
      collections: ['Backlog'],
      genres: ['Puzzle'],
      tags: ['Co-op']
    }
  ];

  const service = new RecommendService();
  const matches = service.rankSimilarLibraryGames(games, {
    query: 'portal 2',
    ignoreCollections: ['DISLIKED'],
    limit: 10
  });

  assert.deepEqual(matches, []);
});

test('recommend service uses metadata-aware query seeds instead of name-only matching', () => {
  const games: GameRecord[] = [
    {
      appId: 1,
      name: 'Portal 2',
      collections: ['Backlog'],
      genres: ['Adventure'],
      categories: ['Single-player'],
      tags: ['Co-op']
    },
    {
      appId: 2,
      name: 'The Talos Principle',
      collections: ['Backlog'],
      genres: ['Puzzle'],
      categories: ['Single-player'],
      tags: ['Philosophical']
    },
    {
      appId: 3,
      name: 'Firewatch',
      collections: ['Backlog'],
      genres: ['Adventure'],
      categories: ['Single-player'],
      tags: ['Story Rich']
    }
  ];

  const service = new RecommendService();
  const matches = service.rankSimilarLibraryGames(games, {
    query: 'adventure',
    limit: 10
  });

  assert.deepEqual(matches.map((match) => match.item.appId), [2]);
  assert.deepEqual(matches[0]?.reasons.sort((left, right) => left.localeCompare(right)), ['category overlap: Single-player']);
});
