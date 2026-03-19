# Newton VM Agent

This fork narrows OpenCode into a lean local web product for VM operations.

It is intentionally:

- web-only
- local-first
- single-user
- Ollama-only for models
- Linux-VM-only for remote execution

## What it does

- stores Linux VM connections locally per workspace
- lets the `execute` agent connect over SSH
- runs commands, fetches logs, uploads and downloads files, and executes multi-step remote tasks
- keeps MCP, skills, commands, plugins, and question flow available to the agent

## What it does not do

- desktop app
- TUI workflows
- shared hosted control plane
- multi-user collaboration
- cloud model providers
- provider OAuth login flows

## Run it

From the repo root:

```powershell
bun --use-system-ca install
bun --use-system-ca run --cwd packages/app build
bun --use-system-ca run --cwd packages/opencode src/index.ts web
```

Or use:

```powershell
.\Start-Web.cmd
```

## First-use flow

1. Open `Settings -> Ollama`
2. Set the Ollama URL, usually `http://127.0.0.1:11434`
3. Detect and save models
4. Open `Settings -> VMs`
5. Add a Linux VM and test the connection
6. Start a session and switch to the `execute` agent

## Docs

Local docs for this fork live in [`docs/`](./docs/README.md):

- [`docs/scope.md`](./docs/scope.md)
- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/usage.md`](./docs/usage.md)

## Notes

- VM credentials are stored locally for this fork.
- The machine running the app must already have network reachability to the target VMs.
- The product should stay lean. Anything outside the VM operations workflow is out of scope unless it directly supports that workflow.
