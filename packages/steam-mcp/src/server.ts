import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSteamMcpContext, type SteamMcpContext } from './context.js';
import { registerSteamPrompts } from './prompts/index.js';
import { registerSteamCollectionApplyTool } from './tools/steam-collection-apply.js';
import { registerSteamCollectionPlanTool } from './tools/steam-collection-plan.js';
import { registerSteamExportTool } from './tools/steam-export.js';
import { registerSteamFindSimilarTool } from './tools/steam-find-similar.js';
import { registerSteamLibraryListTool } from './tools/steam-library-list.js';
import { registerSteamLibrarySearchTool } from './tools/steam-library-search.js';
import { registerSteamLinkGenerateTool } from './tools/steam-link-generate.js';
import { registerSteamFeaturedScoutTool } from './tools/steam-featured-scout.js';
import { registerSteamStatusTool } from './tools/steam-status.js';
import { registerSteamReleaseScoutTool } from './tools/steam-release-scout.js';
import { registerSteamRecentlyPlayedTool } from './tools/steam-recently-played.js';
import { registerSteamWishlistTool } from './tools/steam-wishlist.js';
import { registerSteamWishlistDeckShortlistTool } from './tools/steam-wishlist-deck-shortlist.js';
import { registerSteamWishlistDetailsTool } from './tools/steam-wishlist-details.js';
import { registerSteamWishlistDiscountSummaryTool } from './tools/steam-wishlist-discount-summary.js';
import { registerSteamWishlistOnSaleTool } from './tools/steam-wishlist-on-sale.js';
import { registerSteamWishlistSearchTool } from './tools/steam-wishlist-search.js';
import { registerSteamStoreQueryTool } from './tools/steam-store-query.js';
import { registerSteamStoreSearchTool } from './tools/steam-store-search.js';

export function createServer(env: NodeJS.ProcessEnv = process.env, context: SteamMcpContext = createSteamMcpContext(env)): McpServer {
  const server = new McpServer({
    name: 'steam-mcp',
    version: '0.1.0'
  });

  registerSteamStatusTool(server, context);
  registerSteamLibraryListTool(server, context);
  registerSteamLibrarySearchTool(server, context);
  registerSteamStoreQueryTool(server, context);
  registerSteamStoreSearchTool(server, context);
  registerSteamFeaturedScoutTool(server, context);
  registerSteamReleaseScoutTool(server, context);
  registerSteamRecentlyPlayedTool(server, context);
  registerSteamWishlistTool(server, context);
  registerSteamWishlistOnSaleTool(server, context);
  registerSteamWishlistDetailsTool(server, context);
  registerSteamWishlistSearchTool(server, context);
  registerSteamWishlistDeckShortlistTool(server, context);
  registerSteamWishlistDiscountSummaryTool(server, context);
  registerSteamFindSimilarTool(server, context);
  registerSteamCollectionPlanTool(server, context);
  registerSteamCollectionApplyTool(server, context);
  registerSteamExportTool(server, context);
  registerSteamLinkGenerateTool(server, context);
  registerSteamPrompts(server, context);

  return server;
}

export async function ensureWindowsSteamStartup(context: SteamMcpContext, stderr: Pick<NodeJS.WriteStream, 'write'> = process.stderr): Promise<void> {
  const config = context.configService.resolve();

  if (!config.windowsOrchestrationEnabled || !context.safetyService.isWindowsOrchestrationSupported()) {
    return;
  }

  try {
    if (await context.safetyService.isSteamRunning()) {
      return;
    }

    const started = await context.safetyService.startSteamBestEffort();
    if (!started) {
      stderr.write('steam-mcp startup orchestration could not confirm Steam launch\n');
    }
  } catch {
    stderr.write('steam-mcp startup orchestration could not launch Steam\n');
  }
}

export async function startServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const context = createSteamMcpContext(env);
  await ensureWindowsSteamStartup(context);
  const server = createServer(env, context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('steam-mcp server connected\n');
}
