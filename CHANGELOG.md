# Changelog

## Unreleased

## 0.1.4 (2026-08-26)

- Add the hourglass reaction immediately after access and empty-message checks,
  before user lookup, attachment download, or thread-context requests, so slow
  optional Slack I/O cannot make the agent appear offline.
- Keep the thread parent and authoritative thread-only response contract from
  0.1.3 available to every deployed Compute Labs Slack agent.

- Retire the Compute Labs background Codex monitor profile. It now defaults to
  disabled and mention-only so ordinary channel conversation cannot launch a
  triage run or receive an automated reply.
- Preserve the exact finding identity for Slack thread replies by reading the
  parent message's top-level text, attachment fallback, or Block Kit text.
- Make thread context authoritative for read-only triage so a reply cannot
  borrow an unrelated foreground task when the user's message is brief.
- Make ephemeral triage tool-free and ignore ambient Codex config/rules. Also
  remove Slack, GitHub, Jira, and provider credentials from its environment;
  it uses isolated HOME/CODEX_HOME directories that expose only its Codex auth.

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
