export type OpencodeModel = {
  readonly providerID: string;
  readonly modelID: string;
  readonly variant?: string;
};

export type OpencodeAgent = {
  readonly id?: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly mode?: string;
  readonly hidden?: boolean;
};

export type SendPromptOptions = {
  readonly agent?: string;
  readonly model?: OpencodeModel;
  readonly system?: string;
  readonly timeoutMs?: number;
  readonly variant?: string;
};

export interface OpencodeTransport {
  readonly serverUrl: string;
  readonly authHeader: string;
  readonly agents: readonly OpencodeAgent[];
  close(): void;
}

export interface OpencodeConnection {
  readonly serverUrl: string;
  readonly authHeader: string;
  readonly agents: readonly OpencodeAgent[];
  readonly generation: number;
}

export interface OpencodeSession {
  readonly id: string;
  readonly transport: OpencodeConnection;
  readonly directory?: string;
  readonly model?: OpencodeModel;
  readonly agent?: string;
}

export interface StartedOpencodeServer {
  readonly authHeader: string;
  readonly url: string;
  close(): void;
}
