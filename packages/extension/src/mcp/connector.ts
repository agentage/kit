import { type Express } from 'express';
import { mountMcp, type McpAppOptions } from './mcp-app.js';
import { type ToolEntry } from './tools.js';

// The connector profile beside the mcp tools: /mcp{rest} becomes /connector{rest}, tools by their own name.
export const mountWithConnector = (
  app: Express,
  options: McpAppOptions,
  connectors: ToolEntry[]
) => {
  mountMcp(app, options);
  if (connectors.length === 0) return;
  const paths = (options.paths ?? ['/mcp']).map((path) => path.replace(/^\/mcp/, '/connector'));
  mountMcp(app, { ...options, tools: connectors, paths, bare: true, instructions: undefined });
};
