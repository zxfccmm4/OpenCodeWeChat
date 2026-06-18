export function isOpencodeToolChild(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.OPENCODE === "1" || Boolean(env.OPENCODE_PID?.trim());
}
