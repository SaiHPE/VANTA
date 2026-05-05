import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Keybind } from "@opencode-ai/ui/keybind"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export function DialogCommandPalette() {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()

  const items = () =>
    command.options.filter((item) => !item.disabled && !item.id.startsWith("suggested.") && item.id !== "file.open")

  return (
    <Dialog title={language.t("command.palette")}>
      <List
        search={{ placeholder: language.t("palette.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("palette.empty")}
        items={items}
        key={(item) => item.id}
        filterKeys={["title", "description", "category", "slash"]}
        groupBy={(item) => item.category ?? language.t("command.category.general")}
        onSelect={(item) => {
          item?.onSelect?.("palette")
          dialog.close()
        }}
      >
        {(item) => (
          <div class="flex w-full items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-13-medium text-text-strong">{item.title}</div>
              <div class="truncate text-12-regular text-text-weak">{item.description ?? item.category}</div>
            </div>
            <div class="flex items-center gap-2">
              {item.keybind ? <Keybind>{item.keybind}</Keybind> : null}
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
