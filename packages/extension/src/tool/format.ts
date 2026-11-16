import { relative } from 'node:path';
import { type BuildResult } from './build.js';
import { type CheckProblem, type CheckReport, type Finding } from './check.js';
import { plural } from './up/lines.js';

const shortDigest = (digest: string): string => digest.slice(0, 'sha256:'.length + 8);

const rowsOf = ({ images, container }: BuildResult) => [
  ...images.map(({ part, tag, digest }) => ({ label: part, tag, digest })),
  ...(container ? [{ label: 'image', ...container }] : []),
];

const partsLine = ({ container }: BuildResult): string[] => {
  if (!container) return [];
  const skipped = container.skipped.length > 0 ? container.skipped.join(', ') : 'none';
  return [`runs: ${container.runs.join(', ')}; skipped: ${skipped}`];
};

// One line per image (the one image as "image"), the parts it runs and skips, then the record.
export const buildLines = (result: BuildResult, cwd: string = process.cwd()): string[] => {
  const rows = rowsOf(result);
  const warned = result.warnings ?? [];
  const width = Math.max(...rows.map((row) => row.tag.length)) + 2;
  const lines = rows.map((row) => {
    const state = row.digest ? `${shortDigest(row.digest)} pushed` : 'built';
    return `${row.label.padEnd(8)}${row.tag.padEnd(width)}${state}`;
  });
  lines.unshift(...warned);
  lines.push(...partsLine(result));
  if (result.recordFile) lines.push(`${'record'.padEnd(8)}${relative(cwd, result.recordFile)}`);
  return lines;
};

const where = ({ file, line }: Finding): string =>
  file ? `${file}${line ? `:${line}` : ''} ` : '';

const lineOf = (found: CheckProblem): string => `${found.rule}: ${where(found)}${found.problem}`;

export const problemLines = (report: CheckReport): string[] => report.problems.map(lineOf);

export const warningLines = ({ warnings = [] }: CheckReport): string[] =>
  warnings.map((found) => `warning ${lineOf(found)}`);

// What `agentage extension check` prints (sheet C2): the rules line and PASS, or each problem and FAIL; warnings first.
export const checkLines = (report: CheckReport): string[] => {
  const { rules, skipped, problems } = report;
  if (report.conforms) {
    const states = rules.map(
      (name) => `${name} ${skipped[name] ? `skipped: ${skipped[name]}` : 'ok'}`
    );
    const pass = `PASS ${report.id} ${report.version} conforms (${plural(rules.length, 'rule')})`;
    return [states.join(' · '), ...warningLines(report), pass];
  }
  const failed = new Set(problems.map((found) => found.rule)).size;
  const fail = `FAIL ${plural(problems.length, 'problem')} in ${plural(failed, 'rule')}`;
  return [...warningLines(report), ...problemLines(report), fail];
};
