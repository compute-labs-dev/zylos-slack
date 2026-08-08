# zylos-slack

Slack communication channel for [Zylos](https://github.com/zylos-ai).

## Features

- **Socket Mode** (default) — no public URL needed
- **Webhook mode** — for environments with public endpoints
- DM and channel message handling
- Thread-aware replies
- File/image upload and download
- Access control (DM policy + per-channel allowlists)
- Smart mode (receive all channel messages) and mention mode
- Markdown formatting via Slack blocks
- Typing indicators
- Admin CLI for runtime configuration
- Optional shell-free external receiver for bounded agent runtimes
- Durable, content-free event deduplication for external receivers

## Setup

### 1. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App
2. Choose "From scratch", name your app, select workspace
3. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `app_mentions:read`
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `files:read`
   - `files:write`
   - `groups:history`
   - `groups:read`
   - `im:history`
   - `im:read`
   - `im:write`
   - `reactions:read`
   - `reactions:write`
   - `users:read`
4. Install the app to your workspace
5. Copy the **Bot User OAuth Token** (`xoxb-...`)

### 2. Enable Socket Mode

1. Under **Settings → Socket Mode**, enable Socket Mode
2. Generate an **App-Level Token** with `connections:write` scope (`xapp-...`)

### 3. Enable Events

1. Under **Event Subscriptions**, enable events
2. Subscribe to bot events:
   - `message.im`
   - `message.channels`
   - `message.groups`
   - `app_mention`

### 4. Configure Environment

Add to `~/zylos/.env`:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

### 5. Install Component

```bash
zylos add slack
```

## Optional external receiver

By default incoming messages go to the Zylos C4 bridge. A dedicated automation
can instead set `SLACK_RECEIVER_COMMAND` to an executable. The message is sent
as JSON on stdin; no Slack text is interpolated into a shell command. Stdout is
posted back to the original Slack thread, while an exact `[SKIP]` produces no
reply. Receiver event IDs are claimed in a mode-`0600` content-free dedup store
so Socket Mode reconnects do not repeat the automation.

```bash
SLACK_RECEIVER_COMMAND=/absolute/path/to/receiver
SLACK_RECEIVER_ARGS_JSON='[]'
SLACK_RECEIVER_TIMEOUT_MS=600000
SLACK_RECEIVER_MAX_QUEUE=20
SLACK_RECEIVER_FAILURE_MENTION=U0123456789
```

The retired Compute Labs read-only Codex profile is kept as a disabled diagnostic
reference in
[`examples/computelabs-codex-monitor`](examples/computelabs-codex-monitor/README.md).
Do not deploy it as a background listener.

## License

MIT
