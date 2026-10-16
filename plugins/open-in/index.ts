/** @jsxImportSource @opentui/solid */
import { createSignal, For } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { platform } from "node:os"
import { spawnSync } from "node:child_process"
import { isAbsolute, resolve } from "node:path"
import { existsSync } from "node:fs"

type IDEAction = {
  label: string
  appName: string
  command?: string
}

type IDEAvailability = "unknown" | "checking" | "available" | "missing"

type Resolver = (sessionID: string) => Promise<string | undefined>

const IDES: IDEAction[] = [
  { label: "Zed", appName: "Zed", command: "zed" },
  { label: "VS Code", appName: "Visual Studio Code" },
  { label: "Cursor", appName: "Cursor" },
]

const busyBySession = new Map<string, ReturnType<typeof createSignal<boolean>>>()
const availabilityByIDE = new Map<string, ReturnType<typeof createSignal<IDEAvailability>>>()

function getBusySignal(sessionID: string) {
  if (!busyBySession.has(sessionID)) busyBySession.set(sessionID, createSignal(false))
  return busyBySession.get(sessionID)!
}

function getAvailabilitySignal(appName: string) {
  if (!availabilityByIDE.has(appName)) {
    availabilityByIDE.set(appName, createSignal<IDEAvailability>("unknown"))
  }
  return availabilityByIDE.get(appName)!
}

function resolveZedCLIPath(): string | undefined {
  const which = spawnSync("which", ["zed"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  const fromPath = which.status === 0 ? which.stdout.trim() : ""
  const candidates = [
    fromPath,
    "/opt/homebrew/bin/zed",
    "/usr/local/bin/zed",
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(candidate))
}

function checkIDEInstalled(ide: IDEAction): boolean {
  if (ide.command === "zed") {
    return Boolean(resolveZedCLIPath())
  }

  const result = spawnSync("open", ["-Ra", ide.appName], { stdio: "ignore" })
  return result.status === 0
}

function refreshIDEAvailability() {
  if (platform() !== "darwin") {
    for (const ide of IDES) {
      const [, setAvailability] = getAvailabilitySignal(ide.appName)
      setAvailability("missing")
    }
    return
  }

  for (const ide of IDES) {
    const [, setAvailability] = getAvailabilitySignal(ide.appName)
    setAvailability("checking")
  }

  for (const ide of IDES) {
    const [, setAvailability] = getAvailabilitySignal(ide.appName)
    setAvailability(checkIDEInstalled(ide) ? "available" : "missing")
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
    if (platform() !== "darwin") {
      throw new Error("Open In currently supports macOS only")
    }

    const [availability, setAvailability] = getAvailabilitySignal(ide.appName)
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

    const launchResult = ide.command === "zed"
      ? (() => {
          const zed = resolveZedCLIPath()
          if (!zed) throw new Error("Zed CLI not found")
          return spawnSync(zed, [targetPath], { stdio: "ignore" })
        })()
      : spawnSync("open", ["-a", ide.appName, targetPath], { stdio: "ignore" })

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
      [{props.ide.label}]
    </text>
  )
}

function View(props: { sessionID: string; resolveTarget: Resolver; notify: (message: string) => void }) {
  const context = usePlugin()
  const installedIDEs = () => IDES.filter((ide) => getAvailabilitySignal(ide.appName)[0]() === "available")
  const theme = () => context.theme

  return (
    <box>
      <text fg={theme().text.base} attributes={TextAttributes.BOLD}>Open In</text>
      <box flexDirection="row" gap={1}>
        <For each={installedIDEs()}>{(ide) => (
          <IDEButton
            sessionID={props.sessionID}
            ide={ide}
            resolveTarget={props.resolveTarget}
            notify={props.notify}
          />
        )}</For>
      </box>
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