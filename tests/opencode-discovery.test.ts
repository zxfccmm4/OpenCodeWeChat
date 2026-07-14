import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { OpencodeDiscoveryError } from "../opencode/discovery";
import {
  cleanDiscoveryFixtures,
  createDiscoveryDirectories,
  createTestDiscovery,
  startDiscoveryFake,
} from "./opencode-discovery-fixtures";

afterEach(async () => {
  await cleanDiscoveryFixtures();
});

describe("OpenCode directory-aware discovery", () => {
  test("lists canonical deduplicated projects and resolves a persisted numeric symlink selection", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    const queries: string[] = [];
    const connection = startDiscoveryFake((request) => {
      const url = new URL(request.url);
      queries.push(url.searchParams.get("directory") ?? "");
      return Response.json([
        { worktree: dirs.b, sandboxes: [dirs.link] },
        { worktree: dirs.a, sandboxes: [] },
      ]);
    });
    const { discovery, snapshots } = createTestDiscovery(connection);

    // When
    const projects = await discovery.listProjects(dirs.a);
    const selected = await discovery.selectProject(dirs.b, "1");

    // Then
    expect(projects).toEqual([{ path: dirs.a }, { path: dirs.b }]);
    expect(selected).toBe(await realpath(dirs.a));
    expect(queries).toEqual([dirs.a]);
    expect(snapshots.invalidated).toEqual([dirs.b]);
  });

  test("rejects stale project numbers and invalid direct paths without mutation", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    const { discovery, snapshots } = createTestDiscovery(startDiscoveryFake(() => Response.json([])));

    // When / Then
    await expect(discovery.selectProject(dirs.a, "1")).rejects.toBeInstanceOf(OpencodeDiscoveryError);
    await expect(discovery.selectProject(dirs.a, join(dirs.a, "missing")))
      .rejects.toMatchObject({ code: "invalid_path" });
    expect(snapshots.invalidated).toEqual([]);
  });

  test("discovers directory-scoped models and clears an incompatible variant on selection", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    const queries: string[] = [];
    const connection = startDiscoveryFake((request) => {
      const url = new URL(request.url);
      queries.push(`${url.pathname}:${url.searchParams.get("directory")}`);
      return Response.json({ providers: [{
        id: "z-provider",
        models: {
          beta: { id: "beta", name: "Beta", variants: { high: {} } },
          alpha: { id: "alpha", name: "Alpha", variants: { low: {}, high: {} } },
        },
      }] });
    });
    const { discovery } = createTestDiscovery(connection);

    // When
    const models = await discovery.listModels(dirs.a);
    const compatible = await discovery.selectModel(dirs.a, "1", "high");
    const incompatible = await discovery.selectModel(dirs.a, "z-provider/beta", "low");
    const supportsHigh = await discovery.isVariantCompatible(
      dirs.a,
      { modelID: "alpha", providerID: "z-provider" },
      "high",
    );

    // Then
    expect(models.map((model) => model.value)).toEqual(["z-provider/alpha", "z-provider/beta"]);
    expect(compatible.variant).toBe("high");
    expect(incompatible).toEqual({ model: { modelID: "beta", providerID: "z-provider" } });
    expect(supportsHigh).toBe(true);
    expect(queries).toEqual([`/config/providers:${dirs.a}`]);
  });

  test("separates caches by directory and filters hidden or subagent-only agents", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    const queries: string[] = [];
    const connection = startDiscoveryFake((request) => {
      const url = new URL(request.url);
      const directory = url.searchParams.get("directory") ?? "";
      queries.push(`${url.pathname}:${directory}`);
      return Response.json([
        { hidden: false, mode: "primary", name: directory === dirs.a ? "Alpha" : "Beta" },
        { hidden: true, mode: "primary", name: "Hidden" },
        { hidden: false, mode: "subagent", name: "Worker" },
      ]);
    });
    const { discovery } = createTestDiscovery(connection);

    // When
    const first = await discovery.listAgents(dirs.a);
    const cached = await discovery.listAgents(dirs.a);
    const second = await discovery.listAgents(dirs.b);

    // Then
    expect(first.map((agent) => agent.value)).toEqual(["Alpha"]);
    expect(cached).toEqual(first);
    expect(second.map((agent) => agent.value)).toEqual(["Beta"]);
    expect(queries).toEqual([`/agent:${dirs.a}`, `/agent:${dirs.b}`]);
  });

  test("uses persisted model and variant snapshots and rejects stale values", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    let variants: Record<string, object> = { high: {}, low: {} };
    const connection = startDiscoveryFake(() => Response.json({
      providers: [{ id: "p", models: { m: { id: "m", variants } } }],
    }));
    const { discovery } = createTestDiscovery(connection);
    await discovery.listModels(dirs.a);
    await discovery.listVariants(dirs.a, { modelID: "m", providerID: "p" });
    variants = { high: {} };
    await discovery.selectProject(dirs.a, dirs.b);

    // When / Then
    await expect(discovery.selectModel(dirs.b, "1")).rejects.toMatchObject({ code: "stale_snapshot" });
    await expect(discovery.selectVariant(dirs.b, { modelID: "m", providerID: "p" }, "2"))
      .rejects.toMatchObject({ code: "stale_snapshot" });
  });

  test("supports direct and numeric visible-agent and variant selections without mutating on errors", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    const connection = startDiscoveryFake((request) => new URL(request.url).pathname === "/agent"
      ? Response.json([{ id: "builder", mode: "primary", name: "Builder" }])
      : Response.json({ providers: [{
        id: "p",
        models: { m: { id: "m", variants: { low: {}, high: {} } } },
      }] }));
    const { discovery, snapshots } = createTestDiscovery(connection);
    await discovery.listAgents(dirs.a);
    await discovery.listVariants(dirs.a, { modelID: "m", providerID: "p" });
    const before = JSON.stringify([...snapshots.entries]);

    // When
    const numericAgent = await discovery.selectAgent(dirs.a, "1");
    const directVariant = await discovery.selectVariant(dirs.a, { modelID: "m", providerID: "p" }, "low");

    // Then
    expect(numericAgent).toBe("builder");
    expect(directVariant).toBe("low");
    await expect(discovery.selectAgent(dirs.a, "missing")).rejects.toMatchObject({ code: "invalid_selection" });
    await expect(discovery.selectVariant(dirs.a, { modelID: "m", providerID: "p" }, "max"))
      .rejects.toMatchObject({ code: "invalid_selection" });
    expect(JSON.stringify([...snapshots.entries])).toBe(before);
  });

  test("rejects traversal and unreadable project paths while accepting direct symlinks", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    const unreadable = join(dirs.b, "private");
    await mkdir(unreadable);
    await chmod(unreadable, 0);
    const { discovery, snapshots } = createTestDiscovery(startDiscoveryFake(() => Response.json([])));

    try {
      // When / Then
      expect(await discovery.selectProject(dirs.b, dirs.link)).toBe(dirs.a);
      await expect(discovery.selectProject(dirs.a, `${dirs.link}/../b`))
        .rejects.toMatchObject({ code: "invalid_path" });
      await expect(discovery.selectProject(dirs.a, unreadable))
        .rejects.toMatchObject({ code: "invalid_path" });
      expect(snapshots.invalidated).toEqual([dirs.b]);
    } finally {
      await chmod(unreadable, 0o700);
    }
  });

  test("does not cache failed or malformed provider responses and refetches after project change", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    let calls = 0;
    const connection = startDiscoveryFake((request) => {
      if (new URL(request.url).pathname !== "/config/providers") return Response.json([]);
      calls += 1;
      if (calls === 1) return new Response("temporary", { status: 500 });
      return Response.json({ providers: [
        { id: "p", models: { good: { id: "good", variants: {} }, broken: null } },
        { models: { ignored: { id: "ignored" } } },
      ] });
    });
    const { discovery } = createTestDiscovery(connection);

    // When / Then
    await expect(discovery.listModels(dirs.a)).rejects.toThrow("HTTP 500");
    expect((await discovery.listModels(dirs.a)).map((model) => model.value)).toEqual(["p/good"]);
    await discovery.selectProject(dirs.a, dirs.b);
    expect((await discovery.listModels(dirs.a)).map((model) => model.value)).toEqual(["p/good"]);
    expect(calls).toBe(3);
  });

  test("rejects a persisted numeric model when the refreshed directory no longer exposes it", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    let modelID = "old";
    const connection = startDiscoveryFake(() => Response.json({
      providers: [{ id: "p", models: { [modelID]: { id: modelID, variants: {} } } }],
    }));
    const initial = createTestDiscovery(connection);
    await initial.discovery.listModels(dirs.a);
    modelID = "new";
    const refreshed = createTestDiscovery(connection, initial.snapshots);

    // When / Then
    await expect(refreshed.discovery.selectModel(dirs.a, "1"))
      .rejects.toMatchObject({ code: "stale_snapshot" });
  });

  test("clears every directory cache when a project selection changes", async () => {
    // Given
    const dirs = await createDiscoveryDirectories();
    let modelID = "old";
    let calls = 0;
    const connection = startDiscoveryFake(() => {
      calls += 1;
      return Response.json({
        providers: [{ id: "p", models: { [modelID]: { id: modelID, variants: {} } } }],
      });
    });
    const { discovery } = createTestDiscovery(connection);
    await discovery.listModels(dirs.a);
    await discovery.listModels(dirs.b);
    modelID = "new";

    // When
    await discovery.selectProject(dirs.a, dirs.b);
    const refreshed = await discovery.listModels(dirs.b);

    // Then
    expect(refreshed.map((model) => model.value)).toEqual(["p/new"]);
    expect(calls).toBe(3);
  });
});
