import assert from 'node:assert/strict';
import test from 'node:test';
import { SearchService, type GameRecord } from '@steam-mcp/steam-core';

test('search service ignores collections case-insensitively', () => {
  const games: GameRecord[] = [
    {
      appId: 1,
      name: 'Portal 2',
      collections: ['Disliked'],
      tags: ['Puzzle']
    },
    {
      appId: 2,
      name: 'Portal Stories: Mel',
      collections: ['Backlog'],
      tags: ['Puzzle']
    },
    {
      appId: 3,
      name: 'Half-Life 2',
      collections: ['Finished'],
      tags: ['Action']
    }
  ];

  const service = new SearchService();
  const matches = service.searchLibrary(games, {
    query: 'portal',
    ignoreCollections: [' disliked '],
    limit: 10
  });

  assert.deepEqual(matches.map((match) => match.item.appId), [2]);
});

test('search service matches genres and categories while keeping name hits ahead of metadata-only hits', () => {
  const games: GameRecord[] = [
    {
      appId: 1,
      name: 'Racing Apex',
      collections: ['Backlog'],
      genres: ['Sports'],
      categories: ['Multiplayer'],
      tags: ['Arcade']
    },
    {
      appId: 2,
      name: 'HOT WHEELS UNLEASHED™ 2 - Turbocharged',
      collections: ['Racing'],
      genres: ['Racing'],
      categories: ['Single-player'],
      tags: ['Arcade']
    },
    {
      appId: 3,
      name: 'Portal 2',
      collections: ['Puzzle'],
      genres: ['Adventure'],
      categories: ['Single-player'],
      tags: ['Co-op']
    }
  ];

  const service = new SearchService();

  const racingMatches = service.searchLibrary(games, {
    query: 'racing',
    limit: 10
  });
  assert.deepEqual(racingMatches.map((match) => match.item.appId), [1, 2]);
  assert.deepEqual(racingMatches[0]?.reasons, ['prefix name match']);
  assert.deepEqual(racingMatches[1]?.reasons, ['collection match', 'genre match']);

  const categoryMatches = service.searchLibrary(games, {
    query: 'single-player',
    limit: 10
  });
  assert.deepEqual(categoryMatches.map((match) => match.item.appId), [2, 3]);
  assert.deepEqual(categoryMatches.map((match) => match.reasons), [['category match'], ['category match']]);
});
