import { createEffect, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useLayout } from "@/context/layout"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { applyPath, backPath, forwardPath } from "./titlebar-history"

export function Titlebar() {
  const layout = useLayout()
  const command = useCommand()
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`

  createEffect(() => {
    const current = path()

    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const canBack = () => history.index > 0
  const canForward = () => history.index < history.stack.length - 1

  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  return (
    <header class="h-10 shrink-0 bg-background-base relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center">
      <div class="flex items-center min-w-0 pl-2">
        <div class="xl:hidden w-10 shrink-0 flex items-center justify-center">
          <IconButton
            icon="menu"
            variant="ghost"
            class="titlebar-icon rounded-md"
            onClick={layout.mobileSidebar.toggle}
            aria-label={language.t("sidebar.menu.toggle")}
            aria-expanded={layout.mobileSidebar.opened()}
          />
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <TooltipKeybind
            class="hidden xl:flex shrink-0 ml-2"
            placement="bottom"
            title={language.t("command.sidebar.toggle")}
            keybind={command.keybind("sidebar.toggle")}
          >
            <Button
              variant="ghost"
              class="group/sidebar-toggle titlebar-icon w-8 h-6 p-0 box-border"
              onClick={layout.sidebar.toggle}
              aria-label={language.t("command.sidebar.toggle")}
              aria-expanded={layout.sidebar.opened()}
            >
              <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                <Icon
                  size="small"
                  name={layout.sidebar.opened() ? "layout-left-partial" : "layout-left"}
                  class="group-hover/sidebar-toggle:hidden"
                />
                <Icon size="small" name="layout-left-partial" class="hidden group-hover/sidebar-toggle:inline-block" />
                <Icon
                  size="small"
                  name={layout.sidebar.opened() ? "layout-left" : "layout-left-partial"}
                  class="hidden group-active/sidebar-toggle:inline-block"
                />
              </div>
            </Button>
          </TooltipKeybind>
          <div class="hidden xl:flex items-center shrink-0">
            <Show when={params.dir}>
              <TooltipKeybind
                placement="bottom"
                title={language.t("command.session.new")}
                keybind={command.keybind("session.new")}
                openDelay={2000}
              >
                <Button
                  variant="ghost"
                  icon="new-session"
                  class="titlebar-icon w-8 h-6 p-0 box-border"
                  onClick={() => {
                    if (!params.dir) return
                    navigate(`/${params.dir}/session`)
                  }}
                  aria-label={language.t("command.session.new")}
                />
              </TooltipKeybind>
            </Show>
            <div class="flex items-center gap-0" classList={{ "ml-1": !!params.dir }}>
              <Tooltip placement="bottom" value={language.t("common.goBack")} openDelay={2000}>
                <Button
                  variant="ghost"
                  icon="chevron-left"
                  class="titlebar-icon w-6 h-6 p-0 box-border"
                  disabled={!canBack()}
                  onClick={back}
                  aria-label={language.t("common.goBack")}
                />
              </Tooltip>
              <Tooltip placement="bottom" value={language.t("common.goForward")} openDelay={2000}>
                <Button
                  variant="ghost"
                  icon="chevron-right"
                  class="titlebar-icon w-6 h-6 p-0 box-border"
                  disabled={!canForward()}
                  onClick={forward}
                  aria-label={language.t("common.goForward")}
                />
              </Tooltip>
            </div>
          </div>
        </div>
        <div id="opencode-titlebar-left" class="flex items-center gap-3 min-w-0 px-2" />
      </div>

      <div class="min-w-0 flex items-center justify-center pointer-events-none">
        <div id="opencode-titlebar-center" class="pointer-events-auto w-full min-w-0 flex justify-center lg:w-fit" />
      </div>

      <div class="flex items-center min-w-0 justify-end pr-2">
        <div id="opencode-titlebar-right" class="flex items-center gap-1 shrink-0 justify-end" />
      </div>
    </header>
  )
}
