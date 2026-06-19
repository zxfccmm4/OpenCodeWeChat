import { sendMediaMessage } from "../api/media";
import type { DownloadedMedia } from "../api/media-download";
import type { IncomingMedia } from "../types/wechat";
import type { OpencodeSession } from "../opencode/client";
import type { ReplyStreamHandle } from "../opencode/stream";
import {
  cacheContextToken,
  getCachedContextToken,
} from "../core/context-token";
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
  readonly hasProcessedMessage: typeof hasProcessedMessage;
  readonly markMessageProcessed: typeof markMessageProcessed;
  readonly openReplyStream: OpenReplyStreamFn | null;
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
    readonly baseUrl: string;
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
  | { readonly status: "processed"; readonly opencode?: OpencodeSession }
  | { readonly status: "skipped"; readonly opencode?: OpencodeSession }
  | { readonly status: "failed-retryable"; readonly opencode?: OpencodeSession };
