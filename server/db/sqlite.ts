import Database from 'better-sqlite3';

import type { SherDatabase, SqlPreparedStatement, SqlResult, SqlValue } from './types.js';

function normalizeValue(value: SqlValue): string | number | bigint | Buffer | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
}

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

class SqlitePreparedStatement implements SqlPreparedStatement {
  constructor(
    private readonly owner: SqliteDatabase,
    readonly sql: string,
    readonly values: SqlValue[] = []
  ) {}

  bind(...values: SqlValue[]): SqlPreparedStatement {
    return new SqlitePreparedStatement(this.owner, this.sql, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const statement = this.owner.native.prepare(this.sql);
    const row = statement.get(...this.values.map(normalizeValue));
    return (row as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    const start = process.hrtime.bigint();
    const statement = this.owner.native.prepare(this.sql);
    const rows = statement.all(...this.values.map(normalizeValue)) as T[];
    return {
      success: true,
      results: rows,
      meta: { changes: 0, last_row_id: 0, duration: elapsedMs(start) }
    };
  }

  async run<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    return this.execute<T>();
  }

  execute<T = Record<string, unknown>>(): SqlResult<T> {
    const start = process.hrtime.bigint();
    const statement = this.owner.native.prepare(this.sql);
    if (statement.reader) {
      const rows = statement.all(...this.values.map(normalizeValue)) as T[];
      return {
        success: true,
        results: rows,
        meta: { changes: 0, last_row_id: 0, duration: elapsedMs(start) }
      };
    }

    const result = statement.run(...this.values.map(normalizeValue));
    return {
      success: true,
      results: [],
      meta: {
        changes: result.changes,
        last_row_id: result.lastInsertRowid,
        duration: elapsedMs(start)
      }
    };
  }
}

export class SqliteDatabase implements SherDatabase {
  readonly native: Database.Database;

  constructor(filePath: string) {
    this.native = new Database(filePath);
    this.native.pragma('foreign_keys = ON');
    this.native.pragma('journal_mode = WAL');
    this.native.pragma('synchronous = NORMAL');
    this.native.pragma('busy_timeout = 5000');
  }

  prepare(sql: string): SqlPreparedStatement {
    return new SqlitePreparedStatement(this, sql);
  }

  async batch<T = Record<string, unknown>>(statements: SqlPreparedStatement[]): Promise<SqlResult<T>[]> {
    if (statements.length === 0) return [];

    const execute = this.native.transaction((items: SqlPreparedStatement[]) => {
      return items.map((item) => {
        if (!(item instanceof SqlitePreparedStatement)) {
          throw new Error('Invalid SQLite prepared statement supplied to batch().');
        }
        return item.execute<T>();
      });
    });

    return execute.immediate(statements);
  }

  close(): void {
    this.native.close();
  }
}
