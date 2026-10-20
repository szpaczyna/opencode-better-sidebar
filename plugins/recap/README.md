# @streetturtle/opencode-recap

One-click Markdown session recap in the OpenCode sidebar.

- Click **Recap** to generate a short summary
- Stays in the sidebar (does not pollute the chat thread)
- Auto-clears after 3 new prompts to keep it fresh

<img src="https://raw.githubusercontent.com/streetturtle/opencode-better-sidebar/main/assets/recap-screenshot.png" alt="Recap sidebar screenshot" width="520" />

## Install

Requires OpenCode 2.0 or newer.

```sh
opencode plugin add @streetturtle/opencode-recap
```

Project-only: add `"@streetturtle/opencode-recap"` to `plugins` in `opencode.jsonc`.

## Usage

Open a session and click **Recap** in the sidebar.

What the plugin does internally:

- Uses the most recent 10 messages as recap context
- Reuses previous recap output for continuity
- Generates the recap with a one-off text generation request (no extra session is created)

## Model selection

By default, recap uses the session's most recent assistant model.

You can override it by setting both `providerID` and `modelID` in the plugin options in `opencode.jsonc`:

```json
{
  "plugins": [
    {
      "package": "@streetturtle/opencode-recap",
      "options": {
        "providerID": "github-copilot",
        "modelID": "gemini-3-flash-preview"
      }
    }
  ]
}
```

## Troubleshooting

- `ProviderModelNotFoundError`: verify values with `opencode models`
- `Invalid recap plugin config`: set both fields or neither
- `duplicate tui plugin id`: configure recap only once
