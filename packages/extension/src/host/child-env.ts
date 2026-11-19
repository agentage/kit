// The env contract of a child of an app host: written here, read by host-env.ts.
export interface LaunchSpec {
  id: string;
  dir: string;
  dataDir: string;
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
  origin: string;
  // The daemon's own health limit (healthMs), so one rule bounds the child's store open.
  storeOpenMs?: number;
  // The signed-in cli user: the caller of every request to this loopback child.
  userSub?: string;
}

// What dist/host/main.js reads (docs/part-image.md), on a port the OS picks.
export const childEnv = (
  spec: LaunchSpec,
  secretsDir: string,
  runDir?: string
): Record<string, string> => ({
  PORT: '0',
  AGENTAGE_EXTENSION_DIR: spec.dir,
  AGENTAGE_DATA_DIR: spec.dataDir,
  AGENTAGE_SETTINGS: JSON.stringify(spec.settings),
  AGENTAGE_SECRETS_DIR: secretsDir,
  AGENTAGE_ORIGIN: spec.origin,
  ...(runDir && { AGENTAGE_RUN_DIR: runDir }),
  ...(spec.storeOpenMs && { AGENTAGE_STORE_OPEN_MS: String(spec.storeOpenMs) }),
  ...(spec.userSub && { AGENTAGE_USER_SUB: spec.userSub }),
});
