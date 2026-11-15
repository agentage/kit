// What this kit can do, checked without probing files (docs/part-image.md lists each).
export const capabilities = Object.freeze([
  'container',
  'localOnly',
  'installDisabled',
  'updateInstallation',
  'withFileLock',
] as const);
