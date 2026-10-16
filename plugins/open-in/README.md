# @streetturtle/opencode-open-in

OpenCode sidebar plugin with one-click IDE launch buttons for the current session.

<img src="https://raw.githubusercontent.com/streetturtle/opencode-better-sidebar/main/assets/open-in-screenshot.png" alt="Open In sidebar screenshot" width="520" />

## What it does

- Adds an **Open In** section to the sidebar
- Shows buttons for installed IDEs only (Zed, VS Code, Cursor)
- Opens the active session directory directly in your IDE

## Requirements

OpenCode 2.0 or newer (V2 plugin API).

## Install

```sh
opencode plugin add @streetturtle/opencode-open-in
```

## Usage

Open any session and click the IDE button in the sidebar.

## Notes

- macOS only (`open -a`)
- If a button is missing, the IDE was not detected as installed
