import z from "zod"

export namespace ModelsDev {
  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string().default(""),
    attachment: z.boolean().default(false),
    reasoning: z.boolean().default(false),
    temperature: z.boolean().default(true),
    tool_call: z.boolean().default(true),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number().default(131_072),
      input: z.number().optional(),
      output: z.number().default(8_192),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).default(["text"]),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).default(["text"]),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["active", "alpha", "beta", "deprecated"]).default("active"),
    options: z.record(z.string(), z.any()).default({}),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()).default([]),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model).default({}),
  })

  export type Provider = z.infer<typeof Provider>
}
