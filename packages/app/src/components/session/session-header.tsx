import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { StatusPopover } from "../status-popover"

const showErr = (language: ReturnType<typeof useLanguage>, err: unknown) => {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

export function SessionHeader() {
  const params = useParams()
  const language = useLanguage()
  const dir = createMemo(() => decode64(params.dir) ?? "")
  const name = createMemo(() => getFilename(dir()))

  const copy = () => {
    const value = dir()
    if (!value) return
    navigator.clipboard
      .writeText(value)
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: "Copied",
          description: value,
        })
      })
      .catch((err) => showErr(language, err))
  }

  return (
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-weak-base">
      <div class="min-w-0">
        <div class="text-14-medium text-text-strong truncate">{name()}</div>
        <div class="text-12-regular text-text-weak truncate">{dir()}</div>
      </div>
      <div class="flex items-center gap-2">
        <StatusPopover />
        <Button variant="ghost" size="small" onClick={copy}>
          {language.t("session.header.open.copyPath")}
        </Button>
      </div>
    </div>
  )
}
