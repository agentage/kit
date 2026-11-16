import { readFile } from 'node:fs/promises';
import { messageOf } from '../log/log.js';

export const STORE_URL_FILE_ENV = 'AGENTAGE_STORE_URL_FILE';

// The kinds a host opens from a URL; every other kind keeps its own way in.
export type UrlStoreKind = 'postgres' | 'clickhouse';

const SCHEMES: Record<UrlStoreKind, { protocol: RegExp; form: string }> = {
  postgres: { protocol: /^postgres(ql)?:$/, form: 'postgres://' },
  clickhouse: { protocol: /^https?:$/, form: 'http:// or https://' },
};

export const isUrlStoreKind = (kind: string | undefined): kind is UrlStoreKind =>
  kind === 'postgres' || kind === 'clickhouse';

const refused = (file: string, why: string) => new Error(`${STORE_URL_FILE_ENV} ${file}: ${why}`);

const readText = async (file: string, read: (file: string) => Promise<string>) => {
  try {
    return (await read(file)).trim();
  } catch (err) {
    throw refused(file, `cannot read it (${(err as { code?: string }).code ?? messageOf(err)})`);
  }
};

// Every error names the variable and the file, never the URL: it holds a credential.
export const readStoreUrl = async (
  file: string,
  kind: UrlStoreKind,
  read = (at: string) => readFile(at, 'utf8')
): Promise<string> => {
  const text = await readText(file, read);
  if (!text) throw refused(file, 'the file is empty');
  const { protocol, form } = SCHEMES[kind];
  const url = URL.parse(text);
  if (!url || !protocol.test(url.protocol) || !url.hostname)
    throw refused(file, `holds no ${form} URL for the ${kind} store`);
  return text;
};
