# Compute Labs Codex Slack monitor

This profile watches private channels `C0828UQRLG6` (`#engineering-internal`)
and `C0BNXPB86RW` (`#eng-ax-codex`) and accepts messages only from Robert
(`U07UP7DSSA0`) and Matt (`U087PB76PB7`). Responses to messages seen in the old
engineering channel are routed to `#eng-ax-codex`; the monitor never writes
back into `#engineering-internal`. It uses Slack Socket Mode, so it does not
need a public webhook URL or periodic polling.

The listener starts one ephemeral, read-only Codex triage run only when an
allowed message arrives. The result is posted in the source message's thread.
`[SKIP]` produces no reply. The runner cannot opt itself into file writes: it
always invokes `codex exec --sandbox read-only` with untrusted-command approval,
and its prompt explicitly
prohibits GitHub, Jira/Linear, Slack, cloud, database, secret, deployment, and
traffic mutations. Interactive engineering work remains a separate workflow.

## Slack app

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
SLACK_RECEIVER_COMMAND=/absolute/path/to/zylos-slack/scripts/codex-triage.js
SLACK_RECEIVER_TIMEOUT_MS=600000
SLACK_RECEIVER_MAX_QUEUE=20
SLACK_RECEIVER_FAILURE_MENTION=U06TDSQR7BJ
SLACK_MESSAGE_LOGGING=disabled
CODEX_TRIAGE_ROOT=/Users/xingfanxia/projects/work/cl/financing-platform/cl-backend-monorepo
CODEX_TRIAGE_CONTEXT_FILE=/Users/xingfanxia/projects/work/cl/financing-platform/cl-backend-monorepo/docs/reports/architecture-audit-2026-07/PRODUCTION-CUTOVER-REPORT-2026-07-31.md
CODEX_TRIAGE_MODEL=gpt-5.6-sol
CODEX_TRIAGE_REASONING=xhigh
```

Do not add these values to a repository, Vercel, or the shared Navigator Slack
bot. This monitor needs its own app because the Navigator bot correctly has
write-only scopes.

## Runtime config

Copy `config.json` to `~/zylos/components/slack/config.json`. Run the listener
with the credential file loaded into its process environment:

```bash
set -a
source ~/creds/slack/cl-codex-monitor.env
set +a
node /absolute/path/to/zylos-slack/src/index.js
```

For a persistent deployment, use a process supervisor on an always-on internal
host and keep the same environment/config paths. Stop is fail-safe: stopping
the process or setting `enabled` to `false` ends intake immediately.

## Acceptance checklist

- `auth.test` identifies only the dedicated monitor bot.
- `conversations.history` succeeds for `C0828UQRLG6` and `C0BNXPB86RW`, and
  fails for a private channel where the bot is not a member.
- A Matt or Robert test message in `#eng-ax-codex` produces one thread reply.
- A message from `#engineering-internal` produces no reply there and one
  source-linked response in `#eng-ax-codex`.
- Multiple messages run serially; no more than 20 wait for triage.
- A receiver failure posts one thread notice tagging AX instead of failing silently.
- Replaying the same Slack event produces no second Codex run or reply.
- A message from AX or another member produces no Codex run.
- The generated Codex command contains `--ephemeral --sandbox read-only` and
  `approval_policy="untrusted"`.
- No Slack message content appears in the receiver-dedup directory.
- No Slack message body is written to local component logs.
- Removing the app from the channel or stopping the process stops monitoring.
