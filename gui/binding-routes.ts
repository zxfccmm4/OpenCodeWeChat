import type { AccountData } from "../types/wechat.js";
import type { BindingService } from "../storage/binding-types.js";

export interface BindingRouteDeps {
  readonly bindingService: BindingService;
  readonly loadCredentials: () => AccountData | null;
}

export async function handleBindingApiRoute(
  request: Request,
  route: string,
  deps: BindingRouteDeps,
): Promise<Response | undefined> {
  if (!route.startsWith("GET /api/bindings") && !route.startsWith("POST /api/bindings")) {
    return undefined;
  }
  const account = deps.loadCredentials();
  if (account === null) return json({ error: "未登录微信，无法管理绑定" }, 409);
  const scope = {
    accountId: account.accountId,
    profileId: account.userId?.trim() || account.accountId,
  };
  switch (route) {
    case "POST /api/bindings/code":
      return json(await deps.bindingService.generateCode(scope));
    case "GET /api/bindings":
      return json({ bindings: await deps.bindingService.listBindings(scope) });
    case "POST /api/bindings/revoke": {
      const body = await parseJsonBody(request);
      if (!isRevokeBody(body)) return json({ error: "bindingId 必须是非空字符串" }, 400);
      return json({ revoked: await deps.bindingService.revoke(scope, body.bindingId) });
    }
    default:
      return json({ error: "not found" }, 404);
  }
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isRevokeBody(value: unknown): value is { readonly bindingId: string } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && "bindingId" in value
    && typeof value.bindingId === "string"
    && value.bindingId.trim().length > 0;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}
