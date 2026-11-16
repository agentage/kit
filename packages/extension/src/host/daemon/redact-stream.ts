import { redact } from './start-checks.js';

// By line, so a value split over two chunks is masked too; a call with no chunk flushes the rest.
export const redactedLines = (write: (text: string) => void, secrets: Record<string, string>) => {
  let rest = '';
  return (chunk?: string): void => {
    const lines = (rest + (chunk ?? '\n')).split('\n');
    rest = lines.pop() ?? '';
    if (lines.length)
      write(redact(`${lines.join('\n')}${chunk === undefined ? '' : '\n'}`, secrets));
  };
};
