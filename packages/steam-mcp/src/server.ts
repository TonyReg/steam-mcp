import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSteamMcpContext } from './context.js';
import { registerSteamPrompts } from './prompts/index.js';
import { registerSteamCollectionApplyTool } from './tools/steam-collection-apply.js';
import { registerSteamCollectionPlanTool } from './tools/steam-collection-plan.js';
import { registerSteamExportTool } from './tools/steam-export.js';
import { registerSteamFindSimilarTool } from './tools/steam-find-similar.js';
import { registerSteamLibraryListTool } from './tools/steam-library-list.js';
import { registerSteamLibrarySearchTool } from './tools/steam-library-search.js';
import { registerSteamLinkGenerateTool } from './tools/steam-link-generate.js';
import { registerSteamStatusTool } from './tools/steam-status.js';
import { registerSteamStoreSearchTool } from './tools/steam-store-search.js';

export function createServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer({
    name: 'steam-mcp',
    version: '0.1.0'
  });
  const context = createSteamMcpContext(env);

  registerSteamStatusTool(server, context);
  registerSteamLibraryListTool(server, context);
  registerSteamLibrarySearchTool(server, context);
  registerSteamStoreSearchTool(server, context);
  registerSteamFindSimilarTool(server, context);
  registerSteamCollectionPlanTool(server, context);
  registerSteamCollectionApplyTool(server, context);
  registerSteamExportTool(server, context);
  registerSteamLinkGenerateTool(server, context);
  registerSteamPrompts(server, context);

  return server;
}

export async function startServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const server = createServer(env);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('steam-mcp server connected\n');
}
