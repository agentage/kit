// An Express handler for git smart-HTTP, typed with no express import: the tool entry loads this.
export type GitHandler = (...args: never[]) => unknown;

// One raw handler under /git/{id}/*: no body parser (packs are binary and large).
export type GitRegistrar = (handler: GitHandler) => void;

export const createGitRegistry = () => {
  const served: { git?: GitHandler } = {};
  const git: GitRegistrar = (handler) => {
    if (served.git) throw new Error('git is registered twice');
    served.git = handler;
  };
  return { git, served };
};
