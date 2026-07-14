import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpencodeDiscovery } from "../opencode/discovery";
import type {
  DiscoveryListKind,
  DiscoverySnapshot,
  DiscoverySnapshotStore,
} from "../opencode/discovery-types";
import type { OpencodeConnection } from "../opencode/types";

export class MemoryDiscoverySnapshots implements DiscoverySnapshotStore {
  readonly entries = new Map<DiscoveryListKind, DiscoverySnapshot>();
  readonly invalidated: string[] = [];

  async load(kind: DiscoveryListKind): Promise<DiscoverySnapshot | undefined> {
    return this.entries.get(kind);
  }

  async save(snapshot: DiscoverySnapshot): Promise<void> {
    this.entries.set(snapshot.kind, snapshot);
  }

  async invalidateProjectChange(directory: string): Promise<void> {
    this.invalidated.push(directory);
    for (const [kind, snapshot] of this.entries) {
      if (kind !== "project") this.entries.delete(kind);
    }
  }
}

export const discoveryServers: Bun.Server<unknown>[] = [];
export const discoveryTemporaryPaths: string[] = [];

export async function cleanDiscoveryFixtures(): Promise<void> {
  for (const server of discoveryServers.splice(0)) server.stop(true);
  for (const path of discoveryTemporaryPaths.splice(0)) {
    await rm(path, { force: true, recursive: true });
  }
}

export async function createDiscoveryDirectories(): Promise<{
  readonly a: string;
  readonly b: string;
  readonly link: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "opencode-discovery-"));
  discoveryTemporaryPaths.push(root);
  const a = join(root, "a");
  const b = join(root, "b");
  const link = join(root, "linked-a");
  await mkdir(a);
  await mkdir(b);
  await symlink(a, link);
  return { a: await realpath(a), b: await realpath(b), link };
}

export function startDiscoveryFake(handler: (request: Request) => Response): OpencodeConnection {
  const server = Bun.serve({ port: 0, fetch: handler });
  discoveryServers.push(server);
  return {
    agents: [],
    authHeader: "Basic test",
    generation: 0,
    serverUrl: server.url.toString(),
  };
}

export function createTestDiscovery(
  connection: OpencodeConnection,
  snapshots = new MemoryDiscoverySnapshots(),
) {
  return { discovery: new OpencodeDiscovery({ connection: () => connection, snapshots }), snapshots };
}
