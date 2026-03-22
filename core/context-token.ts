const cache = new Map<string, string>();

export function cacheContextToken(userId: string, token: string): void {
  cache.set(userId, token);
}

export function getCachedContextToken(userId: string): string | undefined {
  return cache.get(userId);
}

export function clearContextTokenCache(): void {
  cache.clear();
}
