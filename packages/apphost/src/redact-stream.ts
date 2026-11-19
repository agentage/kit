import { type Readable, type Writable } from 'node:stream';
import { maskedForms, redact } from './start-checks.js';

// Past this, a line with no newline is written up to a tail that could hold a split secret.
export const PENDING_MAX = 64 * 1024;

// By line, so a value split over two chunks is masked too; a call with no chunk flushes the rest.
export const redactedLines = (write: (text: string) => void, secrets: Record<string, string>) => {
  const keep = Math.max(0, (maskedForms(secrets)[0]?.length ?? 1) - 1);
  let rest = '';
  return (chunk?: string): void => {
    const lines = (rest + (chunk ?? '\n')).split('\n');
    rest = lines.pop() ?? '';
    const cut = rest.length > PENDING_MAX ? rest.length - keep : 0;
    const out = `${lines.join('\n')}${lines.length && chunk !== undefined ? '\n' : ''}`;
    if (out || cut) write(redact(out + rest.slice(0, cut), secrets));
    rest = rest.slice(cut);
  };
};

// A child stream to the daemon's own, masked; its rest is written at the end.
export const pipeRedacted = (
  from: Readable | null,
  to: Writable,
  secrets: Record<string, string>
) => {
  const out = redactedLines((text) => to.write(text), secrets);
  from?.on('data', (chunk: Buffer) => out(chunk.toString()));
  from?.once('end', () => out());
};
