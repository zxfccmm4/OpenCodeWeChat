import { getString, isObject, OpencodeHttpError, requestJson } from "./http";
import { startOpencodeServer } from "./server";
import { latestActivity, latestFailure, parseMessage, parseSession, readObject, readProgress } from "./session-monitor-parse";
import type {
  MonitorConnection,
  SessionMessage,
  SessionMonitor,
  SessionNotification,
  SessionProgress,
  SessionSummary,
} from "./session-monitor-types";

export type { SessionMonitor } from "./session-monitor-types";

class SessionMonitorClosedError extends Error {
  constructor() {
    super("Session monitor is closed");
    this.name = "SessionMonitorClosedError";
  }
}

export function createSessionMonitor(params: {
  readonly connect?: () => Promise<MonitorConnection>;
} = {}): SessionMonitor {
  const connect = params.connect ?? startOpencodeServer;
  let connectionPromise: Promise<MonitorConnection> | null = null;
  let reconnectPromise: Promise<MonitorConnection> | null = null;
  let refreshPromise: Promise<readonly SessionSummary[]> | null = null;
  let activeConnection: MonitorConnection | null = null;
  let closed = false;
  let previousStatuses = new Map<string, SessionProgress>();
  const notifications: SessionNotification[] = [];

  async function getConnection(): Promise<MonitorConnection> {
    if (closed) throw new SessionMonitorClosedError();
    connectionPromise ??= connect()
      .then((connection) => {
        if (closed) {
          connection.close();
          throw new SessionMonitorClosedError();
        }
        activeConnection = connection;
        return connection;
      })
      .catch((error: unknown) => {
        connectionPromise = null;
        throw error;
      });
    return connectionPromise;
  }

  async function getJson(path: string): Promise<unknown> {
    const connection = await getConnection();
    try {
      return await requestJson({
        authHeader: connection.authHeader,
        path,
        serverUrl: connection.url,
        timeoutMs: 5_000,
      });
    } catch (error) {
      if (error instanceof OpencodeHttpError) throw error;
      if (closed || error instanceof SessionMonitorClosedError) throw new SessionMonitorClosedError();
      reconnectPromise ??= (async () => {
        connectionPromise = null;
        connection.close();
        if (activeConnection === connection) activeConnection = null;
        return getConnection();
      })().finally(() => {
        reconnectPromise = null;
      });
      const reconnected = await reconnectPromise;
      return requestJson({
        authHeader: reconnected.authHeader,
        path,
        serverUrl: reconnected.url,
        timeoutMs: 5_000,
      });
    }
  }

  async function getSessionList(): Promise<readonly unknown[]> {
    try {
      const sessions: unknown[] = [];
      const sessionIds = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const path = `/api/session?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const value = await getJson(path);
        const page = isObject(value) ? Reflect.get(value, "data") : value;
        if (Array.isArray(page)) {
          for (const item of page) {
            const id = isObject(item) ? getString(item, "id") : undefined;
            if (id && sessionIds.has(id)) continue;
            if (id) sessionIds.add(id);
            sessions.push(item);
          }
        }
        const cursorValue = isObject(value) ? readObject(value, "cursor") : undefined;
        const next = cursorValue ? getString(cursorValue, "next") : undefined;
        if (!next || cursors.has(next)) break;
        cursors.add(next);
        cursor = next;
      } while (cursor);
      return sessions;
    } catch (error) {
      if (!(error instanceof OpencodeHttpError) || (error.statusCode !== 404 && error.statusCode !== 405)) throw error;
      const value = await getJson("/session");
      return Array.isArray(value) ? value : [];
    }
  }

  async function captureTransitions(sessions: readonly SessionSummary[]): Promise<void> {
    const next = new Map(sessions.map((session) => [session.id, session.status]));
    for (const session of sessions) {
      const previous = previousStatuses.get(session.id);
      if ((previous === "busy" || previous === "retry") && session.status === "idle") {
        const messages = await getJson(`/session/${encodeURIComponent(session.id)}/message?limit=10000`);
        const failure = latestFailure(messages);
        const latestNotification = notifications[notifications.length - 1];
        notifications.push({
          createdAt: Math.max(Date.now(), (latestNotification?.createdAt ?? 0) + 1),
          id: `${session.id}:${session.updatedAt}:completed`,
          message: failure ?? "Session 已完成",
          sessionId: session.id,
          title: session.title,
          type: failure ? "error" : "completed",
        });
      }
    }
    previousStatuses = next;
    if (notifications.length > 100) notifications.splice(0, notifications.length - 100);
  }

  async function loadSessions(): Promise<readonly SessionSummary[]> {
      const [sessionsValue, statusesValue] = await Promise.all([
        getSessionList(),
        getJson("/session/status"),
      ]);
      const statuses = isObject(statusesValue) ? statusesValue : {};
      const sessions = Array.isArray(sessionsValue)
        ? sessionsValue.flatMap((item): readonly SessionSummary[] => {
          if (!isObject(item)) return [];
          const id = getString(item, "id");
          const statusValue = id ? Reflect.get(statuses, id) : undefined;
          const status = id && Reflect.has(statuses, id)
            ? readProgress(statusValue)
            : "idle";
          const parsed = parseSession(item, status, statusValue);
          return parsed ? [parsed] : [];
        })
        : [];
      const enriched = await Promise.all(sessions.map(async (session): Promise<SessionSummary> => {
        if (session.status !== "busy" && session.status !== "retry") return session;
        const messages = await getJson(`/session/${encodeURIComponent(session.id)}/message?limit=10000`);
        return { ...session, progressText: latestActivity(messages) ?? session.progressText };
      }));
      await captureTransitions(enriched);
      return enriched;
  }

  return {
    listSessions() {
      refreshPromise ??= loadSessions().finally(() => {
        refreshPromise = null;
      });
      return refreshPromise;
    },
    async listMessages(sessionId) {
      const value = await getJson(`/session/${encodeURIComponent(sessionId)}/message?limit=10000`);
      return Array.isArray(value)
        ? value.flatMap((item): readonly SessionMessage[] => {
          const parsed = parseMessage(item);
          return parsed ? [parsed] : [];
        })
        : [];
    },
    listNotifications(since) {
      return notifications.filter((notification) => notification.createdAt > since);
    },
    close() {
      closed = true;
      activeConnection?.close();
      activeConnection = null;
      connectionPromise = null;
      reconnectPromise = null;
      refreshPromise = null;
    },
  };
}
