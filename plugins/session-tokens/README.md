# @streetturtle/opencode-session-tokens

OpenCode sidebar plugin for quick session token visibility.

<img src="https://raw.githubusercontent.com/streetturtle/opencode-better-sidebar/main/assets/session-tokens-screenshot.png" alt="Session Tokens sidebar screenshot" width="520" />

## What it shows

- Collapsed: `▶ Session Tokens <total> (<$cost>)` when cost data is available
- Expanded: `▼ Session Tokens <total> (<$cost>)` with per-model totals
- Falls back to session-level token counters when per-message breakdown is unavailable

## Cost logic

- Uses assistant message `cost` values when available
- Falls back to session-level `cost` when per-message costs are unavailable

## Counting logic

- Per-message spend uses: `input + output + reasoning + cache.write`
- Counts assistant messages with token data
- De-duplicates repeated assistant messages by message ID

## Install

Requires OpenCode 2.0 or newer.

```sh
opencode plugin add @streetturtle/opencode-session-tokens
```

Project-only: add `"@streetturtle/opencode-session-tokens"` to `plugins` in `opencode.jsonc`.
