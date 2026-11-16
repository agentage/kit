import { describe, expect, it } from 'vitest';
import { redactedLines } from './redact-stream.js';

describe('redactedLines', () => {
  it('masks a value of 4 or more characters, also split over two chunks; keeps a short one', () => {
    const out: string[] = [];
    const lines = redactedLines((text) => out.push(text), { a: 's3cr3t-value', b: 'abc' });
    lines.push('first s3cr3t-');
    lines.push('value and abc\nlast s3cr3t-value');
    lines.end();
    expect(out.join('')).toBe('first *** and abc\nlast ***');
  });
});
