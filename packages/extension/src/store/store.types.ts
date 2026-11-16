import { type GitAccess } from './git-env.js';

export type Row = Record<string, unknown>;

export interface QueryResult<R extends Row = Row> {
  rows: R[];
}

// ctx.store for a postgres store: a ready pool. Part code never sees a URL or a credential.
export interface Store {
  query<R extends Row = Row>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  // A git store only: the folder that holds its repos (data/{id}), the part's to lay out.
  readonly gitRoot?: string;
  // A git store only: spawn git with git.cwd and git.env; git.remote (cloud) has no credential.
  readonly git?: GitAccess;
}
