import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PENDING_MAX, pipeRedacted, redactedLines } from './redact-stream.js';

const sink = () => {
  const out: string[] = [];
  const to = new Writable({ write: (chunk, _enc, done) => (out.push(String(chunk)), done()) });
  return { out, to };
};

const piped = async (secrets: Record<string, string>, chunks: string[]) => {
  const from = new PassThrough();
  const { out, to } = sink();
  pipeRedacted(from, to, secrets);
  for (const chunk of chunks) from.write(chunk);
  from.end();
  await new Promise((resolve) => setImmediate(resolve));
  return out.join('');
};

describe('redactedLines', () => {
  it('masks a value of 4 or more characters, also split over two chunks; keeps a short one', () => {
    const out: string[] = [];
    const lines = redactedLines((text) => out.push(text), { a: 's3cr3t-value', b: 'abc' });
    lines('first s3cr3t-');
    lines('value and abc\nlast s3cr3t-value');
    lines();
    expect(out.join('')).toBe('first *** and abc\nlast ***');
  });

  it('writes a long line with no newline past 64 KiB, keeping a tail that may hold a split secret', () => {
    const out: string[] = [];
    const lines = redactedLines((text) => out.push(text), { a: 'abcdefgh' });
    lines('x'.repeat(PENDING_MAX + 10) + 'abcd');
    expect(out.join('')).toBe('x'.repeat(PENDING_MAX + 7));
    lines('efgh tail');
    lines();
    expect(out.join('')).toBe(`${'x'.repeat(PENDING_MAX + 10)}*** tail`);
  });
});

describe('pipeRedacted (the child stdout and stderr)', () => {
  it('masks a secret with a quote and a backslash inside a JSON log row', async () => {
    const secret = 'pa"ss\\word';
    const row = `${JSON.stringify({ msg: 'boot', token: secret })}\n`;
    const out = await piped({ t: secret }, [row]);
    expect(out).toBe('{"msg":"boot","token":"***"}\n');
  });

  it('masks a secret split over two chunks, and writes the rest at the end', async () => {
    const out = await piped({ t: 'tok-secret-1' }, [
      'a tok-sec',
      'ret-1 b\nno newline tok-secret-1',
    ]);
    expect(out).toBe('a *** b\nno newline ***');
  });
});
