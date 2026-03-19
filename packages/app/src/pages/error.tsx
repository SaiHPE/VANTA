import { TextField } from "@opencode-ai/ui/text-field"
import { Logo } from "@opencode-ai/ui/logo"
import { Button } from "@opencode-ai/ui/button"
import { Component, Show } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

export type InitError = {
  name: string
  data: Record<string, unknown>
}

type Translator = ReturnType<typeof useLanguage>["t"]
const CHAIN = "\n" + "-".repeat(40) + "\n"

function isIssue(value: unknown): value is { message: string; path: string[] } {
  if (!value || typeof value !== "object") return false
  if (!("message" in value) || !("path" in value)) return false
  const message = (value as { message: unknown }).message
  const path = (value as { path: unknown }).path
  if (typeof message !== "string") return false
  if (!Array.isArray(path)) return false
  return path.every((part) => typeof part === "string")
}

function isInitError(error: unknown): error is InitError {
  return typeof error === "object" && error !== null && "name" in error && "data" in error
}

function safe(value: unknown): string {
  const seen = new WeakSet<object>()
  const json = JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "bigint") return item.toString()
      if (typeof item === "object" && item) {
        if (seen.has(item)) return "[Circular]"
        seen.add(item)
      }
      return item
    },
    2,
  )
  return json ?? String(value)
}

function formatInit(error: InitError, t: Translator): string {
  const data = error.data
  switch (error.name) {
    case "MCPFailed": {
      const name = typeof data.name === "string" ? data.name : ""
      return t("error.chain.mcpFailed", { name })
    }
    case "APIError": {
      const message = typeof data.message === "string" ? data.message : t("error.chain.apiError")
      const lines = [message]
      if (typeof data.statusCode === "number") lines.push(t("error.chain.status", { status: data.statusCode }))
      if (typeof data.isRetryable === "boolean") lines.push(t("error.chain.retryable", { retryable: data.isRetryable }))
      if (typeof data.responseBody === "string" && data.responseBody) {
        lines.push(t("error.chain.responseBody", { body: data.responseBody }))
      }
      return lines.join("\n")
    }
    case "ProviderModelNotFoundError": {
      const providerID = typeof data.providerID === "string" ? data.providerID : "unknown"
      const modelID = typeof data.modelID === "string" ? data.modelID : "unknown"
      const suggestions = Array.isArray(data.suggestions)
        ? [t("error.chain.didYouMean", { suggestions: data.suggestions.join(", ") })]
        : []
      return [t("error.chain.modelNotFound", { provider: providerID, model: modelID }), ...suggestions, t("error.chain.checkConfig")].join("\n")
    }
    case "ProviderInitError": {
      const providerID = typeof data.providerID === "string" ? data.providerID : "unknown"
      return t("error.chain.providerInitFailed", { provider: providerID })
    }
    case "ConfigJsonError": {
      const path = typeof data.path === "string" ? data.path : safe(data.path)
      const message = typeof data.message === "string" ? data.message : ""
      if (message) return t("error.chain.configJsonInvalidWithMessage", { path, message })
      return t("error.chain.configJsonInvalid", { path })
    }
    case "ConfigDirectoryTypoError": {
      const path = typeof data.path === "string" ? data.path : safe(data.path)
      const dir = typeof data.dir === "string" ? data.dir : safe(data.dir)
      const suggestion = typeof data.suggestion === "string" ? data.suggestion : safe(data.suggestion)
      return t("error.chain.configDirectoryTypo", { dir, path, suggestion })
    }
    case "ConfigFrontmatterError": {
      const path = typeof data.path === "string" ? data.path : safe(data.path)
      const message = typeof data.message === "string" ? data.message : safe(data.message)
      return t("error.chain.configFrontmatterError", { path, message })
    }
    case "ConfigInvalidError": {
      const issues = Array.isArray(data.issues)
        ? data.issues.filter(isIssue).map((issue) => "-> " + issue.message + " " + issue.path.join("."))
        : []
      const message = typeof data.message === "string" ? data.message : ""
      const path = typeof data.path === "string" ? data.path : safe(data.path)
      const line = message
        ? t("error.chain.configInvalidWithMessage", { path, message })
        : t("error.chain.configInvalid", { path })
      return [line, ...issues].join("\n")
    }
    case "UnknownError":
      return typeof data.message === "string" ? data.message : safe(data)
    default:
      if (typeof data.message === "string") return data.message
      return safe(data)
  }
}

function formatChain(error: unknown, t: Translator, depth = 0, parent?: string): string {
  if (!error) return t("error.chain.unknown")

  if (isInitError(error)) {
    const message = formatInit(error, t)
    if (depth > 0 && parent === message) return ""
    const indent = depth > 0 ? `\n${CHAIN}${t("error.chain.causedBy")}\n` : ""
    return indent + `${error.name}\n${message}`
  }

  if (error instanceof Error) {
    const parts: string[] = []
    const line = `${error.name}${error.message ? `: ${error.message}` : ""}`
    const indent = depth > 0 ? `\n${CHAIN}${t("error.chain.causedBy")}\n` : ""
    const repeat = depth > 0 && parent === error.message
    const stack = error.stack?.trim()

    if (stack) {
      const starts = stack.startsWith(line)
      if (repeat && starts) {
        const rest = stack.split("\n").slice(1).join("\n").trim()
        if (rest) parts.push(indent + rest)
      }
      if (repeat && !starts) parts.push(indent + stack)
      if (!repeat && starts) parts.push(indent + stack)
      if (!repeat && !starts) parts.push(indent + `${line}\n${stack}`)
    }

    if (!stack && !repeat) parts.push(indent + line)

    if (error.cause) {
      const cause = formatChain(error.cause, t, depth + 1, error.message)
      if (cause) parts.push(cause)
    }

    return parts.join("\n\n")
  }

  if (typeof error === "string") {
    if (depth > 0 && parent === error) return ""
    const indent = depth > 0 ? `\n${CHAIN}${t("error.chain.causedBy")}\n` : ""
    return indent + error
  }

  const indent = depth > 0 ? `\n${CHAIN}${t("error.chain.causedBy")}\n` : ""
  return indent + safe(error)
}

function format(error: unknown, t: Translator) {
  return formatChain(error, t, 0)
}

export const ErrorPage: Component<{ error: unknown }> = (props) => {
  const platform = usePlatform()
  const language = useLanguage()

  return (
    <div class="relative flex-1 h-screen w-screen min-h-0 flex flex-col items-center justify-center bg-background-base font-sans">
      <div class="w-2/3 max-w-3xl flex flex-col items-center justify-center gap-8">
        <Logo class="w-58.5 opacity-12 shrink-0" />
        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-lg font-medium text-text-strong">{language.t("error.page.title")}</h1>
          <p class="text-sm text-text-weak">{language.t("error.page.description")}</p>
        </div>
        <TextField
          value={format(props.error, language.t)}
          readOnly
          copyable
          multiline
          class="max-h-96 w-full font-mono text-xs no-scrollbar"
          label={language.t("error.page.details.label")}
          hideLabel
        />
        <Button size="large" onClick={platform.restart}>
          {language.t("error.page.action.restart")}
        </Button>
        <Show when={platform.version}>
          {(version) => <p class="text-xs text-text-weak">{language.t("error.page.version", { version: version() })}</p>}
        </Show>
      </div>
    </div>
  )
}
