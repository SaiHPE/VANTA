import { expect, test } from "bun:test"
import path from "path"

test("qwen and beast prompts require search over guessed docs urls", async () => {
  const qwen = await Bun.file(path.join(import.meta.dir, "../../src/session/prompt/qwen.txt")).text()
  const beast = await Bun.file(path.join(import.meta.dir, "../../src/session/prompt/beast.txt")).text()
  const gemma = await Bun.file(path.join(import.meta.dir, "../../src/session/prompt/gemma.txt")).text()
  expect(qwen).toContain("Do not invent documentation URLs or tweak path segments to guess nearby pages.")
  expect(qwen).toContain("If `webfetch` returns 404, 410")
  expect(beast).toContain("Use the websearch tool, when available, to discover official documentation pages")
  expect(beast).toContain("do not keep trying guessed sibling URLs")
  expect(gemma).toContain("Never invent documentation URLs.")
  expect(gemma).toContain("stop guessing sibling URLs")
})
