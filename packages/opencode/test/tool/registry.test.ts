import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { PackageRegistry } from "../../src/bun/registry"
import { ToolRegistry } from "../../src/tool/registry"

describe("tool.registry", () => {
  test("loads tools from .opencode/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, ".opencode")
        await fs.mkdir(root, { recursive: true })

        const dirpath = path.join(root, "tool")
        await fs.mkdir(dirpath, { recursive: true })

        await Bun.write(
          path.join(dirpath, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools from .opencode/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, ".opencode")
        await fs.mkdir(root, { recursive: true })

        const dirpath = path.join(root, "tools")
        await fs.mkdir(dirpath, { recursive: true })

        await Bun.write(
          path.join(dirpath, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools with external dependencies without crashing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, ".opencode")
        await fs.mkdir(root, { recursive: true })

        const dirpath = path.join(root, "tools")
        await fs.mkdir(dirpath, { recursive: true })

        await Bun.write(
          path.join(root, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@opencode-ai/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        )
        await fs.mkdir(path.join(root, "node_modules", "@opencode-ai", "plugin"), { recursive: true })
        await Bun.write(
          path.join(root, "node_modules", "@opencode-ai", "plugin", "package.json"),
          JSON.stringify({
            name: "@opencode-ai/plugin",
            version: "0.0.0-test",
            type: "module",
          }),
        )
        await fs.mkdir(path.join(root, "node_modules", "cowsay"), { recursive: true })
        await Bun.write(
          path.join(root, "node_modules", "cowsay", "package.json"),
          JSON.stringify({
            name: "cowsay",
            version: "1.6.0",
            type: "module",
            exports: "./index.js",
          }),
        )
        await Bun.write(
          path.join(root, "node_modules", "cowsay", "index.js"),
          [
            "export function say({ text }) {",
            "  return `moo ${text}`",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dirpath, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    const outdated = spyOn(PackageRegistry, "isOutdated").mockResolvedValue(false)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).toContain("cowsay")
        },
      })
    } finally {
      outdated.mockRestore()
    }
  }, { timeout: 60_000 })

  test("websearch is available for ollama models", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools({
          providerID: "ollama",
          modelID: "qwen3.5:35b",
        })
        expect(tools.some((tool) => tool.id === "websearch")).toBe(true)
        expect(tools.some((tool) => tool.id === "webfetch")).toBe(true)
      },
    })
  })
})
