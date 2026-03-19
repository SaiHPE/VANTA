# Usage

## Run the app

From the repo root:

```powershell
bun --use-system-ca install
bun --use-system-ca run --cwd packages/app build
bun --use-system-ca run --cwd packages/opencode src/index.ts web
```

Or use the launcher:

```powershell
.\Start-Web.cmd
```

If the browser shows stale behavior after a change:

- close the server window
- relaunch the app
- press `Ctrl+F5`

## Configure Ollama

In the web app:

1. Open `Settings`
2. Open `Ollama`
3. Set the URL, usually `http://127.0.0.1:11434`
4. Click `Detect models`
5. Click `Save Ollama`

This fork is intentionally Ollama-only.

## Add a VM

In `Settings -> VMs`:

1. Click `New VM` if needed
2. Fill in:
   - VM name
   - hostname and/or IP
   - port
   - username
   - auth type
   - password or private key
3. Click `Test connection`
4. Click `Create VM` or `Save changes`

## Use the execute agent

Start a session and choose the `execute` agent.

Example prompts:

- `Connect to test server and inspect why nginx is failing. Stream the logs and ask me if you need more context.`
- `Install Jenkins on test server. Use a long timeout for package operations and show me the verification output.`
- `Fetch the last 200 lines from the application logs on test server and summarize the failure.`

Expected behavior:

- the system resolves likely VM matches from the prompt
- it asks you to confirm targets before the first remote action
- it runs remote tools over SSH
- it streams live output into the session
- it stores transcripts and downloads as session artifacts

## Workspace files

Reusable instructions belong in the workspace:

- `.opencode/skills/*`
- `.opencode/commands/*.md`

The `execute` agent can use these while working on VMs.

## Troubleshooting

### Ollama issues

- confirm Ollama is running
- confirm the URL is correct
- use `Detect models` before saving

### VM auth issues

- test from `Settings -> VMs`
- verify hostname, IP, username, port, and auth method
- if password auth works in a normal SSH client but fails here, retry after restarting the app because the SSH layer includes keyboard-interactive fallback

### Stale UI

- restart the local server
- hard refresh the browser with `Ctrl+F5`

### Long installs

- the agent should now use longer timeouts by default
- for especially slow tasks, ask it to use a higher timeout explicitly
