import { expect, test } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test("execute agent is available as a primary native agent with question access", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("execute")
      expect(agent).toBeDefined()
      expect(agent?.mode).toBe("primary")
      expect(agent?.native).toBe(true)
      expect(PermissionNext.evaluate("question", "*", agent!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("plan_enter", "*", agent!.permission).action).toBe("allow")
    },
  })
})

test("runbook-planner is hidden and limited to planning tools", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("runbook-planner")
      expect(agent).toBeDefined()
      expect(agent?.mode).toBe("subagent")
      expect(agent?.hidden).toBe(true)
      expect(PermissionNext.evaluate("question", "*", agent!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("vm_list", "*", agent!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("vm_test", "*", agent!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("vm_exec", "*", agent!.permission).action).toBe("deny")
      expect(PermissionNext.evaluate("write", ".opencode/plans/test.md", agent!.permission).action).toBe("allow")
    },
  })
})

test("execute and runbook-planner prompts forbid guessed docs paths", async () => {
  const execute = await Bun.file(path.join(import.meta.dir, "../../src/agent/prompt/execute.txt")).text()
  const planner = await Bun.file(path.join(import.meta.dir, "../../src/agent/prompt/runbook-planner.txt")).text()
  expect(execute).toContain("Do not guess documentation URLs.")
  expect(execute).toContain("If a documentation fetch returns 404 or 410")
  expect(planner).toContain("Do not invent documentation URLs or guess sibling paths.")
  expect(planner).toContain("If a fetched documentation URL returns 404 or 410")
})
