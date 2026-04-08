import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"
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

describe("session.system", () => {
  test("uses gemma prompt for gemma4 models", () => {
    expect(SystemPrompt.provider(model("gemma4:31b"))[0]).toContain("Act instead of narrating.")
    expect(SystemPrompt.provider(model("gemma4:31b"))[0]).toContain(
      "return only the tool call with no extra prose before or after it",
    )
  })

  test("keeps qwen prompt for non-gemma models", () => {
    expect(SystemPrompt.provider(model("qwen3:8b"))[0]).toContain("You are opencode")
  })
})
