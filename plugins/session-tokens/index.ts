/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"

const MAX_MODEL_ROWS = 10
const INT_FORMATTER = new Intl.NumberFormat("en-US")

function safeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function readCost(source: any): { value: number; present: boolean } {
  const candidates = [source?.cost, source?.info?.cost, source?.usage?.cost, source?.metrics?.cost]

  for (const candidate of candidates) {
    const value = safeNumber(candidate)
    if (value > 0) return { value, present: true }
  }

  return { value: 0, present: false }
}

function spentTokenCount(tokens: any): number {
  const input = safeNumber(tokens?.input)
  const output = safeNumber(tokens?.output)
  const reasoning = safeNumber(tokens?.reasoning)
  const cacheWrite = safeNumber(tokens?.cache?.write)
  return input + output + reasoning + cacheWrite
}

function formatInt(value: number): string {
  return INT_FORMATTER.format(Math.max(0, Math.round(value)))
}

function formatMoney(value: number): string {
  const v = Math.max(0, value)
  if (v === 0) return "$0.00"
  if (v < 0.01) return "<$0.01"
  if (v < 1) return `$${v.toFixed(3)}`
  return `$${v.toFixed(2)}`
}

function formatModelTotals(tokens: number, cost: number, showCost: boolean): string {
  if (showCost && cost > 0) return `${formatInt(tokens)} (${formatMoney(cost)})`
  return formatInt(tokens)
}

function shortModelLabel(label: string): string {
  if (label.length <= 28) return label
  return `${label.slice(0, 25)}...`
}

function View(props: { sessionID: string }) {
  const context = usePlugin()
  const [open, setOpen] = createSignal(false)
  const theme = () => context.theme

  onMount(() => {
    void context.data.session.sync(props.sessionID)
    void context.data.session.message.sync(props.sessionID)
  })

  const messages = () => (context.data.session.message.list(props.sessionID) ?? []) as any[]
  const session = () => context.data.session.get(props.sessionID) as any

  const data = createMemo(() => {
    const tokenTotals = new Map<string, number>()
    const costTotals = new Map<string, number>()
    let breakdownTokenTotal = 0
    let breakdownCostTotal = 0
    let hasBreakdownCost = false
    const seen = new Set<string>()

    for (const message of messages()) {
      if (message?.type !== "assistant") continue

      const messageID = message?.id
      if (typeof messageID === "string") {
        if (seen.has(messageID)) continue
        seen.add(messageID)
      }

      const tokenCount = spentTokenCount(message?.tokens)
      const messageCost = readCost(message)
      if (tokenCount <= 0 && !messageCost.present) continue

      const modelID = message?.model?.id ?? "unknown"

      if (tokenCount > 0) {
        breakdownTokenTotal += tokenCount
        tokenTotals.set(modelID, (tokenTotals.get(modelID) ?? 0) + tokenCount)
      }

      if (messageCost.present) {
        hasBreakdownCost = true
        breakdownCostTotal += messageCost.value
        costTotals.set(modelID, (costTotals.get(modelID) ?? 0) + messageCost.value)
      }
    }

    const perModel = [...new Set([...tokenTotals.keys(), ...costTotals.keys()])]
      .map((model) => ({
        model,
        tokens: tokenTotals.get(model) ?? 0,
        cost: costTotals.get(model) ?? 0,
      }))
      .sort((a, b) => b.tokens - a.tokens || b.cost - a.cost)

    const sessionTokenTotal = spentTokenCount(session()?.tokens)
    const sessionCost = readCost(session())
    const totalTokens = breakdownTokenTotal > 0 ? breakdownTokenTotal : sessionTokenTotal
    const totalCost = hasBreakdownCost ? breakdownCostTotal : sessionCost.value
    const hasCost = hasBreakdownCost || sessionCost.present
    const hasPerModelCost = costTotals.size > 0

    return {
      totalTokens,
      totalCost,
      hasCost,
      hasPerModelCost,
      perModel,
    }
  })

  const show = createMemo(() => data().totalTokens > 0 || data().hasCost)
  const canExpand = createMemo(() => data().perModel.length > 0)

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => canExpand() && setOpen((x) => !x)}>
          <Show when={canExpand()}>
            <text fg={theme().text.base}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text.base}>
            <b>Session Tokens</b>
          </text>
          <text fg={theme().text.muted}>{formatInt(data().totalTokens)}</text>
          <Show when={data().hasCost}>
            <text fg={theme().text.muted}> ({formatMoney(data().totalCost)})</text>
          </Show>
        </box>

        <Show when={canExpand() && open()}>
          <For each={data().perModel.slice(0, MAX_MODEL_ROWS)}>{(row) => (
            <box flexDirection="row">
              <text fg={theme().text.muted}>{shortModelLabel(row.model)}</text>
              <box flexGrow={1} />
              <text fg={theme().text.muted}>{formatModelTotals(row.tokens, row.cost, data().hasPerModelCost)}</text>
            </box>
          )}</For>
          <Show when={data().perModel.length > MAX_MODEL_ROWS}>
            <text fg={theme().text.muted}>+{data().perModel.length - MAX_MODEL_ROWS} more</text>
          </Show>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "streetturtle.session-tokens",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: (slot) => <View sessionID={slot.sessionID} />,
    })
  },
})