/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { SyntaxStyle, TextAttributes } from "@opentui/core"

const PROMPTS_UNTIL_STALE = 3
const RECENT_MESSAGES = 10
const GENERATE_TIMEOUT_MS = 30_000

const recapSignals = new Map<string, ReturnType<typeof createSignal<string | null>>>()
const loadingSignals = new Map<string, ReturnType<typeof createSignal<boolean>>>()
// User prompt count at the moment of the last recap, per session
const promptBaselines = new Map<string, number>()

type RecapOptions = {
  providerID?: string
  modelID?: string
}

type ModelChoice = {
  providerID: string
  id: string
}

function readConfiguredModel(options: RecapOptions | undefined): ModelChoice | undefined {
  const providerID = options?.providerID?.trim()
  const modelID = options?.modelID?.trim()

  const hasProvider = Boolean(providerID)
  const hasModel = Boolean(modelID)

  if (hasProvider !== hasModel) {
    throw new Error("Invalid recap plugin config: set both providerID and modelID, or neither")
  }

  if (!hasProvider || !hasModel) return

  return { providerID: providerID!, id: modelID! }
}

function messageText(message: any): string {
  if (typeof message?.text === "string") return message.text
  return (message?.content ?? [])
    .filter((part: any) => part?.type === "text")
    .map((part: any) => part?.text ?? "")
    .join("")
    .trim()
}

function getRecapSignal(sessionID: string) {
  if (!recapSignals.has(sessionID)) recapSignals.set(sessionID, createSignal<string | null>(null))
  return recapSignals.get(sessionID)!
}

function getLoadingSignal(sessionID: string) {
  if (!loadingSignals.has(sessionID)) loadingSignals.set(sessionID, createSignal<boolean>(false))
  return loadingSignals.get(sessionID)!
}

function buildSyntaxStyle(theme: any): SyntaxStyle {
  const syntax = theme().syntax
  return SyntaxStyle.fromStyles({
    comment:     { fg: syntax.comment },
    keyword:     { fg: syntax.keyword },
    function:    { fg: syntax.function },
    variable:    { fg: syntax.variable },
    string:      { fg: syntax.string },
    number:      { fg: syntax.number },
    type:        { fg: syntax.type },
    operator:    { fg: syntax.operator },
    punctuation: { fg: syntax.punctuation },
  })
}

function View(props: { sessionID: string; onRecap: () => void }) {
  const context = usePlugin()
  const theme = () => context.theme
  const recap = () => getRecapSignal(props.sessionID)[0]()
  const loading = () => getLoadingSignal(props.sessionID)[0]()
  const syntaxStyle = () => buildSyntaxStyle(theme)

  onMount(() => {
    void context.data.session.message.sync(props.sessionID)
  })

  const userPrompts = createMemo(
    () =>
      (context.data.session.message.list(props.sessionID) ?? []).filter(
        (message: any) => message?.type === "user",
      ).length,
  )

  // A recap goes stale once enough new prompts arrived after it was generated.
  createEffect(() => {
    if (recap() === null) return
    const baseline = promptBaselines.get(props.sessionID) ?? 0
    if (userPrompts() - baseline < PROMPTS_UNTIL_STALE) return
    const [, setRecap] = getRecapSignal(props.sessionID)
    setRecap(null)
    promptBaselines.set(props.sessionID, userPrompts())
  })

  return (
    <box>
      <text
        fg={theme().text.base}
        attributes={TextAttributes.BOLD}
        onMouseDown={() => { if (!loading()) props.onRecap() }}
      >
        {loading() ? "Generating..." : "Recap"}
      </text>
      <Show when={recap() !== null && !loading()}>
        <markdown
          content={recap()!}
          syntaxStyle={syntaxStyle()}
          fg={theme().text.muted}
        />
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "streetturtle.recap",
  setup(context) {
    const options = context.options as RecapOptions | undefined
    let configuredModel: ModelChoice | undefined
    let optionsError: string | undefined

    try {
      configuredModel = readConfiguredModel(options)
    } catch (err: any) {
      optionsError = err?.message ?? String(err)
    }

    // The client exposes only message.get, so transcripts come from the data cache.
    const cachedMessages = (sessionID: string) =>
      (context.data.session.message.list(sessionID) ?? []) as any[]

    const userPromptCount = (sessionID: string) =>
      cachedMessages(sessionID).filter((message) => message?.type === "user").length

    async function generateRecap(sessionID: string) {
      const [, setRecap] = getRecapSignal(sessionID)
      const [, setLoading] = getLoadingSignal(sessionID)
      let recapSessionID: string | undefined
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined

      setLoading(true)

      const [currentRecap] = getRecapSignal(sessionID)
      const previousRecap = currentRecap()

      try {
        if (optionsError) {
          throw new Error(optionsError)
        }

        const messages = cachedMessages(sessionID).slice(-RECENT_MESSAGES)

        const transcript = messages
          .map((message: any) => {
            const text = messageText(message)
            return text ? `${message.type}: ${text}` : null
          })
          .filter(Boolean)
          .join("\n\n")

        if (!transcript) {
          setRecap("*Nothing to summarize yet.*")
          return
        }

        const modelToUse = configuredModel ?? inferSessionModel(messages)

        const created = await context.client.session.create({})
        recapSessionID = created?.id
        if (!recapSessionID) throw new Error("Failed to create recap session")

        if (modelToUse) {
          await context.client.session.switchModel({ sessionID: recapSessionID, model: modelToUse })
        }

        const prompt = `You are a summarization assistant. Output only Markdown - no tools, no files, no questions.
Do not use Markdown tables.

Summarize this coding session in ~40 words across these sections:

**Working on:** one sentence - what is being built or explored
**Done:** max 2 bullets, <=6 words each (skip if nothing yet)
**Next:** max 1 bullet - the immediate next step (skip if none)

No intro, no outro, no extra sections. Output only the Markdown.
Never use table syntax (no pipes or table separators).
${previousRecap ? `\nPREVIOUS RECAP (context for earlier history):\n${previousRecap}\n` : ""}
RECENT TRANSCRIPT (last ${RECENT_MESSAGES} messages):
${transcript}`

        const timeoutPromise = new Promise<never>((_, reject) =>
          timeoutHandle = setTimeout(() => reject(new Error("Recap timed out")), GENERATE_TIMEOUT_MS)
        )

        // The client unwraps single-key envelopes, so the text can sit either level.
        const generated = (await Promise.race([
          context.client.session.generate({ sessionID: recapSessionID, prompt }),
          timeoutPromise,
        ])) as any

        const recapText = (generated?.text ?? generated?.data?.text)?.trim()
        setRecap(recapText || "*No summary generated.*")
        promptBaselines.set(sessionID, userPromptCount(sessionID))

      } catch (err: any) {
        setRecap(`*Error: ${err?.message ?? String(err)}*`)
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
        if (recapSessionID) {
          await context.client.session.remove({ sessionID: recapSessionID }).catch(() => {})
        }
        setLoading(false)
      }
    }

    return context.ui.slot({
      append: "sidebar.content",
      render: (slot) => (
        <View sessionID={slot.sessionID} onRecap={() => generateRecap(slot.sessionID)} />
      ),
    })
  },
})

function inferSessionModel(messages: any[]): ModelChoice | undefined {
  const lastAssistant = [...messages]
    .reverse()
    .find((message: any) => message?.type === "assistant" && message?.model?.providerID && message?.model?.id)

  const providerID = lastAssistant?.model?.providerID?.trim?.() ?? ""
  const modelID = lastAssistant?.model?.id?.trim?.() ?? ""
  if (!providerID || !modelID) return

  return { providerID, id: modelID }
}