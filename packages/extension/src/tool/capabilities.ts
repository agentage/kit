// What this kit can do, for a client that checks support without probing files.
// container: `build --container`; local-guard: `hostExtension(dir, { localOnly: true })`.
export const CAPABILITIES: readonly string[] = Object.freeze(['container', 'local-guard']);
