import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, sep } from "node:path";

export class ProjectPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPathError";
  }
}

export async function canonicalizeProjectPath(input: string): Promise<string> {
  const trimmed = input.trim();
  const segments = trimmed.split(sep);
  if (!isAbsolute(trimmed) || segments.includes(".") || segments.includes("..")) {
    throw new ProjectPathError(`项目路径必须是规范的绝对路径: ${input}`);
  }
  try {
    const canonical = await realpath(trimmed);
    const details = await stat(canonical);
    if (!details.isDirectory()) throw new ProjectPathError(`项目路径不是目录: ${input}`);
    await access(canonical, constants.R_OK);
    return canonical;
  } catch (error) {
    if (error instanceof ProjectPathError) throw error;
    throw new ProjectPathError(`项目路径不存在或不可读: ${input}`);
  }
}

export async function canonicalizeDiscoveredPaths(
  paths: readonly string[],
): Promise<readonly string[]> {
  const results = await Promise.allSettled(paths.map(canonicalizeProjectPath));
  return results.flatMap((result): readonly string[] => (
    result.status === "fulfilled" ? [result.value] : []
  ));
}
