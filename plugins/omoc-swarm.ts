import type { Config } from "@opencode-ai/sdk";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { BunShell } from "@opencode-ai/plugin/dist/shell";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type SwarmMemberConfig = {
  name: string;
  agent: string;
};

type SwarmMember = SwarmMemberConfig & {
  sessionID: string;
};

type SwarmState = {
  id: string;
  directory: string;
  worktree: string;
  createdAt: number;
  createdBySessionID: string;
  members: Record<string, SwarmMember>;
};

const swarms = new Map<string, SwarmState>();
const swarmBySessionID = new Map<string, string>();
let latestConfig: Config | undefined;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

async function shCmd(
  $: BunShell,
  cwd: string,
  cmd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const out = await $.cwd(cwd).nothrow()`bash -lc ${$.escape(cmd)}`;
  return { exitCode: out.exitCode, stdout: out.text(), stderr: out.stderr.toString() };
}

async function ensureGitRepo($: BunShell, cwd: string): Promise<boolean> {
  const res = await shCmd($, cwd, "git rev-parse --is-inside-work-tree");
  return res.exitCode === 0 && res.stdout.trim() === "true";
}

function safeBranchComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "x";
}

async function createGitWorktree(
  $: BunShell,
  repoDir: string,
  worktreeDir: string,
  branchName: string,
): Promise<{ ok: boolean; error?: string }> {
  const add = await shCmd(
    $,
    repoDir,
    `git worktree add -b ${$.escape(branchName)} ${$.escape(worktreeDir)} HEAD`,
  );
  if (add.exitCode !== 0) return { ok: false, error: add.stderr || add.stdout || "git worktree add failed" };
  return { ok: true };
}

async function removeGitWorktree(
  $: BunShell,
  repoDir: string,
  worktreeDir: string,
  branchName: string,
): Promise<void> {
  await shCmd($, repoDir, `git worktree remove --force ${$.escape(worktreeDir)}`);
  await shCmd($, repoDir, `git branch -D ${$.escape(branchName)}`);
}

async function getWorktreeDiff(
  $: BunShell,
  worktreeDir: string,
): Promise<{ changedFiles: string[]; status: string; diff: string }> {
  const status = await shCmd($, worktreeDir, "git status --porcelain");
  const changedFiles = status.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter(Boolean);

  const diff = await shCmd($, worktreeDir, "git diff");

  return {
    changedFiles,
    status: status.stdout.trim(),
    diff: diff.stdout,
  };
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n…(truncated ${text.length - maxChars} chars)…`;
}

function createSwarmId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `swarm_${time}_${rand}`;
}

function normalizeMemberName(name: string): string {
  return name.trim().toLowerCase();
}

function defaultAgentForMemberName(memberName: string): string {
  const key = normalizeMemberName(memberName);
  if (key === "planner") return "plan";
  if (key === "researcher") return "explore";
  if (key === "coder") return "build";
  if (key === "reviewer") return "general";
  return "general";
}

function formatSwarm(swarm: SwarmState): string {
  const members = Object.values(swarm.members)
    .map((m) => `- ${m.name}: agent=${m.agent} session=${m.sessionID}`)
    .join("\n");
  return [
    `swarm: ${swarm.id}`,
    `dir: ${swarm.directory}`,
    `worktree: ${swarm.worktree}`,
    `members:`,
    members || "- (none)",
  ].join("\n");
}

function extractText(parts: Array<any>): string {
  const textChunks = parts
    .filter((p) => p && (p.type === "text" || p.type === "reasoning") && typeof p.text === "string")
    .map((p) => p.text.trim())
    .filter(Boolean);
  return textChunks.join("\n\n").trim();
}

function getAgentModelKey(agentId: string): string {
  const explicit = latestConfig?.agent?.[agentId]?.model;
  const fallback = latestConfig?.model;
  return explicit || fallback || `agent:${agentId}`;
}

function groupMembersByModel(members: SwarmMember[]): Map<string, SwarmMember[]> {
  const groups = new Map<string, SwarmMember[]>();
  for (const member of members) {
    const key = getAgentModelKey(member.agent);
    const list = groups.get(key);
    if (list) list.push(member);
    else groups.set(key, [member]);
  }
  return groups;
}

async function must<T>(label: string, promise: Promise<any>): Promise<T> {
  const result = await promise;
  if (!result) throw new Error(`${label}: no response`);
  if (result.error) {
    const errorMessage =
      typeof result.error === "string"
        ? result.error
        : result.error?.data?.message ||
          result.error?.message ||
          result.error?.name ||
          JSON.stringify(result.error);
    throw new Error(`${label}: ${errorMessage}`);
  }
  return result.data as T;
}

function parseSwarmTitle(title: string): { swarmId?: string; memberName?: string } {
  const raw = title.trim();
  const colonIndex = raw.indexOf(":");
  if (colonIndex === -1) return {};
  const swarmId = raw.slice(0, colonIndex).trim();
  const memberName = raw.slice(colonIndex + 1).trim();
  if (!swarmId || !memberName) return {};
  return { swarmId, memberName };
}

async function discoverSwarmForSession(
  client: any,
  sessionID: string,
  directory: string,
  worktree: string,
): Promise<SwarmState | undefined> {
  try {
    const current = await must<any>(
      `get session ${sessionID}`,
      client.session.get({ query: { directory }, path: { id: sessionID } }),
    );

    const rootID = current.parentID || current.id;
    const root = rootID === current.id
      ? current
      : await must<any>(`get root session ${rootID}`, client.session.get({ query: { directory }, path: { id: rootID } }));

    const children = await must<any[]>(
      `list children for ${rootID}`,
      client.session.children({ query: { directory }, path: { id: rootID } }),
    );

    const prefixCounts = new Map<string, number>();
    for (const child of children) {
      const parsed = parseSwarmTitle(child.title || "");
      if (!parsed.swarmId || !parsed.memberName) continue;
      prefixCounts.set(parsed.swarmId, (prefixCounts.get(parsed.swarmId) || 0) + 1);
    }

    const bestPrefix = Array.from(prefixCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    const fallbackPrefix = parseSwarmTitle(root.title || "").swarmId;
    const swarmId = bestPrefix || fallbackPrefix || `auto_${rootID}`;

    const members: Record<string, SwarmMember> = {};
    for (const child of children) {
      const parsed = parseSwarmTitle(child.title || "");
      if (!parsed.memberName) continue;
      if (parsed.swarmId && parsed.swarmId !== swarmId) continue;
      const normalized = normalizeMemberName(parsed.memberName);
      if (!normalized) continue;
      members[normalized] = {
        name: normalized,
        agent: defaultAgentForMemberName(normalized),
        sessionID: child.id,
      };
    }

    const swarm: SwarmState = {
      id: swarmId,
      directory,
      worktree,
      createdAt: root?.time?.created ?? Date.now(),
      createdBySessionID: rootID,
      members,
    };

    swarms.set(swarmId, swarm);
    swarmBySessionID.set(rootID, swarmId);
    swarmBySessionID.set(sessionID, swarmId);
    for (const member of Object.values(members)) swarmBySessionID.set(member.sessionID, swarmId);

    return swarm;
  } catch {
    return undefined;
  }
}

async function resolveSwarm(
  client: any,
  argsSwarmId: string | undefined,
  sessionID: string,
  directory: string,
  worktree: string,
): Promise<{ swarmId: string; swarm: SwarmState } | { error: string }> {
  const directId = argsSwarmId || swarmBySessionID.get(sessionID);
  if (directId) {
    const existing = swarms.get(directId);
    if (existing) return { swarmId: directId, swarm: existing };
  }

  const discovered = await discoverSwarmForSession(client, sessionID, directory, worktree);
  if (discovered) return { swarmId: discovered.id, swarm: discovered };

  return { error: "Error: no swarm bound to this session (run swarm.create, swarm.discover, or pass id)" };
}

function findMemberNameBySession(swarm: SwarmState, sessionID: string): string | undefined {
  for (const member of Object.values(swarm.members)) {
    if (member.sessionID === sessionID) return member.name;
  }
  return undefined;
}

const OmocSwarmPlugin: Plugin = async ({ client, $ }) => {
  const schema = tool.schema;

  const defaultMembers: SwarmMemberConfig[] = [
    { name: "planner", agent: "plan" },
    { name: "researcher", agent: "explore" },
    { name: "coder", agent: "build" },
    { name: "reviewer", agent: "general" },
  ];

  return {
    config: async (cfg) => {
      latestConfig = cfg;
    },
    tool: {
      "swarm.discover": tool({
        description:
          "Discover and register a swarm from existing session titles (expects titles like '<swarmId>:<memberName>' under the same parent).",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id override"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          return formatSwarm(result.swarm);
        },
      }),

      "swarm.create": tool({
        description:
          "Create a multi-agent swarm (separate sessions) that can run in parallel and message each other via swarm.send.",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id"),
          title: schema.string().min(1).optional().describe("Optional session title prefix"),
          members: schema
            .array(
              schema.object({
                name: schema.string().min(1).describe("Swarm member name (used for routing)"),
                agent: schema.string().min(1).describe("OpenCode agent id (e.g., plan, build, explore, general)"),
              }),
            )
            .optional()
            .describe("Optional custom members list"),
        },
        async execute(args, context) {
          const swarmId = args.id ?? createSwarmId();
          if (swarms.has(swarmId)) return `Error: swarm already exists: ${swarmId}`;

          const memberConfigs = (args.members?.length ? args.members : defaultMembers).map((m) => ({
            name: normalizeMemberName(m.name),
            agent: m.agent.trim(),
          }));

          const duplicate = memberConfigs.find(
            (m, idx) => memberConfigs.findIndex((x) => x.name === m.name) !== idx,
          );
          if (duplicate) return `Error: duplicate member name: ${duplicate.name}`;

          const swarm: SwarmState = {
            id: swarmId,
            directory: context.directory,
            worktree: context.worktree,
            createdAt: Date.now(),
            createdBySessionID: context.sessionID,
            members: {},
          };

          // Allow omitting swarmId on later calls from the "root" session.
          swarmBySessionID.set(context.sessionID, swarmId);

          for (const member of memberConfigs) {
            const titlePrefix = args.title?.trim() || swarmId;
            const session = await must<{ id: string }>(`create session for ${member.name}`, client.session.create({
              query: { directory: context.directory },
              body: {
                parentID: context.sessionID,
                title: `${titlePrefix}:${member.name}`,
              },
            }));

            swarm.members[member.name] = { ...member, sessionID: session.id };
            swarmBySessionID.set(session.id, swarmId);
          }

          swarms.set(swarmId, swarm);

          return formatSwarm(swarm);
        },
      }),

      "swarm.status": tool({
        description: "Show swarm status (members, sessions).",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          return formatSwarm(result.swarm);
        },
      }),

      "swarm.max": tool({
        description:
          "Codebuff-like MAX mode: run multiple parallel editor tries in isolated git worktrees, then use a selector to pick and apply the best result.",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
          prompt: schema.string().min(1).describe("Task prompt to execute"),
          tries: schema.number().min(2).max(5).optional().describe("Number of parallel editor tries (default 3)"),
          testCmd: schema.string().min(1).optional().describe("Optional test command to run inside each worktree"),
          apply: schema.boolean().optional().describe("Apply the selected winner patch onto the main worktree (default true)"),
          cleanup: schema.boolean().optional().describe("Cleanup worktrees/branches after completion (default false)"),
          selector: schema
            .string()
            .min(1)
            .optional()
            .describe("Swarm member to act as selector (default 'reviewer', fallback: 'general')"),
        },
        async execute(args, context) {
          const resolved = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in resolved) return resolved.error;
          const swarm = resolved.swarm;

          if (!(await ensureGitRepo($, context.directory))) {
            return "Error: swarm.max requires a git repository (git rev-parse failed).";
          }

          const selectorName = normalizeMemberName(args.selector || "reviewer");
          const selectorMember =
            swarm.members[selectorName] || swarm.members["reviewer"] || swarm.members["planner"] || swarm.members["coder"];
          if (!selectorMember) return "Error: swarm.max requires a selector member (recommend adding 'reviewer' to the swarm).";

          const tries = clamp(Math.floor(args.tries ?? 3), 2, 5);
          const applyWinner = args.apply ?? true;
          const cleanup = args.cleanup ?? false;
          const runId = safeBranchComponent(new Date().toISOString().replace(/[:.]/g, "-"));
          const worktreeBase = join(context.directory, ".omoc-worktrees", swarm.id, runId);
          await mkdir(worktreeBase, { recursive: true });

          const tryNames = Array.from({ length: tries }, (_, i) => String.fromCharCode("a".charCodeAt(0) + i));
          const strategyByTry: Record<string, string> = {
            a: "Strategy A: minimal, surgical change; prioritize correctness and passing existing behaviors.",
            b: "Strategy B: robust edge cases + add/adjust tests where appropriate; prioritize correctness under variation.",
            c: "Strategy C: clean refactor if needed; prioritize maintainability and clear structure (avoid scope creep).",
            d: "Strategy D: performance/latency focus; avoid unnecessary refactors.",
            e: "Strategy E: documentation/UX polish (only if relevant to the task).",
          };

          const createdWorktrees: Array<{ name: string; dir: string; branch: string }> = [];

          try {
            for (const name of tryNames) {
              const branch = `omoc/${safeBranchComponent(swarm.id)}/${runId}/${name}`;
              const dir = join(worktreeBase, `try_${name}`);
              const created = await createGitWorktree($, context.directory, dir, branch);
              if (!created.ok) throw new Error(`worktree ${name}: ${created.error}`);
              createdWorktrees.push({ name, dir, branch });
            }

            const tryRuns = await Promise.all(
              createdWorktrees.map(async (wt) => {
                const title = `${swarm.id}:max_${wt.name}`;
                const session = await must<{ id: string }>(
                  `create max session ${wt.name}`,
                  client.session.create({
                    query: { directory: wt.dir },
                    body: { parentID: context.sessionID, title },
                  }),
                );

                const editorPrompt = [
                  `You are MAX-TRY '${wt.name}' in swarm '${swarm.id}'.`,
                  strategyByTry[wt.name] || "Strategy: do your best.",
                  "",
                  "Make the changes in THIS worktree only. Keep scope tight. Leave the worktree in a clean state.",
                  "",
                  args.prompt,
                ].join("\n");

                const response = await must<{ parts: Array<any> }>(
                  `prompt max try ${wt.name}`,
                  client.session.prompt({
                    query: { directory: wt.dir },
                    path: { id: session.id },
                    body: { agent: "build", parts: [{ type: "text", text: editorPrompt }] },
                  }),
                );

                const diffInfo = await getWorktreeDiff($, wt.dir);

                let test: { cmd?: string; exitCode?: number; output?: string } | undefined;
                if (args.testCmd) {
                  const t = await shCmd($, wt.dir, args.testCmd);
                  test = {
                    cmd: args.testCmd,
                    exitCode: t.exitCode,
                    output: truncate([t.stdout, t.stderr].filter(Boolean).join("\n"), 8000),
                  };
                }

                return {
                  name: wt.name,
                  worktreeDir: wt.dir,
                  branch: wt.branch,
                  sessionID: session.id,
                  agentOutput: extractText(response.parts) || "(no text output)",
                  changedFiles: diffInfo.changedFiles,
                  status: diffInfo.status,
                  diff: diffInfo.diff,
                  test,
                };
              }),
            );

            const selectorPayload = [
              `You are the SELECTOR for MAX mode in swarm '${swarm.id}'.`,
              `Pick the best candidate to apply to the main worktree.`,
              `Prefer: correctness for the prompt, minimal risk, tests passing (if provided), and clean diff.`,
              `Return STRICT JSON ONLY: {"winner":"a|b|c|d|e","reason":"...","notes":"..."} (winner must be one of the tries).`,
              "",
              ...tryRuns.map((r) => {
                const testLine = r.test ? `test exit=${r.test.exitCode}` : "test: (not run)";
                const filesLine = r.changedFiles.length ? r.changedFiles.join(", ") : "(no changed files)";
                return [
                  `--- TRY ${r.name} ---`,
                  `changed: ${filesLine}`,
                  `status:`,
                  r.status || "(clean)",
                  testLine,
                  "",
                  "diff (truncated):",
                  truncate(r.diff || "", 12000) || "(no diff)",
                ].join("\n");
              }),
            ].join("\n");

            const selectorResponse = await must<{ parts: Array<any> }>(
              `selector ${selectorMember.name}`,
              client.session.prompt({
                query: { directory: swarm.directory },
                path: { id: selectorMember.sessionID },
                body: { agent: selectorMember.agent, parts: [{ type: "text", text: selectorPayload }] },
              }),
            );

            const selectorText = extractText(selectorResponse.parts) || "";
            let winner: string | undefined;
            let selectorReason = selectorText.trim();
            try {
              const parsed = JSON.parse(selectorText);
              if (parsed && typeof parsed.winner === "string") winner = normalizeMemberName(parsed.winner);
              if (parsed && typeof parsed.reason === "string") selectorReason = parsed.reason;
            } catch {
              const m =
                selectorText.match(/\"winner\"\s*:\s*\"([a-e])\"/i) ||
                selectorText.match(/\bwinner\s*[:=]\s*([a-e])\b/i);
              if (m) winner = normalizeMemberName(m[1]);
            }

            if (!winner || !tryNames.includes(winner)) {
              return `Error: selector did not return a valid winner. Output:\n\n${selectorText}`;
            }

            const winning = tryRuns.find((r) => r.name === winner)!;
            let applyNote = "not applied";

            if (applyWinner) {
              const patch = winning.diff || "";
              if (!patch.trim()) {
                applyNote = "winner had no diff; nothing to apply";
              } else {
                const patchFile = join(worktreeBase, `winner_${winner}.patch`);
                await writeFile(patchFile, patch, "utf8");
                const applied = await shCmd($, context.directory, `git apply --whitespace=nowarn ${$.escape(patchFile)}`);
                if (applied.exitCode !== 0) {
                  return [
                    `Error: failed to apply winner patch (try ${winner}).`,
                    `selector reason: ${selectorReason}`,
                    "",
                    "git apply stderr:",
                    applied.stderr || "(none)",
                  ].join("\n");
                }
                applyNote = "applied to main worktree via git apply";
              }
            }

            const report = [
              "MAX mode complete.",
              `winner: ${winner} (${applyNote})`,
              `selector reason: ${selectorReason}`,
              "",
              ...tryRuns.map((r) => {
                const testLine = r.test ? `test exit=${r.test.exitCode}` : "test: (not run)";
                const filesLine = r.changedFiles.length ? r.changedFiles.join(", ") : "(no changed files)";
                return `- try ${r.name}: ${filesLine} | ${testLine}`;
              }),
            ].join("\n");

            return report;
          } finally {
            if (cleanup) {
              for (const wt of createdWorktrees) {
                try {
                  await removeGitWorktree($, context.directory, wt.dir, wt.branch);
                } catch {
                  // ignore cleanup errors
                }
              }
              try {
                await rm(worktreeBase, { recursive: true, force: true });
              } catch {
                // ignore
              }
            }
          }
        },
      }),

      "swarm.parallel": tool({
        description:
          "Run the same prompt across multiple swarm members in parallel (with model-collision gating). Returns a combined report.",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
          prompt: schema.string().min(1).describe("Prompt to send"),
          targets: schema.array(schema.string().min(1)).optional().describe("Optional list of member names to run"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          const swarm = result.swarm;

          const targetNames = (args.targets?.length ? args.targets : Object.keys(swarm.members)).map(
            normalizeMemberName,
          );
          const targets: SwarmMember[] = [];
          for (const name of targetNames) {
            const member = swarm.members[name];
            if (!member) return `Error: unknown member '${name}'. Known: ${Object.keys(swarm.members).join(", ")}`;
            targets.push(member);
          }

          const groups = groupMembersByModel(targets);

          const resultsByMember = new Map<string, string>();
          await Promise.all(
            Array.from(groups.entries()).map(async ([modelKey, group]) => {
              // Same-model group executes sequentially to avoid provider/model collisions.
              for (const member of group) {
                const memberPrompt = [
                  `You are '${member.name}' (agent '${member.agent}') in swarm '${swarm.id}'.`,
                  `If you need to coordinate, use tool swarm.send.`,
                  "",
                  args.prompt,
                ].join("\n");

                const response = await must<{ parts: Array<any> }>(
                  `prompt ${member.name}`,
                  client.session.prompt({
                    query: { directory: swarm.directory },
                    path: { id: member.sessionID },
                    body: {
                      agent: member.agent,
                      parts: [{ type: "text", text: memberPrompt }],
                    },
                  }),
                );

                resultsByMember.set(member.name, extractText(response.parts) || "(no text output)");
              }
            }),
          );

          const header =
            groups.size === 1
              ? `Note: ran sequentially due to model collision (${Array.from(groups.keys()).join(", ")}).`
              : "";

          const combined = targetNames
            .map((name) => {
              const text = resultsByMember.get(name) ?? "(missing)";
              return [`### ${name}`, text].join("\n");
            })
            .join("\n\n");

          return [header, combined].filter(Boolean).join("\n\n");
        },
      }),

      "swarm.jam": tool({
        description:
          "Collaborative swarm run in the SAME worktree: sends a coordination prompt to multiple members so they can work together (may touch the same files).",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
          prompt: schema.string().min(1).describe("Prompt to send"),
          targets: schema.array(schema.string().min(1)).optional().describe("Optional list of member names to include"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          const swarm = result.swarm;

          const targetNames = (args.targets?.length ? args.targets : Object.keys(swarm.members)).map(
            normalizeMemberName,
          );
          const targets: SwarmMember[] = [];
          for (const name of targetNames) {
            const member = swarm.members[name];
            if (!member) return `Error: unknown member '${name}'. Known: ${Object.keys(swarm.members).join(", ")}`;
            targets.push(member);
          }

          const groups = groupMembersByModel(targets);
          const resultsByMember = new Map<string, string>();

          await Promise.all(
            Array.from(groups.entries()).map(async ([, group]) => {
              // Same-model group executes sequentially to avoid provider/model collisions.
              for (const member of group) {
                const memberPrompt = [
                  `You are '${member.name}' (agent '${member.agent}') collaborating in swarm '${swarm.id}'.`,
                  `You share the SAME worktree with other members (no isolation).`,
                  `Coordinate via tool swarm.send before making overlapping edits.`,
                  "",
                  `First message requirement: state which files you plan to touch.`,
                  "",
                  args.prompt,
                ].join("\n");

                const response = await must<{ parts: Array<any> }>(
                  `jam ${member.name}`,
                  client.session.prompt({
                    query: { directory: swarm.directory },
                    path: { id: member.sessionID },
                    body: {
                      agent: member.agent,
                      parts: [{ type: "text", text: memberPrompt }],
                    },
                  }),
                );

                resultsByMember.set(member.name, extractText(response.parts) || "(no text output)");
              }
            }),
          );

          const combined = targetNames
            .map((name) => {
              const text = resultsByMember.get(name) ?? "(missing)";
              return [`### ${name}`, text].join("\n");
            })
            .join("\n\n");

          return combined;
        },
      }),

      "swarm.send": tool({
        description:
          "Send a message to another swarm member (routes as a prompt into their session). Optionally waits for their reply.",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
          to: schema.string().min(1).describe("Target member name"),
          message: schema.string().min(1).describe("Message to deliver"),
          awaitReply: schema.boolean().optional().describe("Wait for the target member to reply (default true)"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          const swarm = result.swarm;

          const toName = normalizeMemberName(args.to);
          const target = swarm.members[toName];
          if (!target) return `Error: unknown member '${toName}'. Known: ${Object.keys(swarm.members).join(", ")}`;

          const fromName = findMemberNameBySession(swarm, context.sessionID) ?? context.agent;
          const awaitReply = args.awaitReply ?? true;

          const payload = [
            `SWARM MESSAGE (${swarm.id})`,
            `from: ${fromName}`,
            `to: ${toName}`,
            "",
            args.message,
            "",
            awaitReply ? `Reply back with swarm.send(to='${fromName}', message=...) if needed.` : "",
          ]
            .filter(Boolean)
            .join("\n");

          const response = await must<{ parts: Array<any> }>(
            `send to ${toName}`,
            client.session.prompt({
              query: { directory: swarm.directory },
              path: { id: target.sessionID },
              body: {
                agent: target.agent,
                parts: [{ type: "text", text: payload }],
              },
            }),
          );

          if (!awaitReply) return `Sent to ${toName}.`;

          const text = extractText(response.parts) || "(no text output)";
          return [`Reply from ${toName}:`, text].join("\n\n");
        },
      }),

      "swarm.forget": tool({
        description: "Forget swarm state in this process (does not delete sessions).",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          const swarmId = result.swarmId;
          const swarm = result.swarm;

          swarms.delete(swarmId);
          swarmBySessionID.delete(context.sessionID);
          for (const member of Object.values(swarm.members)) swarmBySessionID.delete(member.sessionID);

          return `Forgot swarm ${swarmId}. (Sessions remain; re-create mapping with swarm.create.)`;
        },
      }),
    },
  };
};

export default OmocSwarmPlugin;
