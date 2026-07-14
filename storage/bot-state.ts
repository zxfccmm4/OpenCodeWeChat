import type { Database } from "bun:sqlite";
import { STATE_DATABASE_FILE } from "../config.js";
import {
  BotStateSchemaError,
  parseAccountStateOrThrow,
  parseBindingOrThrow,
  parseScope,
  parseSenderId,
} from "./bot-state-schema.js";
import {
  openStateDatabase,
  runImmediateTransaction,
  secureDatabaseArtifacts,
} from "./state-database.js";
import type {
  AccountBotState,
  AccountScopeInput,
  BotBinding,
  BotStateMutation,
} from "./bot-state-types.js";

interface AccountRow {
  readonly payload: string;
}

interface MetadataRow {
  readonly value: string;
}

export interface BotStateStoreOptions {
  readonly busyTimeoutMs?: number;
  readonly databaseFile: string;
}

export class BotStateStore {
  private readonly busyTimeoutMs: number;
  private database: Database | undefined;
  private readonly databaseFile: string;

  constructor(options: BotStateStoreOptions) {
    this.busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    this.databaseFile = options.databaseFile;
  }

  async getAccount(scopeInput: AccountScopeInput): Promise<AccountBotState> {
    const scope = parseScope(scopeInput);
    const row = this.getDatabase().query<AccountRow, [string, string]>(`
      SELECT payload
      FROM account_state
      WHERE account_id = ? AND profile_id = ?
    `).get(scope.accountId, scope.profileId);
    return row === null ? emptyAccount(scope.profileId) : parseStoredAccount(row.payload, scope.profileId);
  }

  async getBinding(
    scope: AccountScopeInput,
    senderIdInput: string,
  ): Promise<BotBinding | undefined> {
    const senderId = parseSenderId(senderIdInput);
    return (await this.getAccount(scope)).bindings[senderId];
  }

  async putBinding(scope: AccountScopeInput, bindingInput: BotBinding): Promise<void> {
    parseSenderId(bindingInput.senderId);
    const binding = parseBindingOrThrow(bindingInput);
    await this.mutateAccount(scope, (state) => ({
      result: undefined,
      state: {
        ...state,
        bindings: { ...state.bindings, [binding.senderId]: binding },
      },
    }));
  }

  async mutateAccount<TResult>(
    scopeInput: AccountScopeInput,
    transform: (state: AccountBotState) => BotStateMutation<TResult>,
  ): Promise<TResult> {
    const scope = parseScope(scopeInput);
    const database = this.getDatabase();
    try {
      return runImmediateTransaction(database, () => {
        const row = database.query<AccountRow, [string, string]>(`
          SELECT payload
          FROM account_state
          WHERE account_id = ? AND profile_id = ?
        `).get(scope.accountId, scope.profileId);
        const current = row === null
          ? emptyAccount(scope.profileId)
          : parseStoredAccount(row.payload, scope.profileId);
        const mutation = transform(current);
        const next = parseAccountStateOrThrow(mutation.state);
        if (next.profileId !== scope.profileId) {
          throw new BotStateProfileMismatchError(scope.profileId, next.profileId);
        }
        database.query(`
          INSERT INTO account_state (account_id, profile_id, payload)
          VALUES (?, ?, ?)
          ON CONFLICT(account_id, profile_id) DO UPDATE SET payload = excluded.payload
        `).run(scope.accountId, scope.profileId, JSON.stringify(next));
        return mutation.result;
      });
    } finally {
      secureDatabaseArtifacts(this.databaseFile);
    }
  }

  async getOrCreateMetadata(key: string, createValue: () => string): Promise<string> {
    if (!key.trim()) throw new BotStateMetadataKeyError();
    const database = this.getDatabase();
    try {
      return runImmediateTransaction(database, () => {
        const existing = database.query<MetadataRow, [string]>(`
          SELECT value FROM state_metadata WHERE key = ?
        `).get(key);
        if (existing !== null) return existing.value;
        const value = createValue();
        database.query(`
          INSERT INTO state_metadata (key, value) VALUES (?, ?)
        `).run(key, value);
        return value;
      });
    } finally {
      secureDatabaseArtifacts(this.databaseFile);
    }
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  private getDatabase(): Database {
    this.database ??= openStateDatabase(this.databaseFile, this.busyTimeoutMs);
    return this.database;
  }
}

export class BotStateProfileMismatchError extends Error {
  readonly actualProfileId: string;
  readonly expectedProfileId: string;

  constructor(expectedProfileId: string, actualProfileId: string) {
    super("Bot state mutation changed the account profile ID");
    this.name = "BotStateProfileMismatchError";
    this.actualProfileId = actualProfileId;
    this.expectedProfileId = expectedProfileId;
  }
}

export class BotStateMetadataKeyError extends Error {
  constructor() {
    super("State metadata key must be non-empty");
    this.name = "BotStateMetadataKeyError";
  }
}

export const DEFAULT_BOT_STATE_STORE = new BotStateStore({
  databaseFile: STATE_DATABASE_FILE,
});

function parseStoredAccount(payload: string, profileId: string): AccountBotState {
  try {
    const parsed: unknown = JSON.parse(payload);
    const account = parseAccountStateOrThrow(parsed);
    return account.profileId === profileId ? account : emptyAccount(profileId);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof BotStateSchemaError) {
      return emptyAccount(profileId);
    }
    throw error;
  }
}

function emptyAccount(profileId: string): AccountBotState {
  return { bindings: {}, pendingCodes: [], profileId };
}
