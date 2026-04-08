import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  streamText,
  wrapLanguageModel,
  extractReasoningMiddleware,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  type LanguageModelMiddleware,
  tool,
  jsonSchema,
} from "ai"
import type { LanguageModelV2StreamPart } from "@ai-sdk/provider"
import { mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"

export namespace LLM {
  const log = Log.create({ service: "llm" })
  export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX
  const OPEN = "<tool_call>"
  const CLOSE = "</tool_call>"

  type Kind = "text" | "reasoning"
  type Part = Extract<LanguageModelV2StreamPart, { type: "text-delta" } | { type: "reasoning-delta" }>
  type End = Extract<LanguageModelV2StreamPart, { type: "text-end" } | { type: "reasoning-end" }>
  type Item = {
    kind: Kind
    id: string
    mode: "plain" | "call"
    buf: string
    call: string
    seq: number
  }

  function edge(text: string, tag: string) {
    if (!text.length) return
    const hit = text.indexOf(tag)
    if (hit !== -1) return hit
    for (let i = text.length - 1; i >= 0; i--) {
      if (tag.startsWith(text.slice(i))) return i
    }
  }

  function parse(text: string) {
    const raw = text.trim()
    if (!raw) return
    try {
      const obj = JSON.parse(raw)
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return
      const rec = obj as Record<string, unknown>
      const name =
        typeof rec.name === "string"
          ? rec.name
          : typeof rec.tool === "string"
            ? rec.tool
            : typeof rec.toolName === "string"
              ? rec.toolName
              : undefined
      if (!name) return
      const arg = rec.arguments ?? rec.args ?? rec.input ?? {}
      const val =
        typeof arg === "string"
          ? JSON.parse(arg)
          : arg
      if (!val || typeof val !== "object" || Array.isArray(val)) return
      return {
        name,
        input: JSON.stringify(val),
      }
    } catch {
      return
    }
  }

  export function qwen(model: Pick<Provider.Model, "id">) {
    return model.id.toLowerCase().includes("qwen")
  }

  export function leaked(parts: MessageV2.Part[]) {
    const pseudo = parts.reduce((sum, part) => {
      if (part.type !== "text" && part.type !== "reasoning") return sum
      return sum + (part.text.match(/<tool_call>/g)?.length ?? 0)
    }, 0)
    if (pseudo === 0) return false
    const tools = parts.filter((part) => part.type === "tool").length
    return pseudo > tools
  }

  export function qwenMiddleware(): LanguageModelMiddleware {
    return {
      middlewareVersion: "v2",
      wrapStream: async ({ doStream }) => {
        const { stream, ...rest } = await doStream()
        const items = new Map<string, Item>()
        const key = (kind: Kind, id: string) => `${kind}:${id}`
        const get = (kind: Kind, id: string) => {
          const k = key(kind, id)
          const hit = items.get(k)
          if (hit) return hit
          const next = {
            kind,
            id,
            mode: "plain" as const,
            buf: "",
            call: "",
            seq: 0,
          }
          items.set(k, next)
          return next
        }
        const put = (
          ctl: TransformStreamDefaultController<LanguageModelV2StreamPart>,
          kind: Kind,
          id: string,
          delta: string,
          meta?: Part["providerMetadata"],
        ) => {
          if (!delta) return
          ctl.enqueue({
            type: kind === "text" ? "text-delta" : "reasoning-delta",
            id,
            delta,
            providerMetadata: meta,
          })
        }
        const call = (
          ctl: TransformStreamDefaultController<LanguageModelV2StreamPart>,
          item: Item,
          meta?: Part["providerMetadata"],
        ) => {
          const next = parse(item.call)
          if (!next) {
            put(ctl, item.kind, item.id, `${OPEN}${item.call}${CLOSE}`, meta)
            return
          }
          const id = `qwen-${item.kind}-${item.id}-${item.seq++}`
          ctl.enqueue({
            type: "tool-input-start",
            id,
            toolName: next.name,
            providerMetadata: meta,
          })
          ctl.enqueue({
            type: "tool-input-delta",
            id,
            delta: next.input,
            providerMetadata: meta,
          })
          ctl.enqueue({
            type: "tool-input-end",
            id,
            providerMetadata: meta,
          })
          ctl.enqueue({
            type: "tool-call",
            toolCallId: id,
            toolName: next.name,
            input: next.input,
            providerMetadata: meta,
          })
        }
        const run = (
          ctl: TransformStreamDefaultController<LanguageModelV2StreamPart>,
          item: Item,
          meta?: Part["providerMetadata"],
        ) => {
          while (true) {
            if (item.mode === "plain") {
              const hit = edge(item.buf, OPEN)
              if (hit === undefined) {
                put(ctl, item.kind, item.id, item.buf, meta)
                item.buf = ""
                return
              }
              put(ctl, item.kind, item.id, item.buf.slice(0, hit), meta)
              if (hit + OPEN.length > item.buf.length) {
                item.buf = item.buf.slice(hit)
                return
              }
              item.buf = item.buf.slice(hit + OPEN.length)
              item.mode = "call"
              item.call = ""
              continue
            }
            const hit = edge(item.buf, CLOSE)
            if (hit === undefined) {
              item.call += item.buf
              item.buf = ""
              return
            }
            item.call += item.buf.slice(0, hit)
            if (hit + CLOSE.length > item.buf.length) {
              item.buf = item.buf.slice(hit)
              return
            }
            item.buf = item.buf.slice(hit + CLOSE.length)
            call(ctl, item, meta)
            item.mode = "plain"
            item.call = ""
          }
        }
        const flush = (
          ctl: TransformStreamDefaultController<LanguageModelV2StreamPart>,
          item: Item,
          meta?: Part["providerMetadata"],
        ) => {
          if (item.mode === "call") {
            put(ctl, item.kind, item.id, `${OPEN}${item.call}${item.buf}`, meta)
          } else {
            put(ctl, item.kind, item.id, item.buf, meta)
          }
          item.mode = "plain"
          item.buf = ""
          item.call = ""
        }
        return {
          stream: stream.pipeThrough(
            new TransformStream({
              transform: (chunk, ctl) => {
                if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
                  const kind = chunk.type === "text-delta" ? "text" : "reasoning"
                  const item = get(kind, chunk.id)
                  item.buf += chunk.delta
                  run(ctl, item, chunk.providerMetadata)
                  return
                }
                if (chunk.type === "text-end" || chunk.type === "reasoning-end") {
                  const kind = chunk.type === "text-end" ? "text" : "reasoning"
                  const item = items.get(key(kind, chunk.id))
                  if (item) {
                    flush(ctl, item, chunk.providerMetadata)
                    items.delete(key(kind, chunk.id))
                  }
                  ctl.enqueue(chunk as End)
                  return
                }
                if (chunk.type === "finish") {
                  for (const item of items.values()) {
                    flush(ctl, item)
                  }
                  items.clear()
                }
                ctl.enqueue(chunk)
              },
            }),
          ),
          ...rest,
        }
      },
    }
  }

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    toolChoice?: "auto" | "required" | "none"
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg, provider] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
    ])

    const system = []
    system.push(
      [
        ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }
    if (system[0]) {
      system[0] = ProviderTransform.think(input.model, system[0], {
        tools: Object.keys(input.tools).length > 0 && input.toolChoice !== "none",
      })
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const maxOutputTokens = ProviderTransform.maxOutputTokens(input.model)

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    return streamText({
      onError(error) {
        l.error("stream error", {
          error,
        })
      },
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      toolChoice: input.toolChoice,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(input.model.providerID.startsWith("opencode")
          ? {
              "x-opencode-project": Instance.project.id,
              "x-opencode-session": input.sessionID,
              "x-opencode-request": input.user.id,
              "x-opencode-client": Flag.OPENCODE_CLIENT,
            }
          : {
              "User-Agent": `opencode/${Installation.VERSION}`,
            }),
        ...input.model.headers,
        ...headers,
      },
      maxRetries: input.retries ?? 0,
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
              }
              return args.params
            },
          },
          ...(qwen(input.model)
            ? [
                qwenMiddleware(),
                extractReasoningMiddleware({
                  tagName: "think",
                  startWithReasoning: true,
                }),
              ]
            : []),
        ],
      }),
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
          sessionId: input.sessionID,
        },
      },
    })
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}
