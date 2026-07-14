import fs from "node:fs";
import type { Database } from "bun:sqlite";
import {
  OMO_PLAN_CONTEXT_ARCHIVE_FILE,
  OMO_PLAN_CONTEXT_FILE,
  STATE_DATABASE_FILE,
} from "../config.js";
import type { OmoPlanContext } from "../core/omo-command.js";
import { parseScope, parseSenderId } from "./bot-state-schema.js";
import type { AccountScopeInput } from "./bot-state-types.js";
import {
  openStateDatabase,
  runImmediateTransaction,
  secureDatabaseArtifacts,
} from "./state-database.js";

const LEGACY_MIGRATION_KEY = "omo-plan-context-json-v1";
let database: Database | undefined;

interface PlanRow {
  readonly payload: string;
}

interface MetadataRow {
  readonly value: string;
}

export function getLatestPlanContext(
  scopeInput: AccountScopeInput,
  senderIdInput: string,
): OmoPlanContext | undefined {
  const scope = parseScope(scopeInput);
  const senderId = parseSenderId(senderIdInput);
  const stateDatabase = getDatabase();
  migrateLegacyPlans(stateDatabase, scope);
  const row = stateDatabase.query<PlanRow, [string, string, string]>(`
    SELECT payload FROM omo_plan_context
    WHERE account_id = ? AND profile_id = ? AND sender_id = ?
  `).get(scope.accountId, scope.profileId, senderId);
  return row === null ? undefined : parsePlanPayload(row.payload);
}

export function saveLatestPlanContext(
  scopeInput: AccountScopeInput,
  planContext: OmoPlanContext,
  senderIdInput: string,
): void {
  const scope = parseScope(scopeInput);
  const senderId = parseSenderId(senderIdInput);
  if (!isValidPlanContext(planContext)) return;
  const stateDatabase = getDatabase();
  migrateLegacyPlans(stateDatabase, scope);
  try {
    runImmediateTransaction(stateDatabase, () => {
      stateDatabase.query(`
        INSERT INTO omo_plan_context (account_id, profile_id, sender_id, payload)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, profile_id, sender_id)
        DO UPDATE SET payload = excluded.payload
      `).run(scope.accountId, scope.profileId, senderId, JSON.stringify(planContext));
    });
  } finally {
    secureDatabaseArtifacts(STATE_DATABASE_FILE);
  }
}

export function deleteLatestPlanContext(
  scopeInput: AccountScopeInput,
  senderIdInput: string,
): void {
  const scope = parseScope(scopeInput);
  const senderId = parseSenderId(senderIdInput);
  const stateDatabase = getDatabase();
  migrateLegacyPlans(stateDatabase, scope);
  try {
    runImmediateTransaction(stateDatabase, () => {
      stateDatabase.query(`
        DELETE FROM omo_plan_context
        WHERE account_id = ? AND profile_id = ? AND sender_id = ?
      `).run(scope.accountId, scope.profileId, senderId);
    });
  } finally {
    secureDatabaseArtifacts(STATE_DATABASE_FILE);
  }
}

function getDatabase(): Database {
  database ??= openStateDatabase(STATE_DATABASE_FILE);
  return database;
}

function migrateLegacyPlans(stateDatabase: Database, scope: AccountScopeInput): void {
  let applied = false;
  runImmediateTransaction(stateDatabase, () => {
    const marker = stateDatabase.query<MetadataRow, [string]>(`
      SELECT value FROM state_metadata WHERE key = ?
    `).get(LEGACY_MIGRATION_KEY);
    if (marker !== null) return;
    const plans = readLegacyPlans();
    const insert = stateDatabase.query(`
      INSERT OR IGNORE INTO omo_plan_context
        (account_id, profile_id, sender_id, payload)
      VALUES (?, ?, ?, ?)
    `);
    for (const [senderId, planContext] of plans) {
      insert.run(scope.accountId, scope.profileId, senderId, JSON.stringify(planContext));
    }
    stateDatabase.query(`
      INSERT INTO state_metadata (key, value) VALUES (?, ?)
    `).run(LEGACY_MIGRATION_KEY, JSON.stringify(scope));
    applied = true;
  });
  secureDatabaseArtifacts(STATE_DATABASE_FILE);
  if (applied && fs.existsSync(OMO_PLAN_CONTEXT_FILE)) archiveLegacyFile();
}

function archiveLegacyFile(): void {
  try {
    fs.renameSync(OMO_PLAN_CONTEXT_FILE, OMO_PLAN_CONTEXT_ARCHIVE_FILE);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
}

function readLegacyPlans(): readonly (readonly [string, OmoPlanContext])[] {
  if (!fs.existsSync(OMO_PLAN_CONTEXT_FILE)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(OMO_PLAN_CONTEXT_FILE, "utf-8"));
    if (!isRecord(parsed)) return [];
    const plans: Array<readonly [string, OmoPlanContext]> = [];
    for (const [senderId, value] of Object.entries(parsed)) {
      if (senderId.trim() && isValidPlanContext(value)) plans.push([senderId, value]);
    }
    return plans;
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

function parsePlanPayload(payload: string): OmoPlanContext | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isValidPlanContext(parsed) ? parsed : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isValidPlanContext(value: unknown): value is OmoPlanContext {
  if (!isRecord(value)) return false;
  const originalRequest = value["originalRequest"];
  const planResponse = value["planResponse"];
  const savedAt = value["savedAt"];
  return typeof originalRequest === "string"
    && typeof planResponse === "string"
    && typeof savedAt === "string"
    && originalRequest.trim().length > 0
    && planResponse.trim().length > 0
    && savedAt.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
