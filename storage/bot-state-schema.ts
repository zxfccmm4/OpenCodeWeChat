import path from "node:path";
import type {
  AccountBotState,
  AccountScopeInput,
  BotBinding,
  BotModelSelection,
  BotStateDocument,
  PendingBindingCode,
  ReplyStyle,
} from "./bot-state-types.js";

const REPLY_STYLES = ["concise", "standard", "detailed"] as const;
const BINDING_KEYS = [
  "agent",
  "bindingId",
  "boundAt",
  "directory",
  "model",
  "replyStyle",
  "revokedAt",
  "senderId",
  "sessionId",
  "variant",
] as const;
const ACCOUNT_KEYS = ["bindings", "pendingCodes", "profileId"] as const;
const PENDING_KEYS = [
  "attemptsBySender",
  "createdAt",
  "expiresAt",
  "id",
  "keyedDigest",
] as const;

export class BotStateIdentityError extends Error {
  readonly field: "accountId" | "profileId" | "senderId";

  constructor(field: "accountId" | "profileId" | "senderId") {
    super(`${field} must be a non-empty trusted ID`);
    this.name = "BotStateIdentityError";
    this.field = field;
  }
}

export class BotStateSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotStateSchemaError";
  }
}

export function parseScope(input: AccountScopeInput): AccountScopeInput {
  return {
    accountId: parseIdentity(input.accountId, "accountId"),
    profileId: parseIdentity(input.profileId, "profileId"),
  };
}

export function parseSenderId(senderId: string): string {
  const parsed = parseIdentity(senderId, "senderId");
  if (parsed === "unknown") throw new BotStateIdentityError("senderId");
  return parsed;
}

export function parseBindingOrThrow(value: unknown): BotBinding {
  const parsed = parseBinding(value);
  if (parsed === undefined) throw new BotStateSchemaError("Invalid bot binding state");
  return parsed;
}

export function parseAccountStateOrThrow(value: unknown): AccountBotState {
  const parsed = parseAccountState(value);
  if (parsed === undefined) throw new BotStateSchemaError("Invalid account bot state");
  return parsed;
}

export function parseBotStateDocument(value: unknown): BotStateDocument | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["accounts", "version"])) return undefined;
  if (value["version"] !== 1 || !isRecord(value["accounts"])) return undefined;
  const accounts: Record<string, AccountBotState> = {};
  for (const [accountId, accountValue] of Object.entries(value["accounts"])) {
    if (!isTrustedIdentity(accountId)) return undefined;
    const account = parseAccountState(accountValue);
    if (account === undefined) return undefined;
    accounts[accountId] = account;
  }
  return { accounts, version: 1 };
}

function parseAccountState(value: unknown): AccountBotState | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ACCOUNT_KEYS)) return undefined;
  if (!isTrustedIdentity(value["profileId"])) return undefined;
  if (!isRecord(value["bindings"]) || !Array.isArray(value["pendingCodes"])) return undefined;
  const bindings: Record<string, BotBinding> = {};
  for (const [senderId, bindingValue] of Object.entries(value["bindings"])) {
    if (!isTrustedSenderId(senderId)) return undefined;
    const binding = parseBinding(bindingValue);
    if (binding === undefined || binding.senderId !== senderId) return undefined;
    bindings[senderId] = binding;
  }
  const pendingCodes: PendingBindingCode[] = [];
  for (const pendingValue of value["pendingCodes"]) {
    const pending = parsePendingCode(pendingValue);
    if (pending === undefined) return undefined;
    pendingCodes.push(pending);
  }
  return { bindings, pendingCodes, profileId: value["profileId"] };
}

function parseBinding(value: unknown): BotBinding | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, BINDING_KEYS)) return undefined;
  if (!isTrustedSenderId(value["senderId"])) return undefined;
  if (!isTrustedIdentity(value["bindingId"])) return undefined;
  if (!isTimestamp(value["boundAt"]) || !isReplyStyle(value["replyStyle"])) return undefined;
  const sessionId = optionalTrustedString(value["sessionId"]);
  const directory = optionalDirectory(value["directory"]);
  const agent = optionalTrustedString(value["agent"]);
  const variant = optionalTrustedString(value["variant"]);
  const revokedAt = value["revokedAt"] === undefined ? undefined : value["revokedAt"];
  if (revokedAt !== undefined && !isTimestamp(revokedAt)) return undefined;
  const model = value["model"] === undefined ? undefined : parseModel(value["model"]);
  if (sessionId === null || directory === null || agent === null || variant === null) return undefined;
  if (value["model"] !== undefined && model === undefined) return undefined;
  return {
    ...(agent === undefined ? {} : { agent }),
    bindingId: value["bindingId"],
    boundAt: value["boundAt"],
    ...(directory === undefined ? {} : { directory }),
    ...(model === undefined ? {} : { model }),
    replyStyle: value["replyStyle"],
    ...(revokedAt === undefined ? {} : { revokedAt }),
    senderId: value["senderId"],
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(variant === undefined ? {} : { variant }),
  };
}

function parseModel(value: unknown): BotModelSelection | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["modelId", "providerId"])) return undefined;
  if (!isTrustedIdentity(value["modelId"]) || !isTrustedIdentity(value["providerId"])) return undefined;
  return { modelId: value["modelId"], providerId: value["providerId"] };
}

function parsePendingCode(value: unknown): PendingBindingCode | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, PENDING_KEYS)) return undefined;
  if (!isTrustedIdentity(value["id"]) || !isTrustedIdentity(value["keyedDigest"])) return undefined;
  if (!isRecord(value["attemptsBySender"])) return undefined;
  if (!isTimestamp(value["createdAt"]) || !isTimestamp(value["expiresAt"])) return undefined;
  if (value["expiresAt"] < value["createdAt"]) return undefined;
  const attemptsBySender: Record<string, number> = {};
  for (const [senderId, attempts] of Object.entries(value["attemptsBySender"])) {
    if (!isTrustedSenderId(senderId)) return undefined;
    if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0) return undefined;
    attemptsBySender[senderId] = attempts;
  }
  return {
    attemptsBySender,
    createdAt: value["createdAt"],
    expiresAt: value["expiresAt"],
    id: value["id"],
    keyedDigest: value["keyedDigest"],
  };
}

function parseIdentity(value: string, field: "accountId" | "profileId" | "senderId"): string {
  const parsed = value.trim();
  if (!isTrustedIdentity(parsed)) throw new BotStateIdentityError(field);
  return parsed;
}

function isTrustedIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTrustedSenderId(value: unknown): value is string {
  return isTrustedIdentity(value) && value.trim() !== "unknown";
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isReplyStyle(value: unknown): value is ReplyStyle {
  return typeof value === "string" && REPLY_STYLES.some((style) => style === value);
}

function optionalTrustedString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return isTrustedIdentity(value) ? value : null;
}

function optionalDirectory(value: unknown): string | undefined | null {
  const parsed = optionalTrustedString(value);
  if (parsed === null || parsed === undefined) return parsed;
  return path.isAbsolute(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
