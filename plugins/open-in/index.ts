/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { platform } from "node:os"
import { spawn, spawnSync } from "node:child_process"
import { isAbsolute, resolve } from "node:path"
import { existsSync } from "node:fs"

type IDEAction = {
  label: string
  /** macOS bundle name for applications that launch through `open -a`. */
  appName?: string
  /** Executable on PATH. macOS uses it only when there is no appName; Linux/WSL always does. */
  command?: string
  /** Launch in a tmux window instead of the current terminal. */
  tmux?: boolean
}

type IDEAvailability = "unknown" | "checking" | "available" | "missing"

type Resolver = (sessionID: string) => Promise<string | undefined>

const TMUX_WINDOW_NAME = "opencode-nvim"

const IDES: IDEAction[] = [
  { label: "Zed", command: "zed" },
  { label: "VS Code", appName: "Visual Studio Code", command: "code" },
  { label: "Cursor", appName: "Cursor", command: "cursor" },
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

function cliCommand(ide: IDEAction): string | undefined {
  return platform() === "darwin" && ide.appName ? undefined : ide.command
}

function launchWithCLI(cli: string, targetPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, [targetPath], { detached: true, stdio: "ignore" })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

function isSupportedPlatform(): boolean {
  return platform() === "darwin" || platform() === "linux"
}

function checkIDEInstalled(ide: IDEAction): boolean {
  // A tmux target is only usable when this process really runs inside tmux.
  if (ide.tmux) {
    return Boolean(process.env.TMUX) && Boolean(resolveCLIPath("tmux"))
  }

  const command = cliCommand(ide)
  if (command) {
    return Boolean(resolveCLIPath(command))
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
    // Tmux targets work wherever tmux does; every other editor needs macOS or Linux/WSL.
    if (!ide.tmux && !isSupportedPlatform()) {
      getAvailabilitySignal(availabilityKey(ide))[1]("missing")
      continue
    }
    getAvailabilitySignal(availabilityKey(ide))[1](checkIDEInstalled(ide) ? "available" : "missing")
  }
}

function spawnTmux(args: string[]) {
  return spawnSync("tmux", args, {
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

/**
 * tmux 3.8 has no -A flag for new-window, so an existing editor window is
 * reused and repointed instead of being duplicated.
 */
function launchInTmux(targetPath: string) {
  const windows = spawnTmux(["list-windows", "-F", "#{window_name}"])
  const exists = (windows.stdout ?? "")
    .split("\n")
    .some((name) => name.trim() === TMUX_WINDOW_NAME)

  if (exists) {
    const escaped = targetPath.replace(/ /g, "\\ ")
    spawnTmux(["send-keys", "-t", TMUX_WINDOW_NAME, `:cd ${escaped}`, "Enter"])
    return spawnTmux(["select-window", "-t", TMUX_WINDOW_NAME])
  }

  const created = spawnTmux(["new-window", "-d", "-n", TMUX_WINDOW_NAME, "-c", targetPath, "nvim"])
  if ((created.status ?? 1) !== 0) return created

  return spawnTmux(["select-window", "-t", TMUX_WINDOW_NAME])
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
    if (!ide.tmux && !isSupportedPlatform()) {
      throw new Error("Open In supports macOS and Linux/WSL only")
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

    if (!ide.tmux && platform() !== "darwin") {
      const cli = ide.command ? resolveCLIPath(ide.command) : undefined
      if (!cli) throw new Error(`${ide.label} CLI not found on PATH`)
      await launchWithCLI(cli, targetPath)
      return
    }

    const launchResult = (() => {
      if (ide.tmux) {
        return launchInTmux(targetPath)
      }

      const command = cliCommand(ide)
      if (command) {
        const cli = resolveCLIPath(command)
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
      const detail = (launchResult.stderr ?? "").trim().split("\n")[0]
      throw new Error(`Failed to open in ${ide.label}${detail ? `: ${detail}` : ""}`)
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
