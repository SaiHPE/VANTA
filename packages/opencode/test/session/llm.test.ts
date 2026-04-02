import { describe, expect, test } from "bun:test"
import { extractReasoningMiddleware, wrapLanguageModel } from "ai"
import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2StreamPart } from "@ai-sdk/provider"
import { LLM } from "../../src/session/llm"

async function read(stream: ReadableStream<LanguageModelV2StreamPart>) {
  const out: LanguageModelV2StreamPart[] = []
  const reader = stream.getReader()
  while (true) {
    const part = await reader.read()
    if (part.done) break
    out.push(part.value)
  }
  return out
}

function fake(parts: LanguageModelV2StreamPart[], modelId = "qwen3.5:35b"): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider: "test",
    modelId,
    supportedUrls: {},
    doGenerate(_opts: LanguageModelV2CallOptions) {
      return Promise.resolve({
        content: [],
        finishReason: "stop" as const,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        warnings: [],
      })
    },
    doStream(_opts: LanguageModelV2CallOptions) {
      return Promise.resolve({
        stream: new ReadableStream<LanguageModelV2StreamPart>({
          start(ctl) {
            for (const part of parts) ctl.enqueue(part)
            ctl.close()
          },
        }),
      })
    },
  }
}

describe("session.llm qwen middleware", () => {
  test("extracts think text and tagged tool calls", async () => {
    const model = wrapLanguageModel({
      model: fake([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "txt-1" },
        {
          type: "text-delta",
          id: "txt-1",
          delta:
            '<think>check the VM first</think>\n<tool_call>{"name":"vm_exec","arguments":{"command":"echo hi"}}</tool_call>',
        },
        { type: "text-end", id: "txt-1" },
        {
          type: "finish",
          finishReason: "stop",
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
        },
      ]),
      middleware: [
        LLM.qwenMiddleware(),
        extractReasoningMiddleware({
          tagName: "think",
          startWithReasoning: true,
        }),
      ],
    })

    const result = await model.doStream({
      prompt: [],
    })
    const parts = await read(result.stream)

    expect(parts.some((part) => part.type === "reasoning-delta" && part.delta.includes("check the VM first"))).toBe(
      true,
    )
    expect(
      parts.some(
        (part) =>
          part.type === "tool-call" && part.toolName === "vm_exec" && part.input === '{"command":"echo hi"}',
      ),
    ).toBe(true)
    expect(
      parts.some(
        (part) =>
          (part.type === "text-delta" || part.type === "reasoning-delta") && part.delta.includes("<tool_call>"),
      ),
    ).toBe(false)
  })

  test("detects leaked pseudo tool calls", () => {
    expect(
      LLM.leaked([
        {
          id: "part_1",
          sessionID: "ses_1",
          messageID: "msg_1",
          type: "reasoning",
          text: '<tool_call>{"name":"vm_exec","arguments":{"command":"id"}}</tool_call>',
          time: { start: 1, end: 2 },
        },
      ]),
    ).toBe(true)

    expect(
      LLM.leaked([
        {
          id: "part_1",
          sessionID: "ses_1",
          messageID: "msg_1",
          type: "reasoning",
          text: '<tool_call>{"name":"vm_exec","arguments":{"command":"id"}}</tool_call>',
          time: { start: 1, end: 2 },
        },
        {
          id: "part_2",
          sessionID: "ses_1",
          messageID: "msg_1",
          type: "tool",
          callID: "call_1",
          tool: "vm_exec",
          state: {
            status: "completed",
            input: { command: "id" },
            output: "uid=0(root)",
            metadata: {},
            title: "done",
            time: { start: 1, end: 2 },
          },
        },
      ]),
    ).toBe(false)
  })

  test("non-qwen models are not matched by the gate", async () => {
    expect(LLM.qwen({ id: "llama3.1:8b" })).toBe(false)

    const model = wrapLanguageModel({
      model: fake(
        [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "txt-1" },
          {
            type: "text-delta",
            id: "txt-1",
            delta: '<think>keep this as plain text</think><tool_call>{"name":"vm_exec","arguments":{"command":"echo hi"}}</tool_call>',
          },
          { type: "text-end", id: "txt-1" },
          {
            type: "finish",
            finishReason: "stop",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
          },
        ],
        "llama3.1:8b",
      ),
      middleware: [],
    })

    const result = await model.doStream({
      prompt: [],
    })
    const parts = await read(result.stream)
    expect(
      parts.some(
        (part) => part.type === "text-delta" && part.delta.includes("<tool_call>") && part.delta.includes("<think>"),
      ),
    ).toBe(true)
    expect(parts.some((part) => part.type === "tool-call")).toBe(false)
    expect(parts.some((part) => part.type === "reasoning-delta")).toBe(false)
  })
})
