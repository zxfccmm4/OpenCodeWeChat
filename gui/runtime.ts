import { spawn } from "node:child_process";

export function openBrowser(url: string, log: (message: string) => void): void {
  if (process.env.OPENCODE_WECHAT_GUI_NO_OPEN === "1") return;
  const child = process.platform === "darwin"
    ? spawn("open", [url], { detached: true, stdio: "ignore" })
    : process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.on("error", (error) => log(`无法打开浏览器: ${error.message}`));
  child.unref();
}

export async function isOurGuiRunning(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const data = await res.json() as { service?: unknown };
    return data.service === "opencode-wechat-gui";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
