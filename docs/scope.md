# Scope

## Product

This fork turns OpenCode into a web-first VM operations agent.

The product goal is:

- register Linux VMs locally per workspace
- let the agent connect to those VMs over SSH
- troubleshoot, inspect logs, run commands, install software, upload/download files, and execute multi-step remote tasks
- keep using OpenCode primitives for models, MCP, skills, commands, sessions, and agent orchestration

The main user experience is:

- open the local web app
- configure Ollama
- add one or more VMs in Settings
- switch to the `execute` agent
- ask for remote work in normal chat

## V1 In Scope

- Web app as the only supported product surface
- First-class VM Manager in Settings
- Local VM inventory stored per workspace
- Linux VMs only
- Direct SSH connectivity from the local OpenCode server
- SSH password auth
- SSH private key auth
- VM-aware `execute` agent
- Built-in VM tools:
  - `vm_list`
  - `vm_test`
  - `vm_exec`
  - `vm_upload`
  - `vm_download`
- Live remote output in the session timeline
- Session attachments for downloaded files and large transcripts
- Reusable remote taskflows through existing `.opencode/skills/*`
- Reusable commands through existing `.opencode/commands/*.md`
- MCP integration where useful for the task
- Local Ollama models only

## Out of Scope

- Multi-user workspaces
- Shared hosted control plane
- Cloud provider auth flows
- Anthropic, OpenAI, Azure, Bedrock, and other hosted model providers
- Desktop packaging
- TUI product work
- Windows VM support
- WinRM, RDP, bastion abstraction, or cloud console access
- RBAC
- Environment grouping and deployment strategies
- Workflow builder UI
- Rollout orchestration like canary or blue/green
- Strong credential hardening or keychain integration

## Behavioral Requirements

- The agent must be aware that VMs exist in the current workspace.
- If a prompt mentions a VM name, hostname, or IP, the system should match likely targets.
- Before the first remote action in a session, the user must confirm the VM target set.
- The agent should ask follow-up questions when key task details are missing.
- The agent should stream remote progress while the task runs.
- The agent should use skills, commands, and MCP tools when those improve the outcome.

## Success Criteria

The fork is successful if a user can:

- connect the app to Ollama
- add a Linux VM
- use the `execute` agent to inspect, troubleshoot, install, or deploy on that VM
- see meaningful remote output in the conversation
- have the agent ask for missing details during execution
- combine VM tools with skills and MCP tooling

The fork is not successful if:

- VM connectivity is unreliable
- the agent cannot get usable command output from the VM
- the agent cannot finish normal remote tasks
- the agent cannot use the local tools that motivated the fork

## Product Constraints

- Local plaintext credentials in SQLite are acceptable for this fork.
- The user is responsible for network reachability, VPN, and jump-host positioning.
- The product should stay lean. New features should be rejected unless they directly improve the VM operations workflow.
