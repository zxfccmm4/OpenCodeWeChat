import { getBotConfig, sendTypingStatus } from "../api/ilink";
import {
  CHANNEL_VERSION,
  TYPING_REFRESH_INTERVAL_MS,
  TYPING_TICKET_TTL_MS,
} from "../config";
import {
  TYPING_STATUS_CANCEL,
  TYPING_STATUS_TYPING,
} from "../types/wechat";

export type StopTypingFn = () => Promise<void>;

type TypingApi = {
  getBotConfig: typeof getBotConfig;
  sendTypingStatus: typeof sendTypingStatus;
};

const DEFAULT_TYPING_API: TypingApi = { getBotConfig, sendTypingStatus };

const ticketCache = new Map<string, { expiresAt: number; ticket: string }>();

export function resetTypingTicketCache(): void {
  ticketCache.clear();
}

export async function getTypingTicket(
  params: {
    readonly baseUrl: string;
    readonly contextToken?: string;
    readonly ilinkUserId: string;
    readonly token: string;
  },
  api: TypingApi = DEFAULT_TYPING_API,
): Promise<string | null> {
  const cached = ticketCache.get(params.ilinkUserId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ticket || null;
  }

  try {
    const resp = await api.getBotConfig(params.baseUrl, params.token, {
      channelVersion: CHANNEL_VERSION,
      contextToken: params.contextToken,
      ilinkUserId: params.ilinkUserId,
    });
    const ticket = (resp.ret === undefined || resp.ret === 0)
      ? (resp.typing_ticket ?? "")
      : "";
    ticketCache.set(params.ilinkUserId, {
      expiresAt: Date.now() + TYPING_TICKET_TTL_MS,
      ticket,
    });
    return ticket || null;
  } catch {
    // 拿不到 ticket 就不显示输入中，不影响主流程
    return null;
  }
}

/**
 * 开启微信"对方正在输入"指示器并周期续期。
 * 返回停止函数（发送取消状态）；所有调用均为尽力而为，失败不抛出。
 */
export async function startTypingIndicator(
  params: {
    readonly baseUrl: string;
    readonly contextToken?: string;
    readonly ilinkUserId: string;
    readonly token: string;
  },
  api: TypingApi = DEFAULT_TYPING_API,
): Promise<StopTypingFn> {
  const ticket = await getTypingTicket(params, api);
  if (!ticket) {
    return async () => {};
  }

  const sendStatus = async (status: number) => {
    try {
      await api.sendTypingStatus(params.baseUrl, params.token, {
        ilink_user_id: params.ilinkUserId,
        status,
        typing_ticket: ticket,
      }, CHANNEL_VERSION);
    } catch {
      // 指示器失败不影响消息处理
    }
  };

  await sendStatus(TYPING_STATUS_TYPING);
  const refresher = setInterval(() => {
    void sendStatus(TYPING_STATUS_TYPING);
  }, TYPING_REFRESH_INTERVAL_MS);

  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(refresher);
    await sendStatus(TYPING_STATUS_CANCEL);
  };
}
