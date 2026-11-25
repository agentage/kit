import semver from 'semver';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { type Finding } from '../check.js';

const LIB = '@agentage/components';
const OLD = '@agentage/design-system';
const NEEDED = '^0.21';

type Declared = Partial<Record<'dependencies' | 'devDependencies' | 'peerDependencies', object>>;

const specsOf = (pkg: ExtensionPackage, name: string): string[] => {
  const declared = pkg as Declared;
  return [declared.dependencies, declared.devDependencies, declared.peerDependencies].flatMap(
    (group) => ((group as Record<string, string> | undefined)?.[name] ?? []) as string | string[]
  );
};

const finding = (problem: string): Finding[] => [{ file: 'package.json', problem }];

// The kit's app code imports the components (resizable-split, 0.21+), so the app part must declare them.
export const componentsProblems = (pkg: ExtensionPackage): Finding[] => {
  const old = specsOf(pkg, OLD).length > 0;
  const specs = specsOf(pkg, LIB);
  if (specs.length === 0)
    return finding(
      old
        ? `${OLD} is replaced: switch the app part to ${LIB} ${NEEDED}`
        : `the app part needs ${LIB} ${NEEDED}: declare it in dependencies, devDependencies or peerDependencies`
    );
  const bad = specs.find((spec) => !semver.validRange(spec) || !semver.subset(spec, NEEDED));
  if (bad !== undefined) return finding(`${LIB} ${bad}, the app part needs ${NEEDED}`);
  // Both: a kit of 0.22 or older still imports the old library; remove it once no kit needs it.
  return old
    ? [{ file: 'package.json', problem: `${OLD} is replaced by ${LIB}: remove it`, warning: true }]
    : [];
};
