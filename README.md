# OMOC Swarm (OpenCode Plugin)

Codebuff-style multi-agent swarms for **OpenCode**:

- one swarm = multiple OpenCode sessions (planner/researcher/coder/reviewer)
- agent-to-agent messaging (`swarm.send`)
- parallel fan-out with basic model-collision gating (`swarm.parallel`)
- auto-discovery from session titles (`swarm.discover`)

## Install (per project)

Copy (or symlink) the plugin into your repo so **plain** `opencode` auto-loads it:

```bash
mkdir -p .opencode/plugins
cp /path/to/opencode-omoc-swarm/plugins/omoc-swarm.ts .opencode/plugins/omoc-swarm.ts
```

Then run OpenCode as usual:

```bash
opencode
```

## Tools

- `swarm.create` — create a swarm (child sessions)
- `swarm.discover` — discover/register a swarm from existing session titles
- `swarm.status` — show members + session IDs
- `swarm.parallel` — run a prompt across members (parallel where possible)
- `swarm.send` — message another member (routes as a prompt)
- `swarm.forget` — forget local swarm mapping (sessions remain)
- `swarm.max` — MAX mode: parallel editor tries in isolated git worktrees + selector picks winner (optional apply)
- `swarm.jam` — collaborative run in the same worktree (no isolation)
- `swarm.max` — MAX mode: parallel editor tries in isolated git worktrees + selector picks winner (optional apply)

## Side-by-side tmux UI

This repo ships a launcher:

```bash
./bin/oc-swarm --dir /path/to/your/project
```

Requirements: `tmux`, `curl`, `jq`, `lsof`, and `opencode` on PATH.
