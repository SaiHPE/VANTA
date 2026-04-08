import { Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsMCP } from "./settings-mcp"
import { SettingsOllama } from "./settings-ollama"
import { SettingsVMs } from "./settings-vms"

export const DialogSettings: Component<{ tab?: string }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <Dialog size="x-large" transition>
      <Tabs orientation="vertical" variant="settings" defaultValue={props.tab ?? "general"} class="h-full settings-dialog">
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.tab.general")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="ollama">
                      <Icon name="providers" />
                      Ollama
                    </Tabs.Trigger>
                    <Tabs.Trigger value="mcp">
                      <Icon name="mcp" />
                      MCP
                    </Tabs.Trigger>
                    <Tabs.Trigger value="vms">
                      <Icon name="server" />
                      VMs
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>OpenCode Web</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="ollama" class="no-scrollbar">
          <SettingsOllama />
        </Tabs.Content>
        <Tabs.Content value="mcp" class="no-scrollbar">
          <SettingsMCP />
        </Tabs.Content>
        <Tabs.Content value="vms" class="no-scrollbar">
          <SettingsVMs />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
