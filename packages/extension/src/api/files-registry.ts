import { type Caller } from '../auth/token-check.js';

// An Express handler for git smart-HTTP, typed with no express import: the tool entry loads this.
export type FilesHandler = (...args: never[]) => unknown;

export interface FilesOptions {
  // Runs on every request after the token check: false is a 403 (memory: caller.sub owns the path).
  owner?: (req: never, caller: Caller | null) => boolean | Promise<boolean>;
  // The most bytes a request that writes (a push) may send; over it is a 413.
  maxPushBytes?: number;
}

export interface FilesEntry {
  handler: FilesHandler;
  options: FilesOptions;
}

// One raw handler under /files/{id}/*: no body parser (packs are binary and large).
export type FilesRegistrar = (handler: FilesHandler, options?: FilesOptions) => void;

export const createFilesRegistry = () => {
  const served: { files?: FilesEntry } = {};
  const files: FilesRegistrar = (handler, options = {}) => {
    if (served.files) throw new Error('files are registered twice');
    served.files = { handler, options };
  };
  return { files, served };
};
