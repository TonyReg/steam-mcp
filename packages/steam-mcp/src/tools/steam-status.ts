import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

export function registerSteamStatusTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_status',
    {
      title: 'Steam status',
      description: 'Inspect the local Steam environment, selected user, backend, and mutation safety state.',
      inputSchema: {}
    },
    async () => {
      const result = await context.statusService.getStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
