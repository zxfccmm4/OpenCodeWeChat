export class OpencodeHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details: string,
  ) {
    super(message);
    this.name = "OpencodeHttpError";
  }
}

export function getAuthHeader(): string {
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? "";
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

export async function requestJson(params: {
  readonly authHeader: string;
  readonly body?: unknown;
  readonly method?: "GET" | "POST";
  readonly serverUrl: string;
  readonly path: string;
}): Promise<unknown> {
  const response = await fetch(new URL(params.path, params.serverUrl), {
    method: params.method ?? "GET",
    headers: {
      Authorization: params.authHeader,
      ...(params.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
  });

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new OpencodeHttpError(
      `HTTP ${response.status}${details ? `: ${details}` : ""}`,
      response.status,
      details,
    );
  }

  if (response.status === 204) return {};
  const text = await response.text();
  if (!text.trim()) return {};
  const data: unknown = JSON.parse(text);
  return data;
}

export async function readErrorDetails(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return "";

  try {
    const data: unknown = JSON.parse(text);
    if (!isObject(data)) return text;

    const message = getString(data, "message");
    if (message) return message;

    const dataMessage = getNestedString(data, "data", "message");
    if (dataMessage) return dataMessage;

    const errorMessage = getNestedString(data, "error", "message");
    if (errorMessage) return errorMessage;
  } catch {
    return text;
  }

  return text;
}

export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export function getString(
  record: object,
  key: string,
): string | undefined {
  const value = Reflect.get(record, key);
  return typeof value === "string" ? value : undefined;
}

function getNestedString(
  record: object,
  key: string,
  nestedKey: string,
): string | undefined {
  const nested = Reflect.get(record, key);
  return isObject(nested) ? getString(nested, nestedKey) : undefined;
}
