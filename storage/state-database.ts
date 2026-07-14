import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

export class StateDatabaseRollbackError extends Error {
  readonly cause: unknown;
  readonly rollbackCause: unknown;

  constructor(cause: unknown, rollbackCause: unknown) {
    super("State transaction and rollback both failed");
    this.name = "StateDatabaseRollbackError";
    this.cause = cause;
    this.rollbackCause = rollbackCause;
  }
}

export class StateDatabaseBusyError extends Error {
  readonly databaseFile: string;

  constructor(databaseFile: string) {
    super(`Timed out initializing state database: ${databaseFile}`);
    this.name = "StateDatabaseBusyError";
    this.databaseFile = databaseFile;
  }
}

export function openStateDatabase(databaseFile: string, busyTimeoutMs = 5_000): Database {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  preparePrivateFile(databaseFile);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const database = new Database(databaseFile, { create: true, strict: true });
    try {
      configureDatabase(database, busyTimeoutMs);
      secureDatabaseArtifacts(databaseFile);
      return database;
    } catch (error) {
      database.close();
      if (!isSqliteBusy(error)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  throw new StateDatabaseBusyError(databaseFile);
}

export function runImmediateTransaction<TResult>(
  database: Database,
  operation: () => TResult,
): TResult {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new StateDatabaseRollbackError(error, rollbackError);
    }
    throw error;
  }
}

export function secureDatabaseArtifacts(databaseFile: string): void {
  for (const file of [databaseFile, `${databaseFile}-wal`, `${databaseFile}-shm`]) {
    if (!fs.existsSync(file)) continue;
    try {
      fs.chmodSync(file, 0o600);
    } catch (error) {
      if (!isErrorCode(error, "ENOENT")) throw error;
    }
  }
}

function preparePrivateFile(databaseFile: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(databaseFile, "wx", 0o600);
    fs.closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (!isErrorCode(error, "EEXIST")) throw error;
  }
  fs.chmodSync(databaseFile, 0o600);
}

function configureDatabase(database: Database, busyTimeoutMs: number): void {
  database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS account_state (
      account_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (account_id, profile_id)
    );
    CREATE TABLE IF NOT EXISTS omo_plan_context (
      account_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (account_id, profile_id, sender_id)
    );
    CREATE TABLE IF NOT EXISTS state_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED")) {
    return true;
  }
  return error instanceof Error
    && (error.message.includes("database is locked") || error.message.includes("database is busy"));
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}
