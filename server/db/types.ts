export type SqlValue = string | number | bigint | null | Uint8Array | boolean | undefined;

export type SqlResult<T = Record<string, unknown>> = {
  success: boolean;
  results: T[];
  meta: {
    changes: number;
    last_row_id: number | bigint;
    duration: number;
    [key: string]: unknown;
  };
};

export interface SqlPreparedStatement {
  bind(...values: SqlValue[]): SqlPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
}

/**
 * Small D1-compatible contract used by SherERP business logic.
 *
 * Cloudflare: native D1Database is supplied directly through env.DB.
 * Node: SqliteDatabase implements this contract using better-sqlite3.
 */
export interface SherDatabase {
  prepare(sql: string): SqlPreparedStatement;
  batch<T = Record<string, unknown>>(statements: SqlPreparedStatement[]): Promise<SqlResult<T>[]>;
}
