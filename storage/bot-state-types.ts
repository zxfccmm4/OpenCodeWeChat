export type ReplyStyle = "concise" | "standard" | "detailed";

export interface AccountScopeInput {
  readonly accountId: string;
  readonly profileId: string;
}

export interface BotModelSelection {
  readonly providerId: string;
  readonly modelId: string;
}

export interface BotBinding {
  readonly bindingId: string;
  readonly senderId: string;
  readonly boundAt: number;
  readonly sessionId?: string;
  readonly directory?: string;
  readonly model?: BotModelSelection;
  readonly agent?: string;
  readonly variant?: string;
  readonly replyStyle: ReplyStyle;
  readonly revokedAt?: number;
}

export interface PendingBindingCode {
  readonly attemptsBySender: Readonly<Record<string, number>>;
  readonly id: string;
  readonly keyedDigest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface AccountBotState {
  readonly profileId: string;
  readonly bindings: Readonly<Record<string, BotBinding>>;
  readonly pendingCodes: readonly PendingBindingCode[];
}

export interface BotStateDocument {
  readonly version: 1;
  readonly accounts: Readonly<Record<string, AccountBotState>>;
}

export interface BotStateMutation<TResult> {
  readonly state: AccountBotState;
  readonly result: TResult;
}
