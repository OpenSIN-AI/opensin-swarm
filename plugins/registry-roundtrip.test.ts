import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSwarmRegistry, saveSwarmRegistry } from "./registry.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const baseDir = await mkdtemp(join(tmpdir(), "omoc-registry-"));

try {
  const swarmId = "swarm_roundtrip";
  const saved = await saveSwarmRegistry(baseDir, swarmId, {
    planner: { name: "planner", agent: "plan", capabilities: ["planning"] },
    metis: { name: "metis", agent: "metis", capabilities: ["analysis"] },
  });

  assert(saved.swarmId === swarmId, "saved registry should keep swarm id");
  assert(saved.members.planner?.agentId === "plan", "planner should persist as plan");
  assert(saved.members.metis?.agentId === "metis", "metis should persist as metis");
  assert(saved.members.planner?.capabilities?.includes("planning") === true, "planner capabilities should persist");

  const loaded = await loadSwarmRegistry(baseDir, swarmId);
  assert(loaded !== null, "registry should load after save");
  assert(loaded?.members.planner?.agentId === "plan", "loaded planner should resolve to plan");
  assert(loaded?.members.metis?.agentId === "metis", "loaded metis should resolve to metis");
  assert(loaded?.members.planner?.capabilities?.includes("planning") === true, "loaded capabilities should persist");

  console.log("✓ registry round-trip test passed");
} finally {
  await rm(baseDir, { recursive: true, force: true });
}
