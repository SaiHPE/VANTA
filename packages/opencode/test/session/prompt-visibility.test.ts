import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"

describe("session.prompt visibility", () => {
  test("treats reasoning-only assistant output as not visible", () => {
    expect(
      SessionPrompt.visible([
        {
          id: "prt_1",
          sessionID: "ses_1",
          messageID: "msg_1",
          type: "reasoning",
          text: "thinking",
          time: { start: 1, end: 2 },
        },
      ]),
    ).toBe(false)

    expect(
      SessionPrompt.visible([
        {
          id: "prt_1",
          sessionID: "ses_1",
          messageID: "msg_1",
          type: "text",
          text: "done",
          time: { start: 1, end: 2 },
        },
      ]),
    ).toBe(true)

    expect(
      SessionPrompt.visible([
        {
          id: "prt_1",
          sessionID: "ses_1",
          messageID: "msg_1",
          type: "tool",
          tool: "vm_exec",
          callID: "call_1",
          state: {
            status: "completed",
            input: { command: "echo hi" },
            output: "hi",
            metadata: {},
            title: "done",
            time: { start: 1, end: 2 },
          },
        },
      ]),
    ).toBe(true)
  })
})
