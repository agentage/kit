import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The check of the kit installed in this folder, as `agentage extension check` prints it.
const dir = process.cwd();
const entry = createRequire(join(dir, 'package.json')).resolve('@agentage/extension/tool');
const { check, checkLines } = await import(pathToFileURL(entry).href);
const report = await check(dir);
for (const line of checkLines(report)) console.log(line);
process.exit(report.conforms ? 0 : 1);
