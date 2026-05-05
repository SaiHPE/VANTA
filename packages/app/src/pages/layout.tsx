import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useNavigate, useParams } from "@solidjs/router"
import { type ParentProps, Show, createMemo } from "solid-js"
import { DialogSettings } from "@/components/dialog-settings"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"

export default function Layout(props: ParentProps) {
  const dialog = useDialog()
  const navigate = useNavigate()
  const params = useParams()
  const server = useServer()
  const language = useLanguage()
  const dir = createMemo(() => decode64(params.dir))

  return (
    <div class="flex min-h-screen flex-col bg-background-base">
      <header class="sticky top-0 z-20 border-b border-border-weak-base bg-background-base/95 backdrop-blur">
        <div class="mx-auto flex h-13 w-full max-w-[1200px] items-center justify-between gap-3 px-4">
          <div class="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="small" onClick={() => navigate("/")}>
              <Icon name="chevron-left" />
              Newton
            </Button>
            <div class="min-w-0">
              <div class="truncate text-13-medium text-text-strong">{dir() ?? "Home"}</div>
              <div class="truncate text-11-regular text-text-weak">{server.name}</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Show when={server.healthy() !== undefined}>
              <div
                classList={{
                  "size-2 rounded-full": true,
                  "bg-icon-success-base": server.healthy() === true,
                  "bg-icon-critical-base": server.healthy() === false,
                }}
              />
            </Show>
            <Button variant="ghost" size="small" onClick={() => dialog.show(() => <DialogSettings />)}>
              {language.t("command.settings.open")}
            </Button>
          </div>
        </div>
      </header>
      <main class="flex min-h-0 flex-1">{props.children}</main>
    </div>
  )
}
