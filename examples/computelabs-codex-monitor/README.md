# Compute Labs Codex Slack monitor (retired)

This profile is retained as a disabled rollback and diagnostic reference. Do
not deploy it as a background listener. Compute Labs feedback is now fetched
deliberately by an interactive Codex session while working on a relevant
development task, scoped by repository, pull request, issue, or thread. Routine
channel conversation must not start Codex or receive an automated reply.

`config.json` therefore defaults to `enabled: false`. Both historical channels
also use mention mode as defense in depth; `smart` mode is forbidden for this
profile because it treats ordinary messages from allowlisted people as agent
requests. The Slack app and read-only runner remain documented below only for
controlled diagnostics or an explicitly approved future reactivation.

## Historical Slack app boundary

Create an app from `slack-app-manifest.yaml`, install it in the Compute Labs
workspace, generate an app-level `xapp-` token with `connections:write`, and
invite the bot only to `#engineering-internal` and `#eng-ax-codex`.

The manifest intentionally omits public-channel, direct-message, file read or
write, admin, and workspace-wide scopes. `groups:history` reads only private
channels the installed bot has joined. Attachments are ignored; add
`files:read` only after a separate decision that they are needed.

## Credentials

Store credentials in `~/creds/slack/cl-codex-monitor.env` with mode `0600`:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_RECEIVER_COMMAND=/absolute/path/to/node
SLACK_RECEIVER_ARGS_JSON='["/absolute/path/to/zylos-slack/scripts/codex-triage.js"]'
SLACK_RECEIVER_TIMEOUT_MS=600000
SLACK_RECEIVER_MAX_QUEUE=20
SLACK_RECEIVER_FAILURE_MENTION=U06TDSQR7BJ
SLACK_MESSAGE_LOGGING=disabled
CODEX_TRIAGE_BIN=/absolute/path/to/node
CODEX_TRIAGE_ARGS_JSON='["/absolute/path/to/codex.js"]'
CODEX_TRIAGE_ROOT=/Users/xingfanxia/projects/work/cl/financing-platform/cl-backend-monorepo
CODEX_TRIAGE_CONTEXT_FILE=/Users/xingfanxia/projects/work/cl/SLACK-CODEX-MONITOR.md
CODEX_TRIAGE_MODEL=gpt-6-sol
CODEX_TRIAGE_REASONING=medium
```

Use absolute paths for Node and pass both JavaScript entrypoints as JSON-array
arguments. A macOS LaunchAgent does not inherit the interactive shell's `PATH`;
executing either `#!/usr/bin/env node` entrypoint directly can therefore fail
with exit code 127 even though the commands work in a terminal.
Keep the JSON arrays in single quotes because the launcher loads this file with
`source`; otherwise the shell removes the JSON string quotes before the monitor
parses the values.

For a receiver using the Azure OpenAI-compatible endpoint, set this trusted
operator option in its runtime environment:

```bash
CODEX_TRIAGE_OPENAI_BASE_URL=https://ax-useast-resource.services.ai.azure.com/openai/v1
```

The receiver passes this URL after `codex exec`, alongside its other config
options. Keep `CODEX_TRIAGE_ARGS_JSON` for launcher arguments such as the
`codex.js` path: Codex 0.155.1 can drop config overrides placed before `exec`
when it also receives config options after `exec`. The receiver ignores ambient
Codex config, so it cannot inherit the parent agent's provider URL. Its isolated
`CODEX_TRIAGE_CODEX_HOME/auth.json` must already hold the matching provider
authentication; do not put credentials in the URL or command arguments.

Do not add these values to a repository, Vercel, or the shared Navigator Slack
bot. This monitor needs its own app because the Navigator bot correctly has
write-only scopes.

## Diagnostic runtime config

Keep `config.json` disabled when copying it to
`~/zylos/components/slack/config.json`. For a controlled diagnostic only, load
the credential file into the foreground process environment:

```bash
set -a
source ~/creds/slack/cl-codex-monitor.env
set +a
node /absolute/path/to/zylos-slack/src/index.js
```

Do not install a process supervisor, LaunchAgent, timer, or persistent listener
for this profile. Setting `enabled` to `true` is an explicit temporary operator
action; keep both channels in mention mode and stop the foreground process when
the diagnostic ends.

## Retirement checklist

- The profile has `enabled: false` and every configured channel uses `mention`.
- The local LaunchAgent is unloaded and disabled.
- Ordinary Robert/Matt messages produce no Codex run and no Slack reply.
- Interactive sessions fetch only task-relevant Slack context when development
  work needs current feedback.
- No Slack message body is written to local component logs.

The default Sol/medium choice is supported by the [September 22 synthetic CLI
comparison](model-evaluation-20260922.md). This changes only the bounded receiver;
broad engineering agents retain their own configuration.
