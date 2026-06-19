import {
  getString,
  isObject,
} from "./http";

export function extractResponseError(data: unknown): string | undefined {
  if (!isObject(data)) return undefined;
  const info = Reflect.get(data, "info");
  if (!isObject(info)) return undefined;
  const error = Reflect.get(info, "error");
  if (!isObject(error)) return undefined;
  const nested = Reflect.get(error, "data");
  const message = isObject(nested) ? getString(nested, "message") : undefined;
  return message || getString(error, "name");
}

export function extractResponseText(data: unknown): string {
  return [...getTextCandidates(data)]
    .sort((a: string, b: string) => b.length - a.length)[0] ?? "";
}

export function getParts(data: unknown): readonly unknown[] {
  if (!isObject(data)) return [];

  const parts = Reflect.get(data, "parts");
  if (Array.isArray(parts)) return parts;

  const nested = Reflect.get(data, "data");
  if (!isObject(nested)) return [];

  const nestedParts = Reflect.get(nested, "parts");
  return Array.isArray(nestedParts) ? nestedParts : [];
}

function getTextCandidates(data: unknown): readonly string[] {
  const candidates = [getPartsText(getParts(data))];
  for (const parts of getNestedMessageParts(data)) {
    candidates.push(getPartsText(parts));
  }
  return candidates.filter((text) => text.length > 0);
}

function getPartsText(parts: readonly unknown[]): string {
  return parts
    .map(getTextPart)
    .filter((text): text is string => text !== undefined)
    .join("\n");
}

function getNestedMessageParts(data: unknown): readonly (readonly unknown[])[] {
  if (!isObject(data)) return [];
  const nested = Reflect.get(data, "data");
  const values = [
    Reflect.get(data, "messages"),
    Reflect.get(data, "message"),
    isObject(nested) ? Reflect.get(nested, "messages") : undefined,
    isObject(nested) ? Reflect.get(nested, "message") : undefined,
  ];

  const results: Array<readonly unknown[]> = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const parts = getMessageParts(item);
        if (parts) results.push(parts);
      }
      continue;
    }
    const parts = getMessageParts(value);
    if (parts) results.push(parts);
  }
  return results;
}

function getMessageParts(value: unknown): readonly unknown[] | undefined {
  if (!isObject(value)) return undefined;
  const parts = Reflect.get(value, "parts");
  return Array.isArray(parts) ? parts : undefined;
}

function getTextPart(part: unknown): string | undefined {
  if (!isObject(part)) return undefined;
  const type = getString(part, "type");
  const text = getString(part, "text");
  return type === "text" && text ? text : undefined;
}
