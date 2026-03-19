import { describe, expect, test } from "bun:test"
import { Provider } from "../../src/provider/provider"

describe("provider.facts", () => {
  test("marks qwen3.5 models as vision", () => {
    expect(Provider.facts("qwen3.5:35b").vision).toBe(true)
    expect(Provider.facts("qwen3.5:35b-a3b").vision).toBe(true)
  })

  test("marks qwen vl models as vision", () => {
    expect(Provider.facts("qwen3-vl:235b").vision).toBe(true)
    expect(Provider.facts("qwen2.5-vl:72b").vision).toBe(true)
  })

  test("keeps text-only qwen3 models as non-vision", () => {
    expect(Provider.facts("qwen3:8b").vision).toBe(false)
  })
})

describe("provider.detect", () => {
  test("trusts ollama capabilities when present", () => {
    expect(Provider.detect("qwen3.5:35b", ["completion"]).vision).toBe(false)
    expect(Provider.detect("qwen3:8b", ["completion", "vision"]).vision).toBe(true)
  })
})
