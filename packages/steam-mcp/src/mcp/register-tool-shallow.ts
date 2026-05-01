import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ShallowToolConfig {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
  _meta?: Record<string, unknown>;
}

export interface TextToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

export type ShallowToolHandler<TResult = TextToolResult> = (
  rawArgs: unknown
) => TResult | Promise<TResult>;

export function registerToolShallow<TResult = TextToolResult>(
  server: McpServer,
  name: string,
  config: ShallowToolConfig,
  cb: ShallowToolHandler<TResult>
): void {
  const registerTool: unknown = Reflect.get(server, 'registerTool');
  if (typeof registerTool !== 'function') {
    throw new Error('McpServer.registerTool is unavailable.');
  }

  registerTool.call(server, name, config, cb);
}

export interface TextPromptResult {
  description?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: {
      type: 'text';
      text: string;
    };
  }>;
}

export interface ShallowPromptConfig {
  title?: string;
  description?: string;
  argsSchema?: unknown;
}

export type ShallowPromptHandler<TResult = TextPromptResult> = (
  rawArgs: unknown
) => TResult | Promise<TResult>;

export function registerPromptShallow<TResult = TextPromptResult>(
  server: McpServer,
  name: string,
  config: ShallowPromptConfig,
  cb: ShallowPromptHandler<TResult>
): void {
  const registerPrompt: unknown = Reflect.get(server, 'registerPrompt');
  if (typeof registerPrompt !== 'function') {
    throw new Error('McpServer.registerPrompt is unavailable.');
  }

  registerPrompt.call(server, name, config, cb);
}
