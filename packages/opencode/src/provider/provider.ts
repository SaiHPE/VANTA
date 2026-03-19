import z from "zod"
import path from "path"
import fuzzysort from "fuzzysort"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { type LanguageModelV2 } from "@ai-sdk/provider"
import { type Provider as SDK, NoSuchModelError } from "ai"
import { sortBy } from "remeda"
import { NamedError } from "@opencode-ai/util/error"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import { Hash } from "../util/hash"
import { Instance } from "../project/instance"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  export const Model = z
    .object({
      id: z.string(),
      providerID: z.string(),
      name: z.string(),
      api: z.object({
        id: z.string(),
        url: z.string().optional(),
        npm: z.string(),
      }),
      status: z.enum(["active", "alpha", "beta", "deprecated"]).default("active"),
      capabilities: z.object({
        temperature: z.boolean(),
        reasoning: z.boolean(),
        attachment: z.boolean(),
        toolcall: z.boolean(),
        input: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        output: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        interleaved: z.union([z.boolean(), z.object({ field: z.enum(["reasoning_content", "reasoning_details"]) })]),
      }),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()).optional(),
      limit: z.object({
        context: z.number(),
        input: z.number().optional(),
        output: z.number(),
      }),
      family: z.string().default(""),
      release_date: z.string().default(""),
      variants: z.record(z.string(), z.record(z.string(), z.any())).default({}),
    })
    .meta({
      ref: "ProviderModel",
    })
  export type Model = z.infer<typeof Model>

  export const Info = z
    .object({
      id: z.string(),
      name: z.string(),
      env: z.array(z.string()),
      npm: z.string().optional(),
      api: z.string().optional(),
      source: z.string().optional(),
      key: z.string().optional(),
      options: z.record(z.string(), z.any()).optional(),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "ProviderInfo",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()
    const disabled = new Set(cfg.disabled_providers ?? [])
    const enabled = cfg.enabled_providers ? new Set(cfg.enabled_providers) : undefined
    if (disabled.has("ollama")) {
      return {
        providers: {} as Record<string, Info>,
        sdk: new Map<string, SDK>(),
        models: new Map<string, LanguageModelV2>(),
      }
    }
    if (enabled && !enabled.has("ollama")) {
      return {
        providers: {} as Record<string, Info>,
        sdk: new Map<string, SDK>(),
        models: new Map<string, LanguageModelV2>(),
      }
    }

    const provider = await load()
    return {
      providers: provider ? { ollama: provider } : ({} as Record<string, Info>),
      sdk: new Map<string, SDK>(),
      models: new Map<string, LanguageModelV2>(),
    }
  })

  function root(input?: string) {
    const raw = input?.trim() || "http://127.0.0.1:11434"
    const prefixed = /^https?:\/\//.test(raw) ? raw : `http://${raw}`
    const parsed = new URL(prefixed)
    return `${parsed.protocol}//${parsed.host}`
  }

  export function facts(id: string) {
    const lower = id.toLowerCase()
    const vision =
      lower.includes("vision") ||
      lower.includes("llava") ||
      lower.includes("minicpm-v") ||
      lower.includes("moondream") ||
      lower.includes("bakllava") ||
      lower.includes("qwen-vl") ||
      lower.includes("qwen2.5-vl") ||
      lower.includes("qwen2-5-vl") ||
      lower.includes("qwen3-vl") ||
      lower.includes("qwen3.5") ||
      lower.includes("qwen35")
    const reasoning =
      lower.includes("reason") ||
      lower.includes("deepseek-r1") ||
      lower.includes("qwq") ||
      lower.includes("qwen3") ||
      lower.includes("kimi") ||
      lower.includes("r1")
    return {
      vision,
      reasoning,
    }
  }

  export function detect(id: string, input?: string[]) {
    if (!input) return facts(id)
    const caps = new Set(input.map((item) => item.toLowerCase()))
    return {
      ...facts(id),
      vision: caps.has("vision"),
    }
  }

  function family(id: string) {
    const [head] = id.split(":")
    return head ?? id
  }

  function merge(base: Model | undefined, item: NonNullable<Config.Provider["models"]>[string]) {
    return {
      ...base,
      ...item,
      cost: item.cost
        ? {
            input: item.cost.input ?? base?.cost.input ?? 0,
            output: item.cost.output ?? base?.cost.output ?? 0,
            cache: {
              read: item.cost.cache_read ?? base?.cost.cache.read ?? 0,
              write: item.cost.cache_write ?? base?.cost.cache.write ?? 0,
            },
            experimentalOver200K: base?.cost.experimentalOver200K,
          }
        : base?.cost,
      limit: item.limit
        ? {
            context: item.limit.context ?? base?.limit.context ?? 131_072,
            input: item.limit.input ?? base?.limit.input,
            output: item.limit.output ?? base?.limit.output ?? 8_192,
          }
        : base?.limit,
    }
  }

  function model(id: string, baseURL: string, existing?: Partial<Model>, found?: ReturnType<typeof detect>) {
    const cap = found ?? facts(id)
    return Model.parse({
      id,
      providerID: "ollama",
      name: existing?.name ?? id,
      api: {
        id,
        url: `${baseURL}/v1`,
        npm: "@ai-sdk/openai-compatible",
      },
      status: existing?.status ?? "active",
      capabilities: {
        temperature: existing?.capabilities?.temperature ?? true,
        reasoning: existing?.capabilities?.reasoning ?? cap.reasoning,
        attachment: existing?.capabilities?.attachment ?? cap.vision,
        toolcall: existing?.capabilities?.toolcall ?? true,
        input: {
          text: true,
          audio: false,
          image: cap.vision,
          video: false,
          pdf: false,
          ...existing?.capabilities?.input,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
          ...existing?.capabilities?.output,
        },
        interleaved: existing?.capabilities?.interleaved ?? false,
      },
      cost: existing?.cost ?? {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      options: existing?.options ?? {},
      headers: existing?.headers,
      limit: existing?.limit ?? {
        context: 131_072,
        output: 8_192,
      },
      family: existing?.family ?? family(id),
      release_date: existing?.release_date ?? "",
      variants: existing?.variants ?? {},
    })
  }

  async function show(baseURL: string, id: string) {
    return fetch(`${baseURL}/api/show`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: id,
      }),
      signal: AbortSignal.timeout(5_000),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Failed to show model ${id}: ${res.status}`))))
      .then((json) => {
        const item = json as {
          capabilities?: unknown
        }
        if (!Array.isArray(item.capabilities)) return
        const caps = item.capabilities.filter((item): item is string => typeof item === "string")
        return detect(id, caps)
      })
      .catch(() => detect(id))
  }

  async function load() {
    const cfg = await Config.get()
    const input = cfg.provider?.["ollama"]
    const baseURL = root(input?.options?.baseURL)
    const discovered = await fetch(`${baseURL}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Failed to reach Ollama: ${res.status}`))))
      .then((json) => {
        const rows = json as {
          models?: Array<{
            model?: string
            name?: string
          }>
        }
        return (rows.models ?? []).flatMap((item) => {
          const id = item.model ?? item.name
          if (!id) return []
          return [id]
        })
      })
      .catch((err) => {
        log.warn("failed to fetch ollama models", {
          error: err instanceof Error ? err.message : String(err),
        })
        return [] as string[]
      })

    const ids = Array.from(new Set([...discovered, ...Object.keys(input?.models ?? {})]))
    const caps = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await show(baseURL, id)] as const)))

    const models: Record<string, Model> = {}
    for (const id of discovered) {
      models[id] = model(id, baseURL, undefined, caps[id])
    }

    for (const [id, item] of Object.entries(input?.models ?? {})) {
      models[id] = model(id, baseURL, merge(models[id], item), caps[id])
    }

    return Info.parse({
      id: "ollama",
      name: input?.name ?? "Ollama",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      api: `${baseURL}/v1`,
      source: "config",
      options: {
        baseURL,
        includeUsage: true,
        ...(input?.options ?? {}),
      },
      models,
    })
  }

  async function sdk(model: Model) {
    const s = await state()
    const provider = s.providers[model.providerID]
    if (!provider) throw new InitError({ providerID: model.providerID })

    const options = {
      baseURL: `${root(String(provider.options?.baseURL ?? provider.api ?? "http://127.0.0.1:11434"))}/v1`,
      includeUsage: provider.options?.includeUsage !== false,
    }
    const key = Hash.fast(JSON.stringify(options))
    const existing = s.sdk.get(key)
    if (existing) return existing

    const loaded = createOpenAICompatible({
      name: provider.id,
      baseURL: options.baseURL,
      includeUsage: options.includeUsage,
    })
    s.sdk.set(key, loaded as unknown as SDK)
    return loaded as unknown as SDK
  }

  export async function list() {
    return state().then((s) => s.providers)
  }

  export async function getProvider(providerID: string) {
    return state().then((s) => s.providers[providerID])
  }

  export async function getModel(providerID: string, modelID: string) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) {
      const available = Object.keys(s.providers)
      const suggestions = fuzzysort.go(providerID, available, { limit: 3, threshold: -10_000 }).map((item) => item.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }

    const item = provider.models[modelID]
    if (item) return item

    const available = Object.keys(provider.models)
    const suggestions = fuzzysort.go(modelID, available, { limit: 3, threshold: -10_000 }).map((item) => item.target)
    throw new ModelNotFoundError({ providerID, modelID, suggestions })
  }

  export async function getLanguage(model: Model): Promise<LanguageModelV2> {
    const s = await state()
    const key = `${model.providerID}/${model.id}`
    const existing = s.models.get(key)
    if (existing) return existing

    try {
      const loaded = await sdk(model)
      const language = (loaded as ReturnType<typeof createOpenAICompatible>).languageModel(model.api.id)
      s.models.set(key, language)
      return language
    } catch (err) {
      if (err instanceof NoSuchModelError) {
        throw new ModelNotFoundError({ providerID: model.providerID, modelID: model.id }, { cause: err })
      }
      throw err
    }
  }

  export async function closest(providerID: string, query: string[]) {
    const provider = await getProvider(providerID)
    if (!provider) return
    for (const item of query) {
      const match = Object.keys(provider.models).find((id) => id.toLowerCase().includes(item.toLowerCase()))
      if (match) return { providerID, modelID: match }
    }
  }

  export async function getSmallModel(providerID: string) {
    const cfg = await Config.get()
    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model)
      return getModel(parsed.providerID, parsed.modelID)
    }

    const provider = await getProvider(providerID)
    if (!provider) return
    const [item] = sort(Object.values(provider.models))
    if (!item) return
    return getModel(providerID, item.id)
  }

  export function sort(input: Model[]) {
    return sortBy(
      input,
      [(item) => (item.name.toLowerCase().includes("latest") ? 0 : 1), "asc"],
      [(item) => item.release_date || "", "desc"],
      [(item) => item.name, "asc"],
    )
  }

  export async function defaultModel() {
    const cfg = await Config.get()
    if (cfg.model) return parseModel(cfg.model)

    const providers = await list()
    const recent = (await Filesystem.readJson<{ recent?: { providerID: string; modelID: string }[] }>(
      path.join(Global.Path.state, "model.json"),
    )
      .then((x) => (Array.isArray(x.recent) ? x.recent : []))
      .catch(() => [])) as { providerID: string; modelID: string }[]

    for (const item of recent) {
      const provider = providers[item.providerID]
      if (!provider) continue
      if (!provider.models[item.modelID]) continue
      return item
    }

    const provider = providers.ollama
    if (!provider) throw new Error("no providers found")
    const [item] = sort(Object.values(provider.models))
    if (!item) throw new Error("no models found")
    return {
      providerID: provider.id,
      modelID: item.id,
    }
  }

  export function parseModel(model: string) {
    const [providerID, ...rest] = model.split("/")
    return {
      providerID,
      modelID: rest.join("/"),
    }
  }

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: z.string(),
      modelID: z.string(),
      suggestions: z.array(z.string()).optional(),
    }),
  )

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: z.string(),
    }),
  )
}
