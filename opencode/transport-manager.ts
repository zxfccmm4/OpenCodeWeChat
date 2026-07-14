import type {
  OpencodeConnection,
  OpencodeTransport,
} from "./types";

type StartTransport = () => Promise<OpencodeTransport>;

export class OpencodeTransportClosedError extends Error {
  constructor() {
    super("OpenCode transport manager 已关闭");
    this.name = "OpencodeTransportClosedError";
  }
}

export class OpencodeTransportManager {
  readonly #start: StartTransport;
  #transport: OpencodeTransport;
  #connection: OpencodeConnection;
  #generation = 0;
  #transportClosed = false;
  #closed = false;
  #restartPromise: Promise<OpencodeConnection> | null = null;

  constructor(initial: OpencodeTransport, start: StartTransport) {
    this.#transport = initial;
    this.#connection = toConnection(initial, this.#generation);
    this.#start = start;
  }

  current(): OpencodeConnection {
    return this.#connection;
  }

  restart(observedGeneration: number): Promise<OpencodeConnection> {
    if (this.#closed) return Promise.reject(new OpencodeTransportClosedError());
    if (observedGeneration !== this.#generation) return Promise.resolve(this.#connection);
    if (this.#restartPromise) return this.#restartPromise;

    const restart = this.#replaceTransport();
    this.#restartPromise = restart;
    void restart.finally(() => {
      if (this.#restartPromise === restart) this.#restartPromise = null;
    }).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
    });
    return restart;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeCurrentTransport();
  }

  async #replaceTransport(): Promise<OpencodeConnection> {
    this.#closeCurrentTransport();
    const replacement = await this.#start();
    if (this.#closed) {
      closeTransport(replacement);
      throw new OpencodeTransportClosedError();
    }
    this.#transport = replacement;
    this.#transportClosed = false;
    this.#generation += 1;
    this.#connection = toConnection(replacement, this.#generation);
    return this.#connection;
  }

  #closeCurrentTransport(): void {
    if (this.#transportClosed) return;
    this.#transportClosed = true;
    closeTransport(this.#transport);
  }
}

function toConnection(
  transport: OpencodeTransport,
  generation: number,
): OpencodeConnection {
  return {
    agents: transport.agents,
    authHeader: transport.authHeader,
    generation,
    serverUrl: transport.serverUrl,
  };
}

function closeTransport(transport: OpencodeTransport): void {
  try {
    transport.close();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`[opencode] 关闭服务时已退出: ${error.message}\n`);
  }
}
