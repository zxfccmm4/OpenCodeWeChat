import { REPLY_STYLE_PROMPTS } from "../core/local-command-contract.js";
import { buildOmoSendPromptOptions } from "../core/omo-agent-routing";
import type { OmoCommand } from "../core/omo-command";
import type {
  AccountScopeInput,
  BotBinding,
  BotModelSelection,
  ReplyStyle,
} from "../storage/bot-state-types";
import {
  createOpencodeSession,
  resumeOpencodeSession,
} from "./conversation";
import type { OpencodeTransportManager } from "./transport-manager";
import type {
  OpencodeModel,
  OpencodeSession,
  SendPromptOptions,
} from "./types";

export interface UserSessionStateStore {
  getBinding(scope: AccountScopeInput, senderId: string): Promise<BotBinding | undefined>;
  putBinding(scope: AccountScopeInput, binding: BotBinding): Promise<void>;
}

export type ResolvedUserSession = {
  readonly binding: BotBinding;
  readonly session: OpencodeSession;
};

export interface UserSessionResolver {
  resolve(senderId: string): Promise<ResolvedUserSession>;
  recover(senderId: string, observedGeneration: number): Promise<ResolvedUserSession>;
}

export type UserSessionResetReason = "clear" | "new" | "project-change";

export type UserSessionPreferencePatch = {
  readonly agent?: string;
  readonly directory?: string;
  readonly model?: BotModelSelection;
  readonly replyStyle?: ReplyStyle;
  readonly variant?: string;
  readonly clearAgent?: boolean;
  readonly clearModel?: boolean;
  readonly clearVariant?: boolean;
};

type UserSessionManagerOptions = {
  readonly clearPlan?: (scope: AccountScopeInput, senderId: string) => Promise<void> | void;
  readonly defaultDirectory: string;
  readonly isVariantCompatible: (
    directory: string,
    model: OpencodeModel,
    variant: string,
  ) => Promise<boolean>;
  readonly manager: OpencodeTransportManager;
  readonly scope: AccountScopeInput;
  readonly state: UserSessionStateStore;
};

const REPLY_STYLE_SYSTEM: Readonly<Record<ReplyStyle, string>> = REPLY_STYLE_PROMPTS;

export class UserSessionNotBoundError extends Error {
  readonly senderId: string;

  constructor(senderId: string) {
    super(`微信用户尚未绑定: ${senderId}`);
    this.name = "UserSessionNotBoundError";
    this.senderId = senderId;
  }
}

export class UserSessionManager implements UserSessionResolver {
  readonly #options: UserSessionManagerOptions;
  readonly #cache = new Map<string, ResolvedUserSession>();
  readonly #tails = new Map<string, Promise<void>>();

  constructor(options: UserSessionManagerOptions) {
    this.#options = options;
  }

  get defaultDirectory(): string {
    return this.#options.defaultDirectory;
  }

  get scope(): AccountScopeInput {
    return this.#options.scope;
  }

  resolve(senderId: string): Promise<ResolvedUserSession> {
    return this.#serialized(senderId, () => this.#resolve(senderId));
  }

  recover(senderId: string, observedGeneration: number): Promise<ResolvedUserSession> {
    return this.#serialized(senderId, async () => {
      await this.#options.manager.restart(observedGeneration);
      return this.#resolve(senderId);
    });
  }

  /**
   * Peek at the active binding without creating/resuming an OpenCode session.
   * Returns undefined when the sender is unbound or revoked.
   */
  async peekBinding(senderId: string): Promise<BotBinding | undefined> {
    const binding = await this.#options.state.getBinding(this.#options.scope, senderId);
    if (!binding || binding.revokedAt !== undefined) return undefined;
    return binding;
  }

  reset(senderId: string, reason: UserSessionResetReason): Promise<ResolvedUserSession> {
    return this.#serialized(senderId, async () => {
      const binding = await this.#loadBinding(senderId);
      const reconciled = await this.#reconcileBinding(binding);
      const session = await createOpencodeSession(
        this.#options.manager.current(),
        sessionOptions(reconciled),
      );
      const persisted = { ...reconciled, sessionId: session.id };
      await this.#options.state.putBinding(this.#options.scope, persisted);
      const resolved = { binding: persisted, session };
      this.#cache.set(senderId, resolved);
      if (reason === "clear" || reason === "new") {
        await this.#options.clearPlan?.(this.#options.scope, senderId);
      }
      return resolved;
    });
  }

  /**
   * Persist preference changes for a bound sender.
   * Project changes always open a fresh session; other preference updates
   * keep the current session id so conversation history is retained.
   */
  updatePreferences(
    senderId: string,
    patch: UserSessionPreferencePatch,
  ): Promise<ResolvedUserSession> {
    return this.#serialized(senderId, async () => {
      const binding = await this.#loadBinding(senderId);
      const next = applyPreferencePatch(binding, patch);
      const projectChanged = Boolean(
        patch.directory && patch.directory !== (binding.directory ?? this.#options.defaultDirectory),
      );
      if (projectChanged) {
        const session = await createOpencodeSession(
          this.#options.manager.current(),
          sessionOptions(next),
        );
        const persisted = { ...next, sessionId: session.id };
        await this.#options.state.putBinding(this.#options.scope, persisted);
        await this.#options.clearPlan?.(this.#options.scope, senderId);
        const resolved = { binding: persisted, session };
        this.#cache.set(senderId, resolved);
        return resolved;
      }
      await this.#options.state.putBinding(this.#options.scope, next);
      this.#cache.delete(senderId);
      return this.#resolve(senderId);
    });
  }

  async #resolve(senderId: string): Promise<ResolvedUserSession> {
    const loaded = await this.#loadBinding(senderId);
    const binding = await this.#reconcileBinding(loaded);
    const cached = this.#cache.get(senderId);
    const connection = this.#options.manager.current();
    if (cached
      && cached.session.transport.generation === connection.generation
      && bindingFingerprint(cached.binding) === bindingFingerprint(binding)) {
      return cached;
    }
    const descriptor = binding.sessionId
      ? {
          ...sessionOptions(binding),
          id: binding.sessionId,
          transport: connection,
        }
      : undefined;
    const session = descriptor
      ? await resumeOpencodeSession(descriptor)
      : await createOpencodeSession(connection, sessionOptions(binding));
    const persisted = binding.sessionId === session.id
      ? binding
      : { ...binding, sessionId: session.id };
    if (persisted !== binding) {
      await this.#options.state.putBinding(this.#options.scope, persisted);
    }
    const resolved = { binding: persisted, session };
    this.#cache.set(senderId, resolved);
    return resolved;
  }

  async #loadBinding(senderId: string): Promise<BotBinding> {
    const binding = await this.#options.state.getBinding(this.#options.scope, senderId);
    if (!binding || binding.revokedAt !== undefined) throw new UserSessionNotBoundError(senderId);
    if (binding.directory) return binding;
    const withDirectory = { ...binding, directory: this.#options.defaultDirectory };
    await this.#options.state.putBinding(this.#options.scope, withDirectory);
    return withDirectory;
  }

  async #reconcileBinding(binding: BotBinding): Promise<BotBinding> {
    if (!binding.variant) return binding;
    if (binding.model && binding.directory) {
      const model = toOpencodeModel(binding.model);
      if (await this.#options.isVariantCompatible(binding.directory, model, binding.variant)) {
        return binding;
      }
    }
    const { variant: _removed, ...withoutVariant } = binding;
    await this.#options.state.putBinding(this.#options.scope, withoutVariant);
    return withoutVariant;
  }

  async #serialized<TResult>(
    senderId: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.#tails.get(senderId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#tails.set(senderId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.#tails.get(senderId) === tail) this.#tails.delete(senderId);
    }
  }
}

export function buildUserPromptOptions(
  command: OmoCommand,
  binding: BotBinding,
  session: OpencodeSession,
): SendPromptOptions {
  const routed = buildOmoSendPromptOptions(command, session);
  const fallback = command.mode === "none"
    ? routed.agent
    : buildOmoSendPromptOptions({ body: "", mode: "none" }, session).agent;
  const agent = command.mode !== "none" && routed.agent
    ? routed.agent
    : binding.agent ?? fallback;
  const model = binding.model ? toOpencodeModel(binding.model, binding.variant) : undefined;
  return {
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    system: `${routed.system}\n${REPLY_STYLE_SYSTEM[binding.replyStyle]}`,
    ...(binding.model && binding.variant ? { variant: binding.variant } : {}),
  };
}

function applyPreferencePatch(
  binding: BotBinding,
  patch: UserSessionPreferencePatch,
): BotBinding {
  let next: BotBinding = { ...binding };
  if (patch.directory !== undefined) next = { ...next, directory: patch.directory };
  if (patch.agent !== undefined) next = { ...next, agent: patch.agent };
  if (patch.clearAgent) {
    const { agent: _agent, ...rest } = next;
    next = rest;
  }
  if (patch.model !== undefined) next = { ...next, model: patch.model };
  if (patch.clearModel) {
    const { model: _model, variant: _variant, ...rest } = next;
    next = rest;
  }
  if (patch.variant !== undefined) next = { ...next, variant: patch.variant };
  if (patch.clearVariant) {
    const { variant: _variant, ...rest } = next;
    next = rest;
  }
  if (patch.replyStyle !== undefined) next = { ...next, replyStyle: patch.replyStyle };
  return next;
}

function sessionOptions(binding: BotBinding): {
  readonly agent?: string;
  readonly directory?: string;
  readonly model?: OpencodeModel;
} {
  return {
    ...(binding.agent ? { agent: binding.agent } : {}),
    ...(binding.directory ? { directory: binding.directory } : {}),
    ...(binding.model ? { model: toOpencodeModel(binding.model, binding.variant) } : {}),
  };
}

function toOpencodeModel(model: BotModelSelection, variant?: string): OpencodeModel {
  return {
    modelID: model.modelId,
    providerID: model.providerId,
    ...(variant ? { variant } : {}),
  };
}

function bindingFingerprint(binding: BotBinding): string {
  return JSON.stringify(binding);
}
