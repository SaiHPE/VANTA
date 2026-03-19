import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Provider } from "../../provider/provider"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const OllamaModel = z.object({
  id: z.string(),
  name: z.string(),
})

function ollama(input?: string) {
  const raw = input?.trim() || "http://127.0.0.1:11434"
  const prefixed = /^https?:\/\//.test(raw) ? raw : `http://${raw}`
  const parsed = new URL(prefixed)
  return `${parsed.protocol}//${parsed.host}`
}

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/ollama/models",
      describeRoute({
        summary: "List Ollama models",
        description: "Fetch the locally available Ollama model list from a running Ollama server.",
        operationId: "provider.ollama.models",
        responses: {
          200: {
            description: "List of Ollama models",
            content: {
              "application/json": {
                schema: resolver(OllamaModel.array()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          url: z.string().optional(),
        }),
      ),
      async (c) => {
        const root = ollama(c.req.valid("query").url)
        const res = await fetch(`${root}/api/tags`, {
          signal: AbortSignal.timeout(5_000),
        })
        if (!res.ok) throw new Error(`Failed to reach Ollama at ${root}: ${res.status} ${res.statusText}`)
        const json = (await res.json()) as {
          models?: Array<{
            model?: string
            name?: string
          }>
        }
        const items = (json.models ?? [])
          .flatMap((item) => {
            const id = item.model ?? item.name
            if (!id) return []
            return [{ id, name: id }]
          })
          .sort((a, b) => a.id.localeCompare(b.id))
        return c.json(items)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get the local provider catalog for the web app.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const items = Object.values(await Provider.list()).filter((item) => item.id === "ollama")
        return c.json({
          all: items,
          default: Object.fromEntries(
            items.flatMap((item) => {
              const first = Provider.sort(Object.values(item.models))[0]
              if (!first) return []
              return [[item.id, first.id]]
            }),
          ),
          connected: items.filter((item) => Object.keys(item.models).length > 0).map((item) => item.id),
        })
      },
    ),
)
