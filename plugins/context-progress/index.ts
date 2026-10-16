/** @jsxImportSource @opentui/solid */
import { createMemo, onMount } from "solid-js"
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

function buildBar(percent: number): { bar: string; clamped: number } {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((clamped / 100) * BAR_WIDTH)))
  return {
    bar: `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`,
    clamped,
  }
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
    const color =
      percent >= 90
        ? theme().text.feedback.error.base
        : percent >= 70
          ? theme().text.feedback.warning.base
          : theme().text.feedback.info.base
    return { bar: bar.bar, color, percent: bar.clamped }
  })

  return (
    <box>
      <text fg={theme().text.base} attributes={TextAttributes.BOLD}>Context</text>
      <box flexDirection="row" gap={1}>
        <text fg={progress().color}>{progress().bar}</text>
        <text fg={progress().color}> {progress().percent}%</text>
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