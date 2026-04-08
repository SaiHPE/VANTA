import { describe, expect, test } from "bun:test"
import { SessionDoom } from "../../src/session/doom"
import type { MessageV2 } from "../../src/session/message-v2"

function tool(input: {
  tool: string
  input: Record<string, unknown>
  metadata?: Record<string, unknown>
}) {
  return {
    id: `part_${Math.random().toString(36).slice(2)}`,
    sessionID: "ses_test",
    messageID: "msg_test",
    type: "tool",
    callID: `call_${Math.random().toString(36).slice(2)}`,
    tool: input.tool,
    state: {
      status: "completed",
      input: input.input,
      output: "",
      title: "",
      metadata: input.metadata ?? {},
      time: {
        start: 1,
        end: 2,
      },
    },
  } satisfies MessageV2.ToolPart
}

describe("session.doom", () => {
  test("trips on the same tool input repeated three times", () => {
    const parts = [
      tool({
        tool: "read",
        input: {
          filePath: "README.md",
        },
      }),
      tool({
        tool: "read",
        input: {
          filePath: "README.md",
        },
      }),
      tool({
        tool: "read",
        input: {
          filePath: "README.md",
        },
      }),
    ]
    expect(
      SessionDoom.trip(parts, "read", {
        filePath: "README.md",
      }),
    ).toEqual({
      mode: "exact",
      tool: "read",
      input: {
        filePath: "README.md",
      },
    })
  })

  test("trips on repeated failed vm strategies in the same category", () => {
    const parts = [
      tool({
        tool: "vm_exec",
        input: {
          targets: "test server",
          command: "dnf install -y gcc",
        },
        metadata: {
          plan_category: "package_manager",
          target: "test server",
          failure_class: "pkgmgr_python_missing",
          retryable: false,
        },
      }),
      tool({
        tool: "vm_exec",
        input: {
          targets: "test server",
          command: "yum install -y gcc",
        },
        metadata: {
          plan_category: "package_manager",
          target: "test server",
          failure_class: "artifact_mismatch",
          retryable: false,
        },
      }),
    ]
    expect(
      SessionDoom.trip(parts, "vm_exec", {
        targets: "test server",
        command: "dnf install -y make",
      }),
    ).toEqual({
      mode: "semantic",
      tool: "vm_exec",
      input: {
        targets: "test server",
        command: "dnf install -y make",
      },
      category: "package_manager",
      target: "test server",
      failures: ["pkgmgr_python_missing", "artifact_mismatch"],
    })
  })

  test("does not trip semantic doom on retryable blockers", () => {
    const parts = [
      tool({
        tool: "vm_exec",
        input: {
          targets: "test server",
          command: "git clone repo",
        },
        metadata: {
          plan_category: "git",
          target: "test server",
          failure_class: "network_dns",
          retryable: true,
        },
      }),
      tool({
        tool: "vm_exec",
        input: {
          targets: "test server",
          command: "git fetch",
        },
        metadata: {
          plan_category: "git",
          target: "test server",
          failure_class: "network_dns",
          retryable: true,
        },
      }),
    ]
    expect(
      SessionDoom.trip(parts, "vm_exec", {
        targets: "test server",
        command: "git pull",
      }),
    ).toBeUndefined()
  })
})
