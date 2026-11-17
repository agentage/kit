import semver from 'semver';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { type Finding } from '../check.js';

const DS = '@agentage/design-system';
const NEEDED = '^0.20';

type Declared = Partial<Record<'dependencies' | 'devDependencies' | 'peerDependencies', object>>;

// The kit's app code imports the design system (resizable-split, 0.20+), so the app part must declare it.
export const designSystemProblems = (pkg: ExtensionPackage): Finding[] => {
  const declared = pkg as Declared;
  const specs = [
    declared.dependencies,
    declared.devDependencies,
    declared.peerDependencies,
  ].flatMap(
    (group) => ((group as Record<string, string> | undefined)?.[DS] ?? []) as string | string[]
  );
  if (specs.length === 0)
    return [
      {
        file: 'package.json',
        problem: `the app part needs ${DS} ${NEEDED}: declare it in dependencies, devDependencies or peerDependencies`,
      },
    ];
  const bad = specs.find((spec) => !semver.validRange(spec) || !semver.subset(spec, NEEDED));
  return bad === undefined
    ? []
    : [{ file: 'package.json', problem: `${DS} ${bad}, the app part needs ${NEEDED}` }];
};
