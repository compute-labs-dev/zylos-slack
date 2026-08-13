# Changelog

## Unreleased

- Add task-thread mode: explicit bot mentions and replies inside unexpired,
  bot-registered task threads may reach the receiver; unrelated channel
  messages fail closed before any model call.
- Add a dedicated Compute Labs bot sender that records content-free task thread
  ownership with bounded expiry. This aligns outbound identity with the inbound
  trigger instead of posting routine Codex messages as AX.
- Reactivate the Compute Labs Socket Mode profile in task-thread mode. The
  former all-message `smart` mode remains forbidden for this deployment.

## 0.1.2 (2026-05-28)

- Fix: tagged @mentions were silently dropped after a Socket Mode reconnect. The `message` handler now detects mentions itself (app_mention event delivery is unreliable across reconnects) instead of deferring to `app_mention`; both paths share a `mention-<channel>-<ts>` dedup key for exactly-once handling.
- Fix: file uploads (`subtype: file_share`) were dropped by the subtype guard — they now pass through, and attachments are wrapped in an `<attachments>` block instructing the agent to Read each local path.
- Add: explicit response directive — a direct @mention is mandatory to answer; a smart-mode non-mention is optional (reply `[SKIP]` if not relevant).
- Add: tolerate Slack's piped `<@U123|name>` mention form; ignore `app_mention` thread-reply re-fires that carry no new mention.

## 0.1.1 (2026-03-20)

- Remove SLACK_SIGNING_SECRET (not needed for Socket Mode connection)

## 0.1.0 (2026-03-04)

- Initial release
- Socket Mode and webhook connection support
- DM and channel message receiving via Slack Events API
- Message sending via Slack Web API (text, markdown, files)
- DM access control (owner/allowlist/open)
- Channel access control (disabled/allowlist/open) with per-channel config
- Smart and mention modes for channels
- Typing indicator (hourglass reaction)
- Thread support (context and replies)
- Media download and upload (images, files)
- Admin CLI for configuration management
- Hot-reload config via file watcher
- Message deduplication (5-min TTL)
- Chat history context for channels
- Message logging per channel
