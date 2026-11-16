import { join } from 'node:path';
import { scopeOf } from '../auth/token-check.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { migratesStore } from '../manifest/parts.js';
import { prefixed, type ToolEntry } from '../mcp/tools.js';
import { sqlFiles } from '../store/migrations.js';
import { type RecordExtras } from './discovery.js';

// Each tool as tools/list names it, with the scope tools/call needs.
export const toolRecords = (id: string, tools: Pick<ToolEntry, 'name' | 'spec'>[]) =>
  tools.map((tool) => ({ name: prefixed(id, tool.name), scope: scopeOf(id, tool.spec.scope) }));

export const migrationsOf = async (dir: string, pkg: ExtensionPackage): Promise<RecordExtras> =>
  migratesStore(pkg) ? { migrations: (await sqlFiles(join(dir, 'migrations'))).length } : {};
