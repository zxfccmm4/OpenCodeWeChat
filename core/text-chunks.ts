export function splitTextForWechat(text: string, maxChars: number): readonly string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const max = Number.isFinite(maxChars) && maxChars > 0
    ? Math.floor(maxChars)
    : 1;
  const chunks: string[] = [];
  let current = "";
  let currentLength = 0;

  const pushCurrent = (): void => {
    if (current) {
      chunks.push(current);
    }
    current = "";
    currentLength = 0;
  };

  for (const token of trimmed.split(/(\n{2,}|\n|[ \t]+)/u)) {
    if (!token) continue;
    const tokenLength = countTextChars(token);

    if (current && isWhitespace(current) && !isWhitespace(token)) {
      for (const chunk of splitLongToken(`${current}${token}`, max)) {
        if (chunk.trim()) {
          chunks.push(chunk);
        }
      }
      current = "";
      currentLength = 0;
      continue;
    }

    if (tokenLength > max) {
      pushCurrent();
      for (const chunk of splitLongToken(token, max)) {
        if (chunk.trim()) {
          chunks.push(chunk);
        }
      }
      continue;
    }

    if (currentLength + tokenLength <= max) {
      current += token;
      currentLength += tokenLength;
      continue;
    }

    pushCurrent();
    current = token;
    currentLength = tokenLength;
  }

  pushCurrent();
  return chunks;
}

function countTextChars(value: string): number {
  return Array.from(value).length;
}

function isWhitespace(value: string): boolean {
  return value.trim() === "";
}

function splitLongToken(token: string, maxChars: number): readonly string[] {
  const chars = Array.from(token);
  const chunks: string[] = [];

  for (let index = 0; index < chars.length; index += maxChars) {
    chunks.push(chars.slice(index, index + maxChars).join(""));
  }

  return chunks;
}
