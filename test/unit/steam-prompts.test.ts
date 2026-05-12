import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../../packages/steam-mcp/src/context.js';
import type { ShallowPromptHandler, TextPromptResult } from '../../packages/steam-mcp/src/mcp/register-tool-shallow.js';
import { registerSteamPrompts } from '../../packages/steam-mcp/src/prompts/index.js';

type PromptResult = TextPromptResult;
type RegisteredPromptHandler = ShallowPromptHandler<PromptResult>;

function renderFirstPromptText(result: PromptResult): string {
  const firstMessage = result.messages[0];
  assert.ok(firstMessage);
  assert.equal(firstMessage.content.type, 'text');
  assert.equal(typeof firstMessage.content.text, 'string');
  return firstMessage.content.text;
}

function createPromptHarness() {
  const handlers = new Map<string, RegisteredPromptHandler>();
  const server = {
    registerPrompt(name: string, _config: unknown, cb: RegisteredPromptHandler) {
      handlers.set(name, cb);
    }
  } as unknown as McpServer;

  const context = {
    configService: {
      resolve: () => ({
        stateDirectories: {
          plansDir: 'plans'
        }
      })
    }
  } as unknown as SteamMcpContext;

  registerSteamPrompts(server, context);

  return {
    async invoke(name: string, rawArgs: unknown): Promise<PromptResult> {
      const handler = handlers.get(name);
      assert.ok(handler);
      return await handler(rawArgs);
    }
  };
}

test('steam recently played prompt renders limit and prerequisite guidance', async () => {
  const harness = createPromptHarness();

  const result = await harness.invoke('steam_recently_played', { limit: '7' });
  const text = renderFirstPromptText(result);

  assert.match(text, /Requested result limit: 7/);
  assert.match(text, /selected Steam user/);
  assert.match(text, /SteamID64/);
  assert.match(text, /steam_recently_played/);
  assert.match(text, /steam_find_similar/);
  assert.match(text, /STEAM_API_KEY/);
});

test('steam recently played prompt uses all-available guidance when limit is omitted', async () => {
  const harness = createPromptHarness();

  const result = await harness.invoke('steam_recently_played', {});
  const text = renderFirstPromptText(result);

  assert.match(text, /Requested result limit: all available recently played games/);
});

test('steam store query prompt renders bounded filter and prerequisite guidance', async () => {
  const harness = createPromptHarness();

  const result = await harness.invoke('steam_store_query', {
    limit: '12',
    types: 'game,dlc',
    language: 'japanese',
    countryCode: 'JP',
    comingSoonOnly: 'false',
    freeToPlay: 'true',
    includeFacets: 'true',
    genres: 'Puzzle, Adventure',
    categories: 'Single-player, Co-op',
    tags: 'Story Rich, Cozy',
    genresExclude: 'Horror',
    categoriesExclude: 'Multi-player',
    tagsExclude: 'Survival'
  });
  const text = renderFirstPromptText(result);

  assert.match(text, /Requested result limit: 12/);
  assert.match(text, /Requested store item types: game, dlc/);
  assert.match(text, /Requested language: japanese/);
  assert.match(text, /Requested country code: JP/);
  assert.match(text, /Coming soon only filter: false/);
  assert.match(text, /Free to play filter: true/);
  assert.match(text, /Include human-readable facets: true/);
  assert.match(text, /Requested genre filters: puzzle, adventure/);
  assert.match(text, /Requested category filters: single-player, co-op/);
  assert.match(text, /Requested tag filters: story rich, cozy/);
  assert.match(text, /Excluded genre filters: horror/);
  assert.match(text, /Excluded category filters: multi-player/);
  assert.match(text, /Excluded tag filters: survival/);
  assert.match(text, /OR within one facet family and AND across different facet families/);
  assert.match(text, /facet filtering is bounded post-filtering over the candidate window/);
  assert.match(text, /facetsAvailable=false/);
  assert.match(text, /steam_store_query/);
  assert.match(text, /STEAM_API_KEY/);
});

test('steam store query prompt uses default guidance when optional filters are omitted', async () => {
  const harness = createPromptHarness();

  const result = await harness.invoke('steam_store_query', {});
  const text = renderFirstPromptText(result);

  assert.match(text, /Requested result limit: leave unset so official client defaults apply/);
  assert.match(text, /Requested store item types: no explicit type filter/);
  assert.match(text, /Requested language: leave unset so the official client locale default applies/);
  assert.match(text, /Requested country code: leave unset so the official client country default applies/);
  assert.match(text, /Coming soon only filter: leave unset so official client defaults apply/);
  assert.match(text, /Free to play filter: no explicit filter/);
  assert.match(text, /Include human-readable facets: false unless explicitly requested/);
  assert.match(text, /Requested genre filters: none/);
  assert.match(text, /Excluded tag filters: none/);
});

test('steam featured scout prompt renders featured/editorial routing and authenticated prerequisite guidance', async () => {
  const harness = createPromptHarness();

  const result = await harness.invoke('steam_featured_scout', {
    limit: '8',
    types: 'game,software',
    language: 'japanese',
    countryCode: 'JP'
  });
  const text = renderFirstPromptText(result);

  assert.match(text, /Requested result limit: 8/);
  assert.match(text, /Requested featured item types: game, software/);
  assert.match(text, /Requested language: japanese/);
  assert.match(text, /Requested country code: JP/);
  assert.match(text, /steam_featured_scout/);
  assert.match(text, /GetItemsToFeature/);
  assert.match(text, /preserve marketing ordering after enrichment, deduplication, and bounded filtering/);
  assert.match(text, /steam_release_scout/);
  assert.match(text, /STEAM_API_KEY/);
});

test('steam featured scout prompt uses default bounded guidance when optional args are omitted', async () => {
  const harness = createPromptHarness();

  const result = await harness.invoke('steam_featured_scout', {});
  const text = renderFirstPromptText(result);

  assert.match(text, /Requested result limit: 20/);
  assert.match(text, /Requested featured item types: game, software, dlc/);
  assert.match(text, /Requested language: default official client locale/);
  assert.match(text, /Requested country code: default official client locale/);
});
