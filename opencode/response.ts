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
  return getParts(data)
    .map(getTextPart)
    .filter((text): text is string => text !== undefined)
    .join("\n");
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

function getTextPart(part: unknown): string | undefined {
  if (!isObject(part)) return undefined;
  const type = getString(part, "type");
  const text = getString(part, "text");
  return type === "text" && text ? text : undefined;
}
