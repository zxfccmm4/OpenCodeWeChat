import type { AccountScopeInput, BotBinding } from "./bot-state-types.js";

export interface GeneratedBindingCode {
  readonly code: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface PublicBinding {
  readonly bindingId: string;
  readonly boundAt: number;
  readonly senderLabel: string;
}

export type ConsumeBindingCodeResult =
  | { readonly status: "bound"; readonly binding: BotBinding }
  | { readonly status: "already-bound"; readonly binding: BotBinding }
  | { readonly status: "expired" }
  | { readonly status: "invalid" }
  | { readonly status: "rate-limited" };

export interface BindingService {
  readonly consumeCode: (
    scope: AccountScopeInput,
    senderId: string,
    code: string,
  ) => Promise<ConsumeBindingCodeResult>;
  readonly generateCode: (scope: AccountScopeInput) => Promise<GeneratedBindingCode>;
  readonly listBindings: (scope: AccountScopeInput) => Promise<readonly PublicBinding[]>;
  readonly revoke: (scope: AccountScopeInput, bindingId: string) => Promise<boolean>;
}
