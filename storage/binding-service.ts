import crypto from "node:crypto";
import { DEFAULT_BOT_STATE_STORE, type BotStateStore } from "./bot-state.js";
import { parseScope, parseSenderId } from "./bot-state-schema.js";
import type { AccountBotState, BotBinding, PendingBindingCode } from "./bot-state-types.js";
import type {
  BindingService,
  ConsumeBindingCodeResult,
  PublicBinding,
} from "./binding-types.js";

const CODE_TTL_MS = 600_000;
const DIGEST_KEY_METADATA = "binding-code-hmac-key-v1";

export class BindingDigestKeyError extends Error {
  constructor() {
    super("Binding digest key must be 32-byte hexadecimal data");
    this.name = "BindingDigestKeyError";
  }
}

export class BindingRandomValueError extends Error {
  readonly value: number;

  constructor(value: number) {
    super("Binding random value must be an integer from 0 through 999999");
    this.name = "BindingRandomValueError";
    this.value = value;
  }
}

export interface BindingServiceOptions {
  readonly digestKey?: string;
  readonly maxWrongAttempts?: number;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly randomInt?: (maxExclusive: number) => number;
  readonly store: BotStateStore;
}

export function createBindingService(options: BindingServiceOptions): BindingService {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? crypto.randomUUID;
  const randomInt = options.randomInt ?? crypto.randomInt;
  const maxWrongAttempts = options.maxWrongAttempts ?? 3;
  let digestKey: Promise<Buffer> | undefined;

  const resolveDigestKey = (): Promise<Buffer> => {
    digestKey ??= loadDigestKey(options);
    return digestKey;
  };

  return {
    async generateCode(scopeInput) {
      const scope = parseScope(scopeInput);
      const value = randomInt(1_000_000);
      if (!Number.isInteger(value) || value < 0 || value >= 1_000_000) {
        throw new BindingRandomValueError(value);
      }
      const code = String(value).padStart(6, "0");
      const createdAt = now();
      const pending: PendingBindingCode = {
        attemptsBySender: {},
        createdAt,
        expiresAt: createdAt + CODE_TTL_MS,
        id: randomId(),
        keyedDigest: digestCode(await resolveDigestKey(), code),
      };
      await options.store.mutateAccount(scope, (state) => ({
        result: undefined,
        state: { ...state, pendingCodes: [pending] },
      }));
      return { code, createdAt, expiresAt: pending.expiresAt };
    },

    async consumeCode(scopeInput, senderIdInput, code) {
      const scope = parseScope(scopeInput);
      const senderId = parseSenderId(senderIdInput);
      if (!/^\d{6}$/.test(code)) return { status: "invalid" };
      const key = await resolveDigestKey();
      const consumedAt = now();
      return options.store.mutateAccount(scope, (state) => consumePendingCode({
        code,
        consumedAt,
        key,
        maxWrongAttempts,
        randomId,
        senderId,
        state,
      }));
    },

    async listBindings(scopeInput) {
      const scope = parseScope(scopeInput);
      return Object.values((await options.store.getAccount(scope)).bindings)
        .filter((binding) => binding.revokedAt === undefined)
        .sort((first, second) => second.boundAt - first.boundAt)
        .map(toPublicBinding);
    },

    async revoke(scopeInput, bindingId) {
      const scope = parseScope(scopeInput);
      if (!bindingId.trim()) return false;
      const revokedAt = now();
      return options.store.mutateAccount(scope, (state) => {
        const bindings: Record<string, BotBinding> = { ...state.bindings };
        const target = Object.values(bindings).find((binding) => (
          binding.bindingId === bindingId && binding.revokedAt === undefined
        ));
        if (target === undefined) return { result: false, state };
        bindings[target.senderId] = { ...target, revokedAt };
        return { result: true, state: { ...state, bindings } };
      });
    },
  };
}

export const DEFAULT_BINDING_SERVICE = createBindingService({
  store: DEFAULT_BOT_STATE_STORE,
});

function consumePendingCode(params: {
  readonly code: string;
  readonly consumedAt: number;
  readonly key: Buffer;
  readonly maxWrongAttempts: number;
  readonly randomId: () => string;
  readonly senderId: string;
  readonly state: AccountBotState;
}): { readonly result: ConsumeBindingCodeResult; readonly state: AccountBotState } {
  const existing = params.state.bindings[params.senderId];
  if (existing !== undefined && existing.revokedAt === undefined) {
    return { result: { binding: existing, status: "already-bound" }, state: params.state };
  }
  const pending = params.state.pendingCodes[0];
  if (pending === undefined) return { result: { status: "invalid" }, state: params.state };
  if (params.consumedAt >= pending.expiresAt) {
    return { result: { status: "expired" }, state: params.state };
  }
  if (!matchesCode(params.key, params.code, pending.keyedDigest)) {
    const attempts = pending.attemptsBySender[params.senderId] ?? 0;
    if (attempts >= params.maxWrongAttempts) {
      return { result: { status: "rate-limited" }, state: params.state };
    }
    const nextAttempts = attempts + 1;
    const nextPending = {
      ...pending,
      attemptsBySender: { ...pending.attemptsBySender, [params.senderId]: nextAttempts },
    };
    return {
      result: { status: nextAttempts >= params.maxWrongAttempts ? "rate-limited" : "invalid" },
      state: { ...params.state, pendingCodes: [nextPending] },
    };
  }
  const binding = existing === undefined
    ? createBinding(params.randomId(), params.senderId, params.consumedAt)
    : reactivateBinding(existing, params.consumedAt);
  return {
    result: { binding, status: "bound" },
    state: {
      ...params.state,
      bindings: { ...params.state.bindings, [params.senderId]: binding },
      pendingCodes: [],
    },
  };
}

function createBinding(bindingId: string, senderId: string, boundAt: number): BotBinding {
  return { bindingId, boundAt, replyStyle: "standard", senderId };
}

function reactivateBinding(binding: BotBinding, boundAt: number): BotBinding {
  const { revokedAt: _revokedAt, ...retained } = binding;
  return { ...retained, boundAt };
}

function toPublicBinding(binding: BotBinding): PublicBinding {
  return {
    bindingId: binding.bindingId,
    boundAt: binding.boundAt,
    senderLabel: `••••${binding.senderId.slice(-4)}`,
  };
}

async function loadDigestKey(options: BindingServiceOptions): Promise<Buffer> {
  const key = options.digestKey ?? await options.store.getOrCreateMetadata(
    DIGEST_KEY_METADATA,
    () => crypto.randomBytes(32).toString("hex"),
  );
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new BindingDigestKeyError();
  return Buffer.from(key, "hex");
}

function digestCode(key: Buffer, code: string): string {
  return crypto.createHmac("sha256", key).update(code).digest("hex");
}

function matchesCode(key: Buffer, code: string, expectedDigest: string): boolean {
  const actual = Buffer.from(digestCode(key, code), "hex");
  const expected = Buffer.from(expectedDigest, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
