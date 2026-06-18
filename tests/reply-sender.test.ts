import { describe, expect, test } from "bun:test";
import { StreamingTextBubble } from "../core/streaming-bubble";
import type { OmoCommand } from "../core/omo-command";
import { sendReplyToUser } from "../polling/reply-sender";
import type { MessageProcessorDeps, ProcessorContext } from "../polling/message-processor";
import type { ParsedMessage } from "../types/wechat";

const TEST_COMMAND: OmoCommand = {
  body: "普通问题",
  mode: "none",
};

const TEST_MESSAGE: ParsedMessage = {
  clientId: "msg-1",
  compiledPrompt: "普通问题",
  contextToken: "ctx-1",
  dedupeKey: "client:msg-1",
  media: [],
  raw: {},
  senderId: "wx-user-1",
  text: "普通问题",
};

const TEST_CONTEXT: ProcessorContext = {
  account: {
    baseUrl: "https://example.com",
    token: "token-1",
  },
  cdnBaseUrl: "https://cdn.example.com",
  channelVersion: "0.4.0",
  inboxDir: "/tmp/inbox",
  log() {},
  logError() {},
  maxMessageAttempts: 3,
  maxTextLen: 200,
  streamUpdateIntervalMs: 1_200,
  verboseLogs: false,
};

function createDeps(sentPlainTexts: string[]): MessageProcessorDeps {
  return {
    buildOmoPrompt(text) {
      return text;
    },
    cacheContextToken() {},
    async downloadIncomingMedia() {
      return { byteLength: 0, savedPath: "/tmp/inbox/mock" };
    },
    generateClientId() {
      return `client-id-${sentPlainTexts.length + 1}`;
    },
    getCachedContextToken() {
      return undefined;
    },
    getLatestPlanContext() {
      return undefined;
    },
    hasProcessedMessage() {
      return false;
    },
    markMessageProcessed() {},
    openReplyStream: null,
    parseOmoCommand(text) {
      return { body: text, mode: "none" };
    },
    async restartOpencode(session) {
      return session;
    },
    saveLatestPlanContext() {},
    async sendMediaMessage() {},
    async sendPrompt() {
      return "";
    },
    async sendStreamingText() {},
    async sendTextMessage(_baseUrl, _token, _to, text) {
      sentPlainTexts.push(text);
    },
    async startTypingIndicator() {
      return async () => {};
    },
  };
}

describe("sendReplyToUser", () => {
  test("splits long text replies so ClawBot receives the complete answer", async () => {
    const sentTexts: string[] = [];
    const longReply = "完整回复".repeat(160);
    const bubble = new StreamingTextBubble(async (text, finish) => {
      if (finish) {
        sentTexts.push(text);
      }
    }, 0);

    await sendReplyToUser({
      bubble,
      command: TEST_COMMAND,
      deps: createDeps(sentTexts),
      fullText: longReply,
      message: TEST_MESSAGE,
      ctx: TEST_CONTEXT,
    });

    expect(sentTexts.length).toBeGreaterThan(1);
    expect(sentTexts.join("")).toBe(longReply);
  });
});
