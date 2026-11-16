import { redact } from './start-checks.js';

// By line, so a value split over two chunks is masked too; a last line with no newline goes at the end.
export const redactedLines = (write: (text: string) => void, secrets: Record<string, string>) => {
  let rest = '';
  const push = (chunk: string): void => {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop() ?? '';
    if (lines.length) write(redact(`${lines.join('\n')}\n`, secrets));
  };
  const end = (): void => {
    if (rest) write(redact(rest, secrets));
    rest = '';
  };
  return { push, end };
};
