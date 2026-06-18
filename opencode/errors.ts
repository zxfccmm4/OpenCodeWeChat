export function isOpencodeConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${err.name}: ${err.message}`.toLowerCase();
  return (
    text.includes("unable to connect")
    || text.includes("econnrefused")
    || text.includes("connection refused")
    || text.includes("connectionrefused")
    || text.includes("connection closed")
    || text.includes("socket connection was closed")
    || text.includes("fetch failed")
    || text.includes("operation timed out")
    || text.includes("timed out")
    || text.includes("timeout")
    || text.includes("aborterror")
  );
}
