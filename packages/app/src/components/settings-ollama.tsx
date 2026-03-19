import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

type Item = {
  id: string
  name: string
}

function root(input: string) {
  const raw = input.trim() || "http://127.0.0.1:11434"
  const prefixed = /^https?:\/\//.test(raw) ? raw : `http://${raw}`
  if (!URL.canParse(prefixed)) return
  const parsed = new URL(prefixed)
  return `${parsed.protocol}//${parsed.host}`
}

function strip(input?: unknown) {
  if (typeof input !== "string" || !input) return "http://127.0.0.1:11434"
  return input.replace(/\/v1\/?$/, "")
}

export function OllamaSetup(props: { dialog?: boolean; onSaved?: () => void }) {
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const live = createMemo(() => sync.data.provider.all.find((item) => item.id === "ollama"))
  const known = createMemo(() =>
    Object.values(live()?.models ?? {})
      .map((item) => ({ id: item.id, name: item.name }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
  const [state, setState] = createStore({
    url: strip(sync.data.config.provider?.ollama?.options?.baseURL),
    items: known(),
    loading: false,
    saving: false,
  })
  const base = createMemo(() => root(state.url))

  createEffect(
    on(
      () => strip(sync.data.config.provider?.ollama?.options?.baseURL),
      (next) => {
    if (state.loading || state.saving) return
    if (state.url === next) return
    setState("url", next)
      },
    ),
  )

  createEffect(() => {
    if (state.items.length > 0) return
    const next = known()
    if (next.length === 0) return
    setState("items", next)
  })

  const call = async () => {
    if (!base()) throw new Error("Enter a valid Ollama URL.")
    const url = new URL("/provider/ollama/models", sdk.url)
    url.searchParams.set("url", base()!)
    const res = await fetch(url)
    const text = await res.text()
    if (!res.ok) throw new Error(text || "Failed to reach Ollama")
    return JSON.parse(text) as Item[]
  }

  const probe = async () => {
    setState("loading", true)
    try {
      const items = await call()
      setState("items", items)
      showToast({
        icon: "circle-check",
        title: items.length > 0 ? "Ollama connected" : "Ollama reachable",
        description: items.length > 0 ? `Detected ${items.length} local model${items.length === 1 ? "" : "s"}.` : undefined,
      })
      return items
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Failed to reach Ollama", description: message })
      return []
    } finally {
      setState("loading", false)
    }
  }

  const save = async () => {
    setState("saving", true)
    try {
      if (!base()) throw new Error("Enter a valid Ollama URL.")
      const items = state.items.length > 0 ? state.items : await call()
      if (items.length === 0) throw new Error("No models were returned by Ollama.")
      const url = `${base()!}/v1`
      const model = sync.data.config.model?.startsWith("ollama/") ? sync.data.config.model : `ollama/${items[0]!.id}`
      const small =
        sync.data.config.small_model?.startsWith("ollama/") ? sync.data.config.small_model : `ollama/${items[0]!.id}`
      await sync.updateConfig({
        enabled_providers: ["ollama"],
        disabled_providers: [],
        model,
        small_model: small,
        provider: {
          ollama: {
            name: "Ollama",
            npm: "@ai-sdk/openai-compatible",
            api: url,
            options: {
              baseURL: url,
            },
          },
        },
      })
      setState("items", items)
      showToast({
        icon: "circle-check",
        title: "Ollama saved",
        description: "Ollama is now the only enabled model provider.",
      })
      props.onSaved?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Failed to save Ollama", description: message })
    } finally {
      setState("saving", false)
    }
  }

  const body = (
    <div class="flex flex-col gap-6 max-w-[720px]">
      <div class="flex flex-col gap-1">
        <h2 class="text-16-medium text-text-strong">Ollama</h2>
        <span class="text-13-regular text-text-weak">
          Connect to your local Ollama server. This enables only the `ollama` provider and hides the rest.
        </span>
      </div>

      <div class="bg-surface-raised-base rounded-lg p-5 flex flex-col gap-4">
        <TextField
          label="Ollama URL"
          value={state.url}
          onChange={(value) => setState("url", value)}
          placeholder="http://127.0.0.1:11434"
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
        />

        <div class="flex flex-wrap items-center gap-2">
          <Button size="small" variant="secondary" onClick={() => void probe()} disabled={state.loading}>
            {state.loading ? "Detecting..." : "Detect models"}
          </Button>
          <Button size="small" variant="secondary" onClick={() => void save()} disabled={state.saving}>
            {state.saving ? "Saving..." : "Save Ollama"}
          </Button>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
          <div class="flex flex-col gap-0.5">
            <span class="text-11-medium uppercase tracking-[0.08em] text-text-weak">Status</span>
            <span class="text-13-regular text-text-strong">{live() ? "Connected" : "Not connected"}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-11-medium uppercase tracking-[0.08em] text-text-weak">Endpoint</span>
            <span class="text-13-regular text-text-strong break-words">{base() ?? "Invalid URL"}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-11-medium uppercase tracking-[0.08em] text-text-weak">Models</span>
            <span class="text-13-regular text-text-strong">{state.items.length}</span>
          </div>
        </div>
      </div>

      <div class="bg-surface-raised-base rounded-lg p-5">
        <div class="pb-4">
          <h3 class="text-14-medium text-text-strong">Detected models</h3>
          <p class="pt-1 text-12-regular text-text-weak">
            These models are read directly from your local Ollama server.
          </p>
        </div>
        <Show
          when={state.items.length > 0}
          fallback={<div class="text-13-regular text-text-weak">No Ollama models detected yet.</div>}
        >
          <div class="flex flex-col gap-2">
            <For each={state.items}>
              {(item) => (
                <div class="rounded-md border border-border-weak-base px-3 py-3">
                  <div class="text-13-medium text-text-strong">{item.name}</div>
                  <div class="pt-1 text-12-regular text-text-weak">{item.id}</div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )

  if (props.dialog) {
    return <div class="px-2.5 pb-6">{body}</div>
  }

  return <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 pt-6 sm:px-10 sm:pb-10">{body}</div>
}

export function SettingsOllama() {
  return <OllamaSetup />
}
