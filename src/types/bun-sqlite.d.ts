declare module "bun:sqlite" {
  export class Database {
    constructor(path?: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
  export class Statement {
    run(...args: unknown[]): { lastInsertRowid: number | bigint; changes: number };
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  }
}
