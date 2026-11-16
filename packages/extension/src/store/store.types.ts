export type Row = Record<string, unknown>;

export interface QueryResult<R extends Row = Row> {
  rows: R[];
}

// ctx.store for a postgres store: a ready pool. Part code never sees a URL or a credential.
export interface Store {
  query<R extends Row = Row>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  // A git store only: the folder that holds its repos (data/{id}), the part's to lay out.
  readonly gitRoot?: string;
  // A git store in the cloud only: the store-git remote to push to. It holds a credential: never log it.
  readonly gitRemote?: string;
}
