# Newton VM Agent Docs

This folder is the local source of truth for the forked product direction.

Read these in order:

1. `scope.md`
   Defines what this fork is trying to be, what is in v1, and what is intentionally out of scope.
2. `architecture.md`
   Explains how the current implementation is wired across the web app, local server, VM registry, SSH runtime, and agent tooling.
3. `usage.md`
   Covers how to run the app, configure Ollama, register VMs, and use the `execute` agent.

Core product rules:

- Web app only
- Local-first
- Single-user
- Ollama-only for models
- Linux VMs only
- SSH password or SSH key only
- No multi-user control plane
- No desktop app
- No TUI product work

The upstream OpenCode repo is the technical base. This fork narrows it into a lean VM operations agent.
