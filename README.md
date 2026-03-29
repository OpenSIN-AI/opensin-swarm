# opencode-omoc-swarm

> 🚀 **Powered by [OpenSIN](https://opensin.ai)** - The Next-Generation Autonomous AI Ecosystem.
> Discover the ultimate A2A fleet, elite agent hosting, and enterprise-grade automation solutions at **[opensin.ai](https://opensin.ai)**!

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
- `swarm.loop` — queue runner: read `.omoc-queue.json` and execute tasks via `swarm.jam` / `swarm.max`

## Side-by-side tmux UI

This repo ships a launcher:

```bash
./bin/oc-swarm --dir /path/to/your/project
```

Requirements: `tmux`, `curl`, `jq`, `lsof`, and `opencode` on PATH.

## Always side-by-side (direnv)

If you want `opencode` to always start in the side-by-side tmux UI inside a project, use `direnv` to prepend that
project's `bin/` to `PATH`, and ship a tiny `bin/opencode` wrapper that launches `bin/oc-swarm`.

### One-time setup

1) Install `direnv`:

```bash
brew install direnv
```

2) Enable the `direnv` hook once for your shell (example: zsh):

```bash
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
exec zsh
```

### Project setup (recommended)

In your target project repo:

```bash
mkdir -p bin
cp /path/to/opencode-omoc-swarm/bin/oc-swarm bin/oc-swarm
cp /path/to/opencode-omoc-swarm/templates/bin/opencode bin/opencode
cp /path/to/opencode-omoc-swarm/templates/.envrc .envrc
chmod +x bin/oc-swarm bin/opencode
direnv allow
```

Now `opencode` (without subcommands) will always open the side-by-side tmux UI.

### Escape hatch

```bash
OMOC_NO_TMUX=1 opencode
# or
opencode --no-tmux
```
