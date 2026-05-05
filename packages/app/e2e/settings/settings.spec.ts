import { test, expect } from "../fixtures"
import { closeDialog, openSettings } from "../actions"

test("settings dialog shows only server tabs", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)

  await expect(dialog.getByRole("tab", { name: "Ollama" })).toBeVisible()
  await expect(dialog.getByRole("tab", { name: "MCP" })).toBeVisible()
  await expect(dialog.getByRole("tab", { name: "VMs" })).toBeVisible()
  await expect(dialog.getByRole("tab", { name: "General" })).toHaveCount(0)
  await expect(dialog.getByRole("tab", { name: "Shortcuts" })).toHaveCount(0)
  await expect(dialog.getByRole("tab", { name: "Models" })).toHaveCount(0)

  await closeDialog(page, dialog)
})

test("settings dialog switches between ollama and mcp views", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)

  await expect(dialog.getByRole("heading", { name: "Ollama" })).toBeVisible()

  await dialog.getByRole("tab", { name: "MCP" }).click()
  await expect(dialog.getByRole("heading", { name: "MCP" })).toBeVisible()

  await dialog.getByRole("tab", { name: "Ollama" }).click()
  await expect(dialog.getByRole("heading", { name: "Ollama" })).toBeVisible()

  await closeDialog(page, dialog)
})
