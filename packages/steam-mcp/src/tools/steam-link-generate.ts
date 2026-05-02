import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SteamMcpContext } from '../context.js';
import { registerToolShallow } from '../mcp/register-tool-shallow.js';

const steamLinkGenerateInputShape = {
  appIds: z.array(z.number().int().positive()).min(1)
};

const steamLinkGenerateArgsSchema = z.object(steamLinkGenerateInputShape);
const steamLinkGenerateInputSchema: Record<string, z.ZodTypeAny> = steamLinkGenerateInputShape;

export function registerSteamLinkGenerateTool(server: McpServer, context: SteamMcpContext): void {
  registerToolShallow(
    server,
    'steam_link_generate',
    {
      title: 'Steam link generate',
      description: 'Generate steam:// and web links without executing them.',
      inputSchema: steamLinkGenerateInputSchema
    },
    async (rawArgs) => {
      const { appIds } = steamLinkGenerateArgsSchema.parse(rawArgs);
      const result = context.linkService.generateMany(appIds);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
