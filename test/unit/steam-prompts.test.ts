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
