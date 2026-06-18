export type OpencodeModel = {
  readonly providerID: string;
  readonly modelID: string;
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
  readonly system?: string;
  readonly timeoutMs?: number;
};

export interface OpencodeSession {
  readonly id: string;
  readonly serverUrl: string;
  readonly authHeader: string;
  readonly model?: OpencodeModel;
  readonly agent?: string;
  readonly agents: readonly OpencodeAgent[];
  close(): void;
}

export interface StartedOpencodeServer {
  readonly authHeader: string;
  readonly url: string;
  close(): void;
}
