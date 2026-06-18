/**
 * 微信流式文本气泡：把不断增长的累计文本以"原地更新"的方式发往微信。
 *
 * 机制：同一个 client_id 重复调用 sendmessage，message_state=1(GENERATING)
 * 表示生成中（微信端在同一条气泡里更新内容），最后以 state=2(FINISH) 收口。
 * 更新按 throttleMs 节流，首次更新立即发出让气泡尽快出现。
 */
export type StreamingSendFn = (text: string, finish: boolean) => Promise<void>;

export class StreamingTextBubble {
  private broken = false;
  private chain: Promise<void> = Promise.resolve();
  private finalized = false;
  private lastSentAt = 0;
  private lastSentText = "";
  private latestText = "";
  private sentAny = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: StreamingSendFn,
    private readonly throttleMs: number,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  /** 是否成功发出过 GENERATING 更新（决定 finalize 是否必须收口） */
  get hasSentUpdates(): boolean {
    return this.sentAny;
  }

  /** GENERATING 更新是否已失败（降级信号） */
  get isBroken(): boolean {
    return this.broken;
  }

  update(text: string): void {
    if (this.finalized || this.broken) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed === this.latestText) return;
    this.latestText = trimmed;

    if (this.timer) return;
    const wait = Math.max(0, this.throttleMs - (Date.now() - this.lastSentAt));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushUpdate();
    }, wait);
  }

  private flushUpdate(): void {
    if (this.finalized || this.broken) return;
    const text = this.latestText;
    if (!text || text === this.lastSentText) return;
    this.chain = this.chain.then(async () => {
      if (this.finalized || this.broken) return;
      try {
        await this.send(text, false);
        this.sentAny = true;
        this.lastSentAt = Date.now();
        this.lastSentText = text;
      } catch (err) {
        this.broken = true;
        this.onError(err);
      }
    });
  }

  /**
   * 收口：以 FINISH 状态发送最终文本。
   * - 最终文本为空但已有更新时，用最后一次内容收口（不能让气泡停在生成中）
   * - GENERATING 已损坏时仍尝试 FINISH；失败则抛出由调用方降级
   */
  async finalize(finalText: string): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.chain.catch(() => {});

    const text = finalText.trim() || this.lastSentText;
    if (!text) return;
    await this.send(text, true);
  }
}
