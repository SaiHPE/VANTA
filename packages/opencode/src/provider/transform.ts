import type { ModelMessage } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"
import type { Provider } from "./provider"
import { Flag } from "@/flag/flag"

function mime(mime: string) {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return
}

export namespace ProviderTransform {
  export const OUTPUT_TOKEN_MAX = Flag.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  function lower(model: Pick<Provider.Model, "id">) {
    return model.id.toLowerCase()
  }

  function sample(model: Pick<Provider.Model, "providerID" | "id">) {
    if (!gemma4(model)) return {}
    return {
      top_k: 64,
    }
  }

  function unsupported(msgs: ModelMessage[], model: Provider.Model) {
    return msgs.map((msg) => {
      if (msg.role !== "user" || !Array.isArray(msg.content)) return msg
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (part.type !== "file" && part.type !== "image") return part
          if (part.type === "image") {
            const image = part.image.toString()
            const match = image.match(/^data:([^;]+);base64,(.*)$/)
            if (match && (!match[2] || match[2].length === 0)) {
              return {
                type: "text" as const,
                text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
              }
            }
          }
          const type = part.type === "image" ? mime(part.image.toString().split(";")[0].replace("data:", "")) : mime(part.mediaType)
          if (!type) return part
          if (model.capabilities.input[type]) return part
          return {
            type: "text" as const,
            text: `ERROR: This model does not support ${type} input. Inform the user.`,
          }
        }),
      }
    })
  }

  export function message(msgs: ModelMessage[], model: Provider.Model, _options: Record<string, unknown>) {
    return unsupported(msgs, model)
  }

  export function gemma4(model: Pick<Provider.Model, "providerID" | "id">) {
    if (model.providerID !== "ollama") return false
    const id = lower(model)
    return id.includes("gemma4") || id.includes("gemma-4")
  }

  export function replay(model: Pick<Provider.Model, "providerID" | "id">) {
    return !gemma4(model)
  }

  export function think(
    model: Pick<Provider.Model, "providerID" | "id">,
    text: string,
    opts?: {
      tools?: boolean
    },
  ) {
    if (!gemma4(model)) return text
    if (opts?.tools) return text
    if (text.trimStart().startsWith("<|think|>")) return text
    return `<|think|>\n${text}`
  }

  export function temperature(model: Provider.Model) {
    if (gemma4(model)) return 1.0
    const id = lower(model)
    if (id.includes("qwen")) return 0.55
    if (id.includes("gemma")) return 0.7
    if (id.includes("llama")) return 0.7
    if (id.includes("mistral")) return 0.6
    return undefined
  }

  export function topP(model: Provider.Model) {
    if (gemma4(model)) return 0.95
    const id = lower(model)
    if (id.includes("qwen")) return 0.95
    if (id.includes("gemma")) return 0.9
    return undefined
  }

  export function topK(model: Provider.Model) {
    if (gemma4(model)) return undefined
    const id = lower(model)
    if (id.includes("gemma")) return 40
    return undefined
  }

  export function variants(model: Provider.Model) {
    if (!model.capabilities.reasoning) return {}
    return {}
  }

  export function options(input: {
    model: Provider.Model
    sessionID: string
    providerOptions?: Record<string, any>
  }) {
    return sample(input.model)
  }

  export function smallOptions(model: Provider.Model) {
    return sample(model)
  }

  export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
    if (Object.keys(options).length === 0) return {}
    return { [model.providerID]: options }
  }

  export function maxOutputTokens(model: Provider.Model) {
    return Math.min(model.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX
  }

  export function schema(_model: Provider.Model, schema: JSONSchema.BaseSchema | JSONSchema7) {
    return schema as JSONSchema7
  }
}
