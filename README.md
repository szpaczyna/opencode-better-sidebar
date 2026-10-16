# opencode-better-sidebar

Small, focused OpenCode sidebar plugins that make daily coding sessions faster.

If this helps your workflow, please star the repo.

<p align="center">
  <img src="assets/screenshot.png" alt="opencode-better-sidebar screenshot" width="980" />
</p>

## Requirements

OpenCode 2.0 or newer. These plugins use the V2 plugin API
(`@opencode/plugin/tui`). Version 1.x of the packages targeted OpenCode 1.x and
does not load in OpenCode 2.

## Install

```sh
opencode plugin add @streetturtle/opencode-open-in
opencode plugin add @streetturtle/opencode-context-progress
opencode plugin add @streetturtle/opencode-recap
opencode plugin add @streetturtle/opencode-session-tokens
```

or from OpenCode, press <kbd>ctrl</kbd>+<kbd>p</kbd> -> "Install Plugin" -> "@streetturtle/opencode-open-in"

Every plugin appends to the built-in `sidebar.content` slot, so sidebar content
contributed by OpenCode itself (including the MCP section) is left untouched.
Plugins that append to the same slot render in the order they are listed in the
`plugins` array of your `opencode.json`.

## Plugin Pack

- [`@streetturtle/opencode-open-in`](./plugins/open-in) - quick buttons to open the current session folder in Zed, VS Code, or Cursor.
- [`@streetturtle/opencode-context-progress`](./plugins/context-progress)` - context usage progress bar with token usage, window limit, and spend.
- [`@streetturtle/opencode-recap`](./plugins/recap) - one-click AI recap for the current session.
- [`@streetturtle/opencode-session-tokens`](./plugins/session-tokens) - collapsible session token totals with per-model breakdown.
