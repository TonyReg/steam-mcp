import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { deckStatusSchema, planModeSchema } from '../schemas/index.js';
import { registerPromptShallow } from '../mcp/register-tool-shallow.js';

const steamLibraryCuratorPromptArgs = {
  goal: z.string().min(1),
  deckStatus: deckStatusSchema.optional()
};
const steamLibraryCuratorPromptSchema = z.object(steamLibraryCuratorPromptArgs);

const steamCollectionPlannerPromptArgs = {
  request: z.string().min(1),
  mode: planModeSchema.optional()
};
const steamCollectionPlannerPromptSchema = z.object(steamCollectionPlannerPromptArgs);

const steamDeckBacklogPromptArgs = {
  focus: z.string().optional(),
  deckStatus: deckStatusSchema.optional()
};
const steamDeckBacklogPromptSchema = z.object(steamDeckBacklogPromptArgs);

export function registerSteamPrompts(server: McpServer, context: SteamMcpContext): void {
  registerPromptShallow(
    server,
    'steam_library_curator',
    {
      title: 'Steam library curator',
      description: 'Guide an agent through safe library analysis, search, recommendation, export, and deep-link flows.',
      argsSchema: steamLibraryCuratorPromptArgs
    },
    (rawArgs: unknown) => {
      const { goal, deckStatus } = steamLibraryCuratorPromptSchema.parse(rawArgs);
      return {
        description: 'Safe workflow for analyzing and organizing a Steam library without mutating Steam-owned state.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the Steam MCP to analyze a local Steam library safely.',
              `Goal: ${goal}`,
              deckStatus ? `Prefer this Steam Deck status when useful: ${deckStatus}.` : 'Use Deck filters only when they improve the answer.',
              'Workflow:',
              '1. Call steam_status first and confirm the detected Steam user, collection backend, and whether collection writes are enabled.',
              '2. Use steam_library_list or steam_library_search to inspect the local library. Add steam_store_search or steam_find_similar only when you need enrichment or comparison.',
              '3. Use steam_export for JSON/Markdown handoff and steam_link_generate for store, community, library, or launch links.',
              '4. Stay read-only by default. If the user asks to reorganize categories, switch to the steam_collection_planner prompt before considering any write path.',
              '5. Explain the reasoning for recommendations or filters in deterministic terms such as shared tags, genres, playtime, favorites, or Deck status.'
            ].join('\n')
          }
        }]
      };
    }
  );

  registerPromptShallow(
    server,
    'steam_collection_planner',
    {
      title: 'Steam collection planner',
      description: 'Guide an agent through the safe, plan-first workflow for favorites, hidden flags, and named collections.',
      argsSchema: steamCollectionPlannerPromptArgs
    },
    (rawArgs: unknown) => {
      const { request, mode } = steamCollectionPlannerPromptSchema.parse(rawArgs);
      const config = context.configService.resolve();

      return {
        description: 'Plan-first workflow for collection changes without directly mutating Steam-owned state.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the Steam MCP to plan collection changes safely.',
              `Collection request: ${request}`,
              `Requested plan mode: ${mode ?? 'add-only'}.`,
              `Durable preview plans live under: ${config.stateDirectories.plansDir}`,
              'Workflow:',
              '1. Call steam_status first and confirm the selected Steam user, cloudstorage-json backend, and whether Steam-owned writes are enabled.',
              '2. Use steam_library_search or steam_library_list to inspect the candidate games that match the request.',
              '3. Call steam_collection_plan to create a durable preview artifact. Review matchedGames, warnings, destructive status, and the durable plan identifier before proposing any apply step.',
              '4. Do not call steam_collection_apply unless the user explicitly asks to mutate Steam-owned state and the write gate is enabled.',
              '5. Remind the user that apply is backup-first, drift-checked, atomic, rollback-capable, and requires Steam to be closed by default.'
            ].join('\n')
          }
        }]
      };
    }
  );

  registerPromptShallow(
    server,
    'steam_deck_backlog_triage',
    {
      title: 'Steam Deck backlog triage',
      description: 'Guide an agent through Deck-friendly backlog filtering, ranking, export, and launch-link generation.',
      argsSchema: steamDeckBacklogPromptArgs
    },
    (rawArgs: unknown) => {
      const { focus, deckStatus } = steamDeckBacklogPromptSchema.parse(rawArgs);
      return {
        description: 'Workflow for finding the best local backlog candidates for Steam Deck play.',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Use the Steam MCP to triage the backlog for Steam Deck play.',
              focus ? `User focus: ${focus}` : 'User focus: find the best near-term Deck-friendly backlog choices.',
              `Primary Deck filter: ${deckStatus ?? 'verified'}.`,
              'Workflow:',
              '1. Call steam_status to confirm the environment and backend state.',
              '2. Use steam_library_search with played=false and the requested deckStatuses filter to narrow the backlog.',
              '3. Use steam_find_similar when you need to rank candidates by overlap with the user’s known favorites or recent play patterns.',
              '4. Use steam_export to produce a Markdown shortlist or JSON payload, and steam_link_generate to provide store/library/launch links for the finalists.',
              '5. Keep the reasoning explicit and deterministic: Deck status, genres, tags, collections, favorites, hidden flags, and playtime.'
            ].join('\n')
          }
        }]
      };
    }
  );
}
