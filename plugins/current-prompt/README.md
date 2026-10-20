# @streetturtle/opencode-current-prompt

OpenCode sidebar plugin that keeps the latest user prompt visible, so you don't have to scroll back through agent output during long-running tasks.

## What it shows

- `Current Prompt` with the text of the most recent user message in the session
- Prompts longer than 280 characters are truncated; click the header (`▶` / `▼`) to expand or collapse the full text
- Hidden until the session has a user prompt

## Install

Requires OpenCode 2.0 or newer.

```sh
opencode plugin add @streetturtle/opencode-current-prompt
```

Project-only: add `"@streetturtle/opencode-current-prompt"` to `plugins` in `opencode.jsonc`.
