import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import z from "zod"
import TurndownService from "turndown"
import { abortAfterAny } from "../util/abort"
import { Process } from "../util/process"
import DESCRIPTION from "./webfetch.txt"
import { Tool } from "./tool"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    const url = norm(params.url)

    await ctx.ask({
      permission: "webfetch",
      patterns: [...new Set([params.url, url])],
      always: ["*"],
      metadata: {
        url,
        format: params.format,
        timeout: params.timeout,
      },
    })

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

    const { signal, clearTimeout } = abortAfterAny(timeout, ctx.abort)

    // Build Accept header based on requested format with q parameters for fallbacks
    let acceptHeader = "*/*"
    switch (params.format) {
      case "markdown":
        acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
        break
      case "text":
        acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
        break
      case "html":
        acceptHeader = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
        break
      default:
        acceptHeader =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    }
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      Accept: acceptHeader,
      "Accept-Language": "en-US,en;q=0.9",
    }
    const response = await req({
      url,
      signal,
      headers,
      timeout,
    }).finally(clearTimeout)

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`)
    }

    // Check content length
    const contentLength = response.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    if (response.body.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    const contentType = response.headers.get("content-type") || ""
    const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
    const title = `${response.url} (${contentType})`

    // Check if response is an image
    const isImage = mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"

    if (isImage) {
      const base64Content = Buffer.from(response.body).toString("base64")
      return {
        title,
        output: "Image fetched successfully",
        metadata: {},
        attachments: [
          {
            type: "file",
            mime,
            url: `data:${mime};base64,${base64Content}`,
          },
        ],
      }
    }

    const content = new TextDecoder().decode(response.body)

    // Handle content based on requested format and actual content type
    switch (params.format) {
      case "markdown":
        if (contentType.includes("text/html")) {
          const markdown = convertHTMLToMarkdown(content)
          return {
            output: markdown,
            title,
            metadata: {},
          }
        }
        return {
          output: content,
          title,
          metadata: {},
        }

      case "text":
        if (contentType.includes("text/html")) {
          const text = await extractTextFromHTML(content)
          return {
            output: text,
            title,
            metadata: {},
          }
        }
        return {
          output: content,
          title,
          metadata: {},
        }

      case "html":
        return {
          output: content,
          title,
          metadata: {},
        }

      default:
        return {
          output: content,
          title,
          metadata: {},
        }
    }
  },
})

function norm(input: string) {
  if (!URL.canParse(input)) {
    throw new Error("URL must start with http:// or https://")
  }
  const url = new URL(input)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://")
  }
  if (url.protocol === "http:") url.protocol = "https:"
  return url.toString()
}

async function req(input: {
  url: string
  signal: AbortSignal
  headers: Record<string, string>
  timeout: number
}) {
  if (process.platform === "win32" && process.env.NODE_ENV !== "test") {
    return curl(input)
  }
  const initial = await fetch(input.url, {
    signal: input.signal,
    headers: input.headers,
  })
  const response =
    initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge"
      ? await fetch(input.url, {
          signal: input.signal,
          headers: {
            ...input.headers,
            "User-Agent": "opencode",
          },
        })
      : initial
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body: new Uint8Array(await response.arrayBuffer()),
    url: response.url || input.url,
  }
}

async function curl(input: {
  url: string
  signal: AbortSignal
  headers: Record<string, string>
  timeout: number
}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-webfetch-"))
  const body = path.join(dir, "body")
  const head = path.join(dir, "head")
  try {
    const out = await Process.run(
      [
        "curl.exe",
        "--silent",
        "--show-error",
        "--location",
        "--output",
        body,
        "--dump-header",
        head,
        "--max-time",
        String(Math.max(1, Math.ceil(input.timeout / 1000))),
        "--write-out",
        "%{json}",
        ...Object.entries(input.headers).flatMap(([key, value]) => ["--header", `${key}: ${value}`]),
        input.url,
      ],
      {
        abort: input.signal,
        timeout: input.timeout,
      },
    )
    const meta = JSON.parse(out.stdout.toString()) as {
      http_code?: number
      response_code?: number
      url_effective?: string
    }
    const info = pick(await Bun.file(head).text())
    const buf = await Bun.file(body).bytes()
    const status = meta.response_code ?? meta.http_code ?? info.status
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: info.headers,
      body: buf,
      url: meta.url_effective ?? input.url,
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

function pick(raw: string) {
  const block = raw
    .trim()
    .split(/\r?\n\r?\n/)
    .filter((item) => item.trim().startsWith("HTTP/"))
    .at(-1)
  const list = (block ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
  const headers = new Headers()
  list.slice(1).forEach((item) => {
    const at = item.indexOf(":")
    if (at < 0) return
    headers.append(item.slice(0, at).trim(), item.slice(at + 1).trim())
  })
  return {
    status: Number(list[0]?.split(/\s+/)[1] ?? 0),
    headers,
  }
}

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
