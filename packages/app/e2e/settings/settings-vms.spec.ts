import { test, expect } from "../fixtures"
import { closeDialog, openSettings } from "../actions"

test("vm form keeps focus while typing", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "VMs" }).click()

  const input = dialog.getByLabel("VM name")
  await input.click()
  let text = ""
  for (const char of "hana-demo-01") {
    text += char
    await page.keyboard.type(char)
    await page.waitForTimeout(50)
    await expect(input).toHaveValue(text)
    await expect(input).toBeFocused()
  }

  await closeDialog(page, dialog)
})
