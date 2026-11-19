import { forkLaunch, type Child, type Launch, type LaunchSpec } from './child.js';

// What a started extension is to the host: an address, a state, a stop; never a process id it uses.
export type RunState = 'running' | 'exited';

export interface Run extends Child {
  // The origin the host sends requests of this extension to.
  address(): string;
  state(): RunState;
}

// One way to run an extension: a child process here; a running upstream on a cloud host (J.4.4).
export interface Runner {
  readonly kind: 'child' | 'upstream';
  start(spec: LaunchSpec): Promise<Run>;
}

// The address and state of a started child: loopback on the port it reported, running until it exits.
const isRun = (child: Child): child is Run => 'address' in child && 'state' in child;

export const runOf = (child: Child): Run => {
  if (isRun(child)) return child;
  let state: RunState = 'running';
  void child.exited.then(() => (state = 'exited'));
  return Object.assign(child, {
    address: () => `http://127.0.0.1:${child.port}`,
    state: () => state,
  });
};

// The child runner: install, seal and fork are the launch (child.ts); restarts stay in the supervisor.
export const childRunner = (launch: Launch = forkLaunch()): Runner => ({
  kind: 'child',
  start: async (spec) => runOf(await launch(spec)),
});
