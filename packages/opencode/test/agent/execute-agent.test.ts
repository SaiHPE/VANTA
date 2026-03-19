import { expect, test } from "bun:test"
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
