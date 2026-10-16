/** @jsxImportSource @opentui/solid */
import { createMemo, For, onMount } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"

const BAR_WIDTH = 24

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)))
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function messageTokens(tokens: any): {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
} {
  const input = safeNumber(tokens?.input)
  const output = safeNumber(tokens?.output)
  const reasoning = safeNumber(tokens?.reasoning)
  const cacheRead = safeNumber(tokens?.cache?.read)
  const cacheWrite = safeNumber(tokens?.cache?.write)
  return { input, output, reasoning, cacheRead, cacheWrite, total: input + output + reasoning + cacheRead + cacheWrite }
}

function buildBar(percent: number): { cells: { char: string; color?: string }[]; clamped: number } {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((clamped / 100) * BAR_WIDTH)))
  return {
    cells: [
      ...Array.from({ length: filled }, () => ({ char: "█" })),
      ...Array.from({ length: BAR_WIDTH - filled }, () => ({ char: "░" })),
    ],
    clamped,
  }
}

// Theme tokens are RGBA objects, not hex strings, so the gradient is computed
// on their bytes and handed to the renderer as hex.
type RGB = [number, number, number]

function toRgb(color: unknown): RGB | undefined {
  const buffer = (color as any)?.buffer
  if (!buffer || buffer.length < 3) return undefined
  return [Number(buffer[0]), Number(buffer[1]), Number(buffer[2])]
}

function toHex(rgb: RGB): string {
  return `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`
}

function lighten(rgb: RGB, amount: number): RGB {
  return [rgb[0] + (255 - rgb[0]) * amount, rgb[1] + (255 - rgb[1]) * amount, rgb[2] + (255 - rgb[2]) * amount]
}

function darken(rgb: RGB, amount: number): RGB {
  return [rgb[0] * (1 - amount), rgb[1] * (1 - amount), rgb[2] * (1 - amount)]
}

/** Neovim insert-mode style vertical fade over the filled part of the bar. */
function gradient(base: unknown, filled: number): string[] {
  const rgb = toRgb(base)
  if (!rgb || filled <= 0) return []

  const top = lighten(rgb, 0.45)
  const bottom = darken(rgb, 0.35)
  return Array.from({ length: filled }, (_, index) => {
    const t = filled === 1 ? 0.5 : index / (filled - 1)
    return toHex([top[0] + (bottom[0] - top[0]) * t, top[1] + (bottom[1] - top[1]) * t, top[2] + (bottom[2] - top[2]) * t])
  })
}

function View(props: { sessionID: string }) {
  const context = usePlugin()
  const location = () => context.location ?? context.data.location.default()

  onMount(() => {
    void context.data.session.sync(props.sessionID)
    void context.data.session.message.sync(props.sessionID)
    void context.data.location.model.sync(location())
  })

  const messages = () => (context.data.session.message.list(props.sessionID) ?? []) as any[]
  const models = () => (context.data.location.model.list(location()) ?? []) as any[]

  const lastAssistant = createMemo(() =>
    messages()
      .filter((message) => message?.type === "assistant" && safeNumber(message?.tokens?.output) > 0)
      .at(-1),
  )

  const usage = createMemo(() => {
    const assistant = lastAssistant()
    if (!assistant) return { tokens: 0, contextWindow: 0, percent: 0 }

    const tokens = messageTokens(assistant.tokens).total
    const providerID = assistant.model?.providerID
    const modelID = assistant.model?.id
    const model = models().find((item) => item?.providerID === providerID && item?.id === modelID)
    const contextWindow = safeNumber(model?.limit?.context)
    const percent = contextWindow > 0 ? Math.round((tokens / contextWindow) * 100) : 0

    return { tokens, contextWindow, percent }
  })

  const sessionCost = createMemo(() => {
    const cost = safeNumber(context.data.session.cost(props.sessionID))
    if (cost > 0) return cost

    return messages()
      .filter((message) => message?.type === "assistant")
      .reduce((sum, message) => sum + safeNumber(message?.cost), 0)
  })

  const detailLine = createMemo(() => {
    const state = usage()
    const limitText = state.contextWindow > 0 ? formatInt(state.contextWindow) : "--"
    return `${formatInt(state.tokens)} / ${limitText} / ${formatMoney(sessionCost())}`
  })

  const theme = () => context.theme

  const progress = createMemo(() => {
    const percent = usage().percent
    const bar = buildBar(percent)
    const base =
      percent >= 90
        ? theme().text.feedback.error.base
        : percent >= 70
          ? theme().text.feedback.warning.base
          : theme().text.feedback.info.base

    const colors = gradient(base, Math.min(BAR_WIDTH, Math.round((bar.clamped / 100) * BAR_WIDTH)))
    const cells = bar.cells.map((cell, index) => ({
      char: cell.char,
      color: cell.char === "█" ? colors[index] : undefined,
    }))

    // The percentage follows the bottom of the gradient so the row stays cohesive.
    const labelColor = colors.at(-1) ?? theme().text.base
    return { cells, labelColor, percent: bar.clamped }
  })

  return (
    <box>
      <text fg={theme().text.base} attributes={TextAttributes.BOLD}>Context</text>
      <box flexDirection="row" gap={1}>
        <box flexDirection="row">
          <For each={progress().cells}>{(cell) => (
            <text fg={cell.color ?? theme().text.muted}>{cell.char}</text>
          )}</For>
        </box>
        <text fg={progress().labelColor}> {progress().percent}%</text>
      </box>
      <text fg={theme().text.muted}>{detailLine()}</text>
    </box>
  )
}

export default Plugin.define({
  id: "streetturtle.context-progress",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: (slot) => <View sessionID={slot.sessionID} />,
    })
  },
})