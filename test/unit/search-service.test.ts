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
