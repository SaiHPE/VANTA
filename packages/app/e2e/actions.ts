import { expect, type Locator, type Page } from "@playwright/test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import { modKey, serverUrl } from "./utils"
import {
  titlebarRightSelector,
  popoverBodySelector,
  listItemSelector,
  listItemKeySelector,
  listItemKeyStartsWithSelector,
} from "./selectors"
import type { createSdk } from "./utils"

export async function defocus(page: Page) {
  await page
    .evaluate(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    })
    .catch(() => undefined)
}

export async function openPalette(page: Page) {
  await defocus(page)
  await page.keyboard.press(`${modKey}+P`)

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()
  return dialog
}

export async function closeDialog(page: Page, dialog: Locator) {
  await page.keyboard.press("Escape")
  const closed = await dialog
    .waitFor({ state: "detached", timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (closed) return

  await page.keyboard.press("Escape")
  const closedSecond = await dialog
    .waitFor({ state: "detached", timeout: 1500 })
    .then(() => true)
    .catch(() => false)

  if (closedSecond) return

  await page.locator('[data-component="dialog-overlay"]').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toHaveCount(0)
}

export async function openSettings(page: Page) {
  await defocus(page)

  const dialog = page.getByRole("dialog")
  await page.keyboard.press(`${modKey}+Comma`).catch(() => undefined)

  const opened = await dialog
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false)

  if (opened) return dialog

  await page.getByRole("button", { name: "Settings" }).first().click()
  await expect(dialog).toBeVisible()
  return dialog
}

export async function seedProjects(page: Page, input: { directory: string; extra?: string[] }) {
  await page.addInitScript(
    (args: { directory: string; serverUrl: string; extra: string[] }) => {
      const key = "opencode.global.dat:server"
      const raw = localStorage.getItem(key)
      const parsed = (() => {
        if (!raw) return undefined
        try {
          return JSON.parse(raw) as unknown
        } catch {
          return undefined
        }
      })()

      const store = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
      const list = Array.isArray(store.list) ? store.list : []
      const lastProject = store.lastProject && typeof store.lastProject === "object" ? store.lastProject : {}
      const projects = store.projects && typeof store.projects === "object" ? store.projects : {}
      const nextProjects = { ...(projects as Record<string, unknown>) }

      const add = (origin: string, directory: string) => {
        const current = nextProjects[origin]
        const items = Array.isArray(current) ? current : []
        const existing = items.filter(
          (p): p is { worktree: string; expanded?: boolean } =>
            !!p &&
            typeof p === "object" &&
            "worktree" in p &&
            typeof (p as { worktree?: unknown }).worktree === "string",
        )

        if (existing.some((p) => p.worktree === directory)) return
        nextProjects[origin] = [{ worktree: directory, expanded: true }, ...existing]
      }

      const directories = [args.directory, ...args.extra]
      for (const directory of directories) {
        add("local", directory)
        add(args.serverUrl, directory)
      }

      localStorage.setItem(
        key,
        JSON.stringify({
          list,
          projects: nextProjects,
          lastProject,
        }),
      )
    },
    { directory: input.directory, serverUrl, extra: input.extra ?? [] },
  )
}

export async function createTestProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-project-"))

  await fs.writeFile(path.join(root, "README.md"), "# e2e\n")

  execSync("git init", { cwd: root, stdio: "ignore" })
  execSync("git config core.fsmonitor false", { cwd: root, stdio: "ignore" })
  execSync("git add -A", { cwd: root, stdio: "ignore" })
  execSync('git -c user.name="e2e" -c user.email="e2e@example.com" commit -m "init" --allow-empty', {
    cwd: root,
    stdio: "ignore",
  })

  return root
}

export async function cleanupTestProject(directory: string) {
  try {
    execSync("git fsmonitor--daemon stop", { cwd: directory, stdio: "ignore" })
  } catch {}
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)
}

export function sessionIDFromUrl(url: string) {
  const match = /\/session\/([^/?#]+)/.exec(url)
  return match?.[1]
}

export async function clickMenuItem(menu: Locator, itemName: string | RegExp, options?: { force?: boolean }) {
  const item = menu.getByRole("menuitem").filter({ hasText: itemName }).first()
  await expect(item).toBeVisible()
  await item.click({ force: options?.force })
}

export async function clickListItem(
  container: Locator | Page,
  filter: string | RegExp | { key?: string; text?: string | RegExp; keyStartsWith?: string },
): Promise<Locator> {
  let item: Locator

  if (typeof filter === "string" || filter instanceof RegExp) {
    item = container.locator(listItemSelector).filter({ hasText: filter }).first()
  } else if (filter.keyStartsWith) {
    item = container.locator(listItemKeyStartsWithSelector(filter.keyStartsWith)).first()
  } else if (filter.key) {
    item = container.locator(listItemKeySelector(filter.key)).first()
  } else if (filter.text) {
    item = container.locator(listItemSelector).filter({ hasText: filter.text }).first()
  } else {
    throw new Error("Invalid filter provided to clickListItem")
  }

  await expect(item).toBeVisible()
  await item.click()
  return item
}

export async function withSession<T>(
  sdk: ReturnType<typeof createSdk>,
  title: string,
  callback: (session: { id: string; title: string }) => Promise<T>,
): Promise<T> {
  const session = await sdk.session.create({ title }).then((r) => r.data)
  if (!session?.id) throw new Error("Session create did not return an id")

  try {
    return await callback(session)
  } finally {
    await sdk.session.delete({ sessionID: session.id }).catch(() => undefined)
  }
}

const seedSystem = [
  "You are seeding deterministic e2e UI state.",
  "Follow the user's instruction exactly.",
  "When asked to call a tool, call exactly that tool exactly once with the exact JSON input.",
  "Do not call any extra tools.",
].join(" ")

const wait = async <T>(input: { probe: () => Promise<T | undefined>; timeout?: number }) => {
  const timeout = input.timeout ?? 30_000
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await input.probe()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const seed = async <T>(input: {
  sessionID: string
  prompt: string
  sdk: ReturnType<typeof createSdk>
  probe: () => Promise<T | undefined>
  timeout?: number
  attempts?: number
}) => {
  for (let i = 0; i < (input.attempts ?? 2); i++) {
    await input.sdk.session.promptAsync({
      sessionID: input.sessionID,
      agent: "build",
      system: seedSystem,
      parts: [{ type: "text", text: input.prompt }],
    })
    const value = await wait({ probe: input.probe, timeout: input.timeout })
    if (value !== undefined) return value
  }
}

export async function seedSessionQuestion(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    questions: Array<{
      header: string
      question: string
      options: Array<{ label: string; description: string }>
      multiple?: boolean
      custom?: boolean
    }>
  },
) {
  const first = input.questions[0]
  if (!first) throw new Error("Question seed requires at least one question")

  const text = [
    "Your only valid response is one question tool call.",
    `Use this JSON input: ${JSON.stringify({ questions: input.questions })}`,
    "Do not output plain text.",
    "After calling the tool, wait for the user response.",
  ].join("\n")

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 30_000,
    probe: async () => {
      const list = await sdk.question.list().then((x) => x.data ?? [])
      return list.find((item) => item.sessionID === input.sessionID && item.questions[0]?.header === first.header)
    },
  })

  if (!result) throw new Error("Timed out seeding question request")
  return { id: result.id }
}

export async function seedSessionTodos(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    todos: Array<{ content: string; status: string; priority: string }>
  },
) {
  const text = [
    "Your only valid response is one todowrite tool call.",
    `Use this JSON input: ${JSON.stringify({ todos: input.todos })}`,
    "Do not output plain text.",
  ].join("\n")
  const target = JSON.stringify(input.todos)

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 30_000,
    probe: async () => {
      const todos = await sdk.session.todo({ sessionID: input.sessionID }).then((x) => x.data ?? [])
      if (JSON.stringify(todos) !== target) return
      return true
    },
  })

  if (!result) throw new Error("Timed out seeding todos")
  return true
}

export async function clearSessionDockSeed(sdk: ReturnType<typeof createSdk>, sessionID: string) {
  const questions = await sdk.question.list().then((x) => x.data ?? [])

  await Promise.all([
    ...questions
      .filter((item) => item.sessionID === sessionID)
      .map((item) => sdk.question.reject({ requestID: item.id }).catch(() => undefined)),
  ])

  return true
}

export async function openStatusPopover(page: Page) {
  await defocus(page)

  const rightSection = page.locator(titlebarRightSelector)
  const trigger = rightSection.getByRole("button", { name: /status/i }).first()

  const popoverBody = page.locator(popoverBodySelector).filter({ has: page.locator('[data-component="tabs"]') })

  const opened = await popoverBody
    .isVisible()
    .then((x) => x)
    .catch(() => false)

  if (!opened) {
    await expect(trigger).toBeVisible()
    await trigger.click()
    await expect(popoverBody).toBeVisible()
  }

  return { rightSection, popoverBody }
}
