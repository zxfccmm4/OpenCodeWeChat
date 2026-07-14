import { sendMediaMessage } from "../api/media";
import type { DownloadedMedia } from "../api/media-download";
import type { IncomingMedia } from "../types/wechat";
import type { OpencodeRuntime, OpencodeSession } from "../opencode/client";
import type { ReplyStreamHandle } from "../opencode/stream";
import {
  cacheContextToken,
  getCachedContextToken,
} from "../core/context-token";
import type {
  LocalCommand,
  LocalCommandParseOptions,
  LocalCommandParseResult,
} from "../core/local-command-contract";
import type {
  LocalCommandHandleResult,
  LocalCommandHandlerDeps,
} from "../core/local-command-handler";
import { buildOmoPrompt, parseOmoCommand } from "../core/omo-command";
import type { StopTypingFn } from "../core/typing-indicator";
import {
  generateClientId,
  sendTextMessage,
} from "../api/ilink";
import {
  getLatestPlanContext,
  saveLatestPlanContext,
} from "../storage/omo-plan-context";
import {
  hasProcessedMessage,
  markMessageProcessed,
} from "../storage/processed-messages";
import { restartOpencode, sendPrompt } from "../opencode/client";

export type OpenReplyStreamFn = (
  session: OpencodeSession,
  onText: (cumulative: string) => void,
) => Promise<ReplyStreamHandle>;

export type StartTypingIndicatorFn = (params: {
  readonly baseUrl: string;
  readonly contextToken?: string;
  readonly ilinkUserId: string;
  readonly token: string;
}) => Promise<StopTypingFn>;

export type LocalCommandRuntime = LocalCommandHandlerDeps;

export type MessageProcessorDeps = {
  readonly buildOmoPrompt: typeof buildOmoPrompt;
  readonly cacheContextToken: typeof cacheContextToken;
  readonly downloadIncomingMedia: (
    media: IncomingMedia,
    options: {
      readonly cdnBaseUrl: string;
      readonly inboxDir: string;
    },
  ) => Promise<DownloadedMedia>;
  readonly generateClientId: typeof generateClientId;
  readonly getCachedContextToken: typeof getCachedContextToken;
  readonly getLatestPlanContext: typeof getLatestPlanContext;
  readonly handleLocalCommand?: (params: {
    readonly command: LocalCommand;
    readonly deps: LocalCommandRuntime;
    readonly senderId: string;
  }) => Promise<LocalCommandHandleResult>;
  readonly hasProcessedMessage: typeof hasProcessedMessage;
  readonly hasWelcomedSender?: (senderId: string) => boolean;
  readonly markMessageProcessed: typeof markMessageProcessed;
  readonly markSenderWelcomed?: (senderId: string) => void;
  readonly openReplyStream: OpenReplyStreamFn | null;
  readonly parseLocalCommand?: (
    text: string,
    options?: LocalCommandParseOptions,
  ) => LocalCommandParseResult;
  readonly parseOmoCommand: typeof parseOmoCommand;
  readonly restartOpencode: typeof restartOpencode;
  readonly saveLatestPlanContext: typeof saveLatestPlanContext;
  readonly sendMediaMessage: typeof sendMediaMessage;
  readonly sendPrompt: typeof sendPrompt;
  readonly sendTextMessage: typeof sendTextMessage;
  readonly startTypingIndicator: StartTypingIndicatorFn;
};

export type ProcessorContext = {
  readonly account: {
    readonly accountId: string;
    readonly baseUrl: string;
    readonly profileId: string;
    readonly token: string;
  };
  readonly channelVersion: string;
  readonly cdnBaseUrl: string;
  readonly inboxDir: string;
  readonly longPromptTimeoutMs: number;
  readonly maxMessageAttempts: number;
  readonly typingMaxDurationMs: number;
  readonly verboseLogs: boolean;
  readonly maxTextLen: number;
  readonly log: (msg: string) => void;
  readonly logError: (msg: string) => void;
  readonly replyTextChunkChars: number;
};

export type ProcessMessageResult =
  | { readonly status: "processed"; readonly opencode?: OpencodeRuntime }
  | { readonly status: "skipped"; readonly opencode?: OpencodeRuntime }
  | { readonly status: "failed-retryable"; readonly opencode?: OpencodeRuntime };
