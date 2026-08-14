# Compute Labs Codex Slack monitor

This profile gives Compute Labs one consistent agent identity: routine Codex
project messages are posted by the dedicated `CL Codex Monitor` bot, and replies
inside those bot-owned task threads can resume read-only triage without an
additional mention. Ordinary channel conversation never reaches Codex.

The deterministic intake boundary accepts only:

- an explicit mention of the monitor bot from an allowed sender; or
- a reply from an allowed sender inside an unexpired thread registered by the
  bot sender.

`smart` mode is forbidden for this profile. Relevance is not delegated to a
model until channel, sender, and task-thread ownership have all been checked.

## Slack app boundary

Create the app from `slack-app-manifest.yaml`, install it in the Compute Labs
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
CODEX_TRIAGE_MODEL=gpt-5.6-sol
CODEX_TRIAGE_REASONING=xhigh
```

Use absolute paths for Node and both JavaScript entrypoints. A LaunchAgent does
not inherit the interactive shell's `PATH`. Keep JSON arrays single-quoted when
the launcher loads this file with `source`. Never print or persist token values.

## Bot-authored outbound messages

Interactive Codex sessions must send routine Compute Labs project coordination
through the dedicated wrapper, not through a user-authenticated Slack connector:

```bash
printf '%s\n\n%s\n' '*Review requested*' 'Please review PR #123.' | cl-codex-slack-send \
  --channel C0BNXPB86RW \
  --task AX-143
```

The command posts as the bot, then stores only `channel`, `thread_ts`, task
label, creation time, and expiry under
`~/zylos/components/slack/task-threads/`. It never stores the Slack message
body. The default thread lifetime is 30 days and the maximum is 90 days.

To reply as the bot without creating another task root:

```bash
printf '%s\n' 'Follow-up' | cl-codex-slack-send \
  --channel C0BNXPB86RW \
  --task AX-143 \
  --thread-ts 1786645179.152059
```

During the AX-to-bot transition, adopt one explicitly identified legacy task
thread before replying to it:

```bash
cl-codex-slack-adopt-thread \
  --channel C0BNXPB86RW \
  --thread-ts 1786574361.203089 \
  --task AX-143 \
  --expected-author U06TDSQR7BJ
```

This command does not search Slack. It fetches only the exact parent, verifies
that it is a human-authored root by the expected user and no more than 30 days
old, then creates a seven-day registry entry (30-day maximum). Message content
is never persisted. Do not bulk-adopt AX history.

## Runtime

Copy `config.json` to `~/zylos/components/slack/config.json`. The production
LaunchAgent starts the Socket Mode listener at login and restarts it only after
an unexpected failure. Setting `enabled` to `false` causes a clean stop.

## Acceptance checklist

- `auth.test` identifies only the dedicated monitor bot.
- A bot sender root is visible as `CL Codex Monitor` and creates one mode-`0600`
  content-free task-thread record.
- A Robert or Matt reply in that root reaches one read-only Codex triage run and
  any response is posted by the bot in the same thread.
- A Robert or Matt message in an unrelated thread or at channel top level
  produces no Codex run, reaction, or reply.
- An explicit bot mention from an allowed sender still works.
- Messages from other senders do not reach the receiver.
- Replaying the same Slack event produces no second run or reply.
- Expired, malformed, cross-channel, and path-like registry values fail closed.
- The generated Codex command contains `--ephemeral --sandbox read-only` and
  `approval_policy="untrusted"`.
- No Slack message content appears in the task-thread or receiver-dedup stores.
