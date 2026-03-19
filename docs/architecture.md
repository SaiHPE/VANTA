# Architecture

## High-Level Shape

This fork still uses the OpenCode local architecture:

- browser UI in `packages/app`
- local server and runtime in `packages/opencode`
- shared JS SDK in `packages/sdk/js`

The browser talks to the local server on the same machine. VM credentials and execution stay local.

## Main Components

### Web app

The main UI lives in `packages/app`.

Current product-specific areas:

- Ollama settings UI
- VM settings UI
- session timeline rendering for VM tools

The VM Manager lives in Settings, not as a separate page.

### Local server

The main runtime lives in `packages/opencode`.

Important areas:

- `src/server/routes/vm.ts`
  HTTP routes for VM list, create, get, update, delete, test, and activity
- `src/vm/index.ts`
  VM domain logic, validation, project scoping, activity records, and target confirmation
- `src/vm/ssh.ts`
  SSH transport using `ssh2`
- `src/tool/vm.ts`
  Agent-facing VM tools
- `src/agent/prompt/execute.txt`
  Remote-operations instructions for the `execute` agent

### Persistence

VM data is stored in SQLite through the OpenCode storage layer.

Tables:

- `vm`
- `vm_activity`

VMs are project-scoped. Activity is linked back to sessions when available.

### SDK

The JS SDK exposes VM APIs used by the web app:

- `client.vm.list`
- `client.vm.create`
- `client.vm.get`
- `client.vm.update`
- `client.vm.delete`
- `client.vm.test`
- `client.vm.testDraft`
- `client.vm.activity`

## VM Execution Flow

1. User adds a VM in Settings.
2. VM record is stored in the local workspace DB.
3. User starts a session with the `execute` agent.
4. Agent decides to use a `vm_*` tool.
5. The runtime resolves targets by VM id, name, hostname, or IP.
6. The user confirms the VM selection for the session.
7. The server opens an SSH connection to the VM.
8. Tool output streams into session metadata for the UI.
9. Tool result returns structured output back to the model.
10. Activity rows are persisted for audit and recent history.

## Current Design Decisions

### Ollama-only

This fork is intentionally narrowed to local Ollama models.

Implications:

- generic provider setup has been replaced by Ollama setup
- provider listing is filtered to Ollama
- model discovery is read from the local Ollama server

### Web-only

Desktop and TUI are not product targets for this fork.

Some upstream code may still exist, but the intended supported flow is the local web app only.

### SSH behavior

The SSH layer supports:

- password auth
- private key auth
- keyboard-interactive fallback for password-based servers

This matters because some Linux hosts reject plain password auth from `ssh2` but accept keyboard-interactive.

### Output handling

VM commands stream live preview into the timeline and also return structured output back to the model.

Large output is attached as a transcript artifact. Shorter output is included directly in the tool result so the model can reason on it.

### Timeouts

`vm_exec` defaults to a long timeout because package installs, repo refreshes, and service startup are slow enough that short defaults cause poor agent behavior.

## Known Practical Risks

- Some enterprise Linux hosts have unusual SSH auth policies.
- Some remote tasks require `sudo` behavior that may be interactive.
- Package installs can produce large output quickly.
- Very long-running commands may need explicit timeout tuning even with the raised default.

These are operational constraints, not reasons to broaden scope.
