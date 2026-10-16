/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { platform } from "node:os"
import { spawnSync } from "node:child_process"
import { isAbsolute, resolve } from "node:path"
import { existsSync } from "node:fs"

type IDEAction = {
  label: string
  /** macOS bundle name for applications that launch through `open -a`. */
  appName?: string
  /** Executable on PATH for terminal applications. */
  command?: string
  /** Launch in a tmux window instead of the current terminal. */
  tmux?: boolean
}

type IDEAvailability = "unknown" | "checking" | "available" | "missing"

type Resolver = (sessionID: string) => Promise<string | undefined>

const TMUX_WINDOW_NAME = "opencode-nvim"

const IDES: IDEAction[] = [
  { label: "Zed", appName: "Zed", command: "zed" },
  { label: "VS Code", appName: "Visual Studio Code" },
  { label: "Cursor", appName: "Cursor" },
  { label: "Neovim", command: "nvim", tmux: true },
]

const busyBySession = new Map<string, ReturnType<typeof createSignal<boolean>>>()
const availabilityByIDE = new Map<string, ReturnType<typeof createSignal<IDEAvailability>>>()

function getBusySignal(sessionID: string) {
  if (!busyBySession.has(sessionID)) busyBySession.set(sessionID, createSignal(false))
  return busyBySession.get(sessionID)!
}

function getAvailabilitySignal(key: string) {
  if (!availabilityByIDE.has(key)) {
    availabilityByIDE.set(key, createSignal<IDEAvailability>("unknown"))
  }
  return availabilityByIDE.get(key)!
}

function resolveCLIPath(command: string): string | undefined {
  const which = spawnSync("which", [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  const fromPath = which.status === 0 ? which.stdout.trim() : ""
  const candidates = [
    fromPath,
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(candidate))
}

function checkIDEInstalled(ide: IDEAction): boolean {
  // A tmux target is only usable when this process really runs inside tmux.
  if (ide.tmux) {
    return Boolean(process.env.TMUX) && Boolean(resolveCLIPath("tmux"))
  }

  if (ide.command) {
    return Boolean(resolveCLIPath(ide.command))
  }

  if (!ide.appName) return false

  const result = spawnSync("open", ["-Ra", ide.appName], { stdio: "ignore" })
  return result.status === 0
}

function availabilityKey(ide: IDEAction): string {
  return ide.label
}

function refreshIDEAvailability() {
  for (const ide of IDES) {
    const [, setAvailability] = getAvailabilitySignal(availabilityKey(ide))
    setAvailability("checking")
  }

  for (const ide of IDES) {
    // `open -a` is macOS-only, so GUI editors stay hidden elsewhere while tmux
    // targets keep working.
    if (platform() !== "darwin" && !ide.command) {
      getAvailabilitySignal(availabilityKey(ide))[1]("missing")
      continue
    }
    getAvailabilitySignal(availabilityKey(ide))[1](checkIDEInstalled(ide) ? "available" : "missing")
  }
}

async function openInIDE(
  sessionID: string,
  ide: IDEAction,
  resolveTarget: Resolver,
  notify: (message: string) => void,
) {
  const [busy, setBusy] = getBusySignal(sessionID)
  if (busy()) return

  setBusy(true)

  try {
    if (platform() !== "darwin" && !ide.command) {
      throw new Error("Open In currently supports macOS only")
    }

    const [availability, setAvailability] = getAvailabilitySignal(availabilityKey(ide))
    if (availability() !== "available") {
      const installed = checkIDEInstalled(ide)
      setAvailability(installed ? "available" : "missing")
      if (!installed) {
        return
      }
    }

    const targetPath = await resolveTarget(sessionID)
    if (!targetPath) {
      throw new Error("Could not resolve session directory")
    }

    const launchResult = (() => {
      if (ide.tmux) {
        // -A reuses the window when it is already open, so repeated clicks do
        // not stack editors.
        return spawnSync(
          "tmux",
          ["new-window", "-A", "-n", TMUX_WINDOW_NAME, "-c", targetPath, "nvim"],
          { stdio: "ignore" },
        )
      }

      if (ide.command) {
        const cli = resolveCLIPath(ide.command)
        if (!cli) throw new Error(`${ide.label} executable not found`)
        return spawnSync(cli, [targetPath], { stdio: "ignore" })
      }

      if (!ide.appName) throw new Error("No launcher configured")
      return spawnSync("open", ["-a", ide.appName, targetPath], { stdio: "ignore" })
    })()

    if (launchResult.error) {
      throw launchResult.error
    }
    if ((launchResult.status ?? 1) !== 0) {
      throw new Error(`Failed to open in ${ide.label}`)
    }
  } catch (err: any) {
    notify(err?.message ?? String(err))
  } finally {
    setBusy(false)
  }
}

function IDEButton(props: {
  sessionID: string
  ide: IDEAction
  resolveTarget: Resolver
  notify: (message: string) => void
}) {
  const context = usePlugin()
  const [busy] = getBusySignal(props.sessionID)
  const theme = () => context.theme
  const disabled = () => busy()

  return (
    <text
      fg={disabled() ? theme().text.muted : theme().text.base}
      attributes={TextAttributes.BOLD}
      onMouseDown={() => {
        if (!disabled()) {
          void openInIDE(props.sessionID, props.ide, props.resolveTarget, props.notify)
        }
      }}
    >
      {props.ide.label}
    </text>
  )
}

function View(props: { sessionID: string; resolveTarget: Resolver; notify: (message: string) => void }) {
  const context = usePlugin()
  const installedIDEs = () => IDES.filter((ide) => getAvailabilitySignal(availabilityKey(ide))[0]() === "available")
  const theme = () => context.theme

  return (
    <box flexDirection="row" gap={1}>
      <Show
        when={installedIDEs().length > 0}
        fallback={<text fg={theme().text.muted}>Open in: no IDE detected</text>}
      >
        <text fg={theme().text.base} attributes={TextAttributes.BOLD}>Open in</text>
        <For each={installedIDEs()}>{(ide, index) => (
          <box flexDirection="row">
            <Show when={index() > 0}>
              <text fg={theme().text.muted}> · </text>
            </Show>
            <IDEButton
              sessionID={props.sessionID}
              ide={ide}
              resolveTarget={props.resolveTarget}
              notify={props.notify}
            />
          </box>
        )}</For>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "streetturtle.open-in",
  setup(context) {
    const resolveTarget: Resolver = async (sessionID) => {
      // session.get resolves to the session itself, not an envelope.
      const session = await context.client.session.get({ sessionID })
      const directory = session?.location?.directory?.trim()
      const subpath = session?.subpath?.trim()
      if (directory) return subpath ? resolve(directory, subpath) : directory
      return subpath && isAbsolute(subpath) ? subpath : undefined
    }

    refreshIDEAvailability()

    const notify = (message: string) => {
      void context.ui.toast.show({ variant: "error", message: `Open In: ${message}` })
    }

    return context.ui.slot({
      append: "sidebar.content",
      render: (slot) => (
        <View sessionID={slot.sessionID} resolveTarget={resolveTarget} notify={notify} />
      ),
    })
  },
})