import { expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { VM } from "../../src/vm"
import { VMListTool } from "../../src/tool/vm"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "session_test",
  messageID: "message_test",
  agent: "execute",
  abort: new AbortController().signal,
  messages: [],
  metadata() {},
  async ask() {},
}

test("vm_list treats empty targets objects as list-all", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await VM.Create({
        name: "test server",
        hostname: "test.local",
        username: "root",
        authType: "password",
        password: "secret",
      })

      const tool = await VMListTool.init()
      const result = await tool.execute({ targets: {} } as unknown as { targets?: string | string[] }, ctx)

      expect(result.title.startsWith("Listed ")).toBe(true)
      expect(result.output).toContain("test server")
    },
  })
})

test("vm_list treats empty targets arrays as list-all", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await VM.Create({
        name: "test server",
        hostname: "test.local",
        username: "root",
        authType: "password",
        password: "secret",
      })

      const tool = await VMListTool.init()
      const result = await tool.execute({ targets: [] } as unknown as { targets?: string | string[] }, ctx)

      expect(result.title.startsWith("Listed ")).toBe(true)
      expect(result.output).toContain("test server")
    },
  })
})
