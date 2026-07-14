import type { StartedOpencodeServer } from "./types";

export type SessionProgress = "busy" | "idle" | "retry" | "unknown";

export type SessionSummary = {
  readonly agent: string;
  readonly createdAt: number;
  readonly directory: string;
  readonly id: string;
  readonly model: string;
  readonly progressText: string;
  readonly status: SessionProgress;
  readonly title: string;
  readonly updatedAt: number;
};

export type SessionMessage = {
  readonly completedAt?: number;
  readonly createdAt: number;
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly text: string;
};

export type SessionNotification = {
  readonly createdAt: number;
  readonly id: string;
  readonly message: string;
  readonly sessionId: string;
  readonly title: string;
  readonly type: "completed" | "error";
};

export type MonitorConnection = Pick<StartedOpencodeServer, "authHeader" | "close" | "url">;

export interface SessionMonitor {
  listSessions(): Promise<readonly SessionSummary[]>;
  listMessages(sessionId: string): Promise<readonly SessionMessage[]>;
  listNotifications(since: number): readonly SessionNotification[];
  close(): void;
}
