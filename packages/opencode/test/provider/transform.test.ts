import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"

function model(id: string): Provider.Model {
  return {
    id,
    providerID: "ollama",
    name: id,
    api: {
      id,
      url: "http://127.0.0.1:11434/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    status: "active",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    options: {},
    limit: {
      context: 32768,
      output: 8192,
    },
    family: "",
    release_date: "",
    variants: {},
  }
}

describe("provider.transform", () => {
  test("prefixes gemma4 ollama prompts with think token once", () => {
    expect(ProviderTransform.think({ providerID: "ollama", id: "gemma4:31b" }, "You are helpful.")).toBe(
      "<|think|>\nYou are helpful.",
    )
    expect(
      ProviderTransform.think({ providerID: "ollama", id: "gemma4:31b" }, "<|think|>\nYou are helpful."),
    ).toBe("<|think|>\nYou are helpful.")
  })

  test("does not prefix gemma4 prompts on tool-enabled turns", () => {
    expect(
      ProviderTransform.think({ providerID: "ollama", id: "gemma4:31b" }, "You are helpful.", {
        tools: true,
      }),
    ).toBe("You are helpful.")
  })

  test("does not prefix non-gemma prompts", () => {
    expect(ProviderTransform.think({ providerID: "ollama", id: "qwen3:8b" }, "You are helpful.")).toBe(
      "You are helpful.",
    )
    expect(ProviderTransform.think({ providerID: "openai", id: "gpt-5" }, "You are helpful.")).toBe(
      "You are helpful.",
    )
  })

  test("does not replay reasoning for gemma4 ollama models", () => {
    expect(ProviderTransform.replay({ providerID: "ollama", id: "gemma4:31b" })).toBe(false)
    expect(ProviderTransform.replay({ providerID: "ollama", id: "qwen3:8b" })).toBe(true)
  })

  test("uses gemma4 sampling defaults in the ollama provider path", () => {
    expect(ProviderTransform.temperature(model("gemma4:31b"))).toBe(1)
    expect(ProviderTransform.topP(model("gemma4:31b"))).toBe(0.95)
    expect(ProviderTransform.topK(model("gemma4:31b"))).toBeUndefined()
    expect(
      ProviderTransform.options({
        model: model("gemma4:31b"),
        sessionID: "ses_1",
      }),
    ).toEqual({ top_k: 64 })
    expect(ProviderTransform.smallOptions(model("gemma4:31b"))).toEqual({ top_k: 64 })
  })
})
