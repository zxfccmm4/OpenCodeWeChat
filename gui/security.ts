import crypto from "node:crypto";

export const GUI_ADMIN_TOKEN = crypto.randomUUID();

export function isTrustedGuiHost(req: Request): boolean {
  const url = new URL(req.url);
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
}

export function authorizeGuiApiRequest(req: Request, adminToken: string): boolean {
  if (!isTrustedGuiHost(req)) return false;
  const url = new URL(req.url);
  const origin = req.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== url.origin) return false;
    } catch {
      return false;
    }
  }
  return req.headers.get("X-OpenCode-WeChat-Token") === adminToken;
}

export function renderGuiPage(page: string, adminToken: string): string {
  return page.replaceAll("__GUI_TOKEN__", adminToken);
}
