import { type Exit } from './child.js';

// Lines that never say why: blanks, stack frames, error properties, the Node version, the hint.
const NOISE = [
  /^\s*$/,
  /^\s+at /,
  /^\s*[{}]\s*$/,
  /^\s+[\w$'"]+: /,
  /^Node\.js v\d/,
  /^\(Use `node/,
];
// A log row below error (listening, a request, a warning) is not why a child exited.
const QUIET = /^\{.*"level":"(warn|info|debug|trace)"/;

const msgOf = (line: string): string => {
  try {
    return String((JSON.parse(line) as { msg?: unknown }).msg ?? line);
  } catch {
    return line;
  }
};

// The last line that says why (an error line, a log row's msg, or the thrown text): from stderr.
export const lastWords = (tail: string, how: Exit): string => {
  const lines = tail.split('\n').map((l) => l.trimEnd());
  const line = lines.reverse().find((l) => !QUIET.test(l) && !NOISE.some((re) => re.test(l)));
  if (line) return msgOf(line).replace(/^[A-Za-z]*Error(?: \[[A-Z_]+\])?: /, '');
  return `exited with ${how.signal ? `signal ${how.signal}` : `code ${how.code}`}`;
};
