import { Component, createMemo, type JSX } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { useLanguage } from "@/context/language"
import { useSettings, monoFontFamily } from "@/context/settings"
import { playSound, SOUND_OPTIONS } from "@/utils/sound"
import { Link } from "./link"

let demo = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
}

const stop = () => {
  if (demo.cleanup) demo.cleanup()
  clearTimeout(demo.timeout)
  demo.cleanup = undefined
}

const play = (src: string | undefined) => {
  stop()
  if (!src) return
  demo.timeout = setTimeout(() => {
    demo.cleanup = playSound(src)
  }, 100)
}

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const language = useLanguage()
  const settings = useSettings()

  const themeOptions = createMemo(() =>
    Object.entries(theme.themes()).map(([id, def]) => ({ id, name: def.name ?? id })),
  )

  const schemes = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: language.t("theme.scheme.system") },
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
  ])

  const fonts = [
    { value: "ibm-plex-mono", label: "font.option.ibmPlexMono" },
    { value: "cascadia-code", label: "font.option.cascadiaCode" },
    { value: "fira-code", label: "font.option.firaCode" },
    { value: "hack", label: "font.option.hack" },
    { value: "inconsolata", label: "font.option.inconsolata" },
    { value: "intel-one-mono", label: "font.option.intelOneMono" },
    { value: "iosevka", label: "font.option.iosevka" },
    { value: "jetbrains-mono", label: "font.option.jetbrainsMono" },
    { value: "meslo-lgs", label: "font.option.mesloLgs" },
    { value: "roboto-mono", label: "font.option.robotoMono" },
    { value: "source-code-pro", label: "font.option.sourceCodePro" },
    { value: "ubuntu-mono", label: "font.option.ubuntuMono" },
    { value: "geist-mono", label: "font.option.geistMono" },
  ] as const

  const none = { id: "none", label: "sound.option.none", src: undefined } as const
  const sounds = [none, ...SOUND_OPTIONS]

  const soundProps = (
    enabled: () => boolean,
    current: () => string,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    options: sounds,
    current: enabled() ? (sounds.find((item) => item.id === current()) ?? none) : none,
    value: (item: (typeof sounds)[number]) => item.id,
    label: (item: (typeof sounds)[number]) => language.t(item.label),
    onHighlight: (item: (typeof sounds)[number] | undefined) => {
      if (!item) return
      play(item.src)
    },
    onSelect: (item: (typeof sounds)[number] | undefined) => {
      if (!item) return
      if (item.id === "none") {
        setEnabled(false)
        stop()
        return
      }
      setEnabled(true)
      set(item.id)
      play(item.src)
    },
    variant: "secondary" as const,
    size: "small" as const,
    triggerVariant: "settings" as const,
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.general")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.appearance")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.general.row.appearance.title")}
              description={language.t("settings.general.row.appearance.description")}
            >
              <Select
                data-action="settings-color-scheme"
                options={schemes()}
                current={schemes().find((item) => item.value === theme.colorScheme())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && theme.setColorScheme(item.value)}
                onHighlight={(item) => {
                  if (!item) return
                  theme.previewColorScheme(item.value)
                  return () => theme.cancelPreview()
                }}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.theme.title")}
              description={
                <>
                  {language.t("settings.general.row.theme.description")}{" "}
                  <Link href="https://opencode.ai/docs/themes/">{language.t("common.learnMore")}</Link>
                </>
              }
            >
              <Select
                data-action="settings-theme"
                options={themeOptions()}
                current={themeOptions().find((item) => item.id === theme.themeId())}
                value={(item) => item.id}
                label={(item) => item.name}
                onSelect={(item) => item && theme.setTheme(item.id)}
                onHighlight={(item) => {
                  if (!item) return
                  theme.previewTheme(item.id)
                  return () => theme.cancelPreview()
                }}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.font.title")}
              description={language.t("settings.general.row.font.description")}
            >
              <Select
                data-action="settings-font"
                options={[...fonts]}
                current={fonts.find((item) => item.value === settings.appearance.font())}
                value={(item) => item.value}
                label={(item) => language.t(item.label)}
                onSelect={(item) => item && settings.appearance.setFont(item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "font-family": monoFontFamily(settings.appearance.font()), "min-width": "180px" }}
              >
                {(item) => (
                  <span style={{ "font-family": monoFontFamily(item?.value) }}>
                    {item ? language.t(item.label) : ""}
                  </span>
                )}
              </Select>
            </SettingsRow>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.feed")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.general.row.reasoningSummaries.title")}
              description={language.t("settings.general.row.reasoningSummaries.description")}
            >
              <div data-action="settings-feed-reasoning-summaries">
                <Switch
                  checked={settings.general.showReasoningSummaries()}
                  onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.shellToolPartsExpanded.title")}
              description={language.t("settings.general.row.shellToolPartsExpanded.description")}
            >
              <div data-action="settings-feed-shell-tool-parts-expanded">
                <Switch
                  checked={settings.general.shellToolPartsExpanded()}
                  onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.editToolPartsExpanded.title")}
              description={language.t("settings.general.row.editToolPartsExpanded.description")}
            >
              <div data-action="settings-feed-edit-tool-parts-expanded">
                <Switch
                  checked={settings.general.editToolPartsExpanded()}
                  onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
                />
              </div>
            </SettingsRow>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.notifications")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.general.notifications.agent.title")}
              description={language.t("settings.general.notifications.agent.description")}
            >
              <div data-action="settings-notifications-agent">
                <Switch
                  checked={settings.notifications.agent()}
                  onChange={(checked) => settings.notifications.setAgent(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.notifications.permissions.title")}
              description={language.t("settings.general.notifications.permissions.description")}
            >
              <div data-action="settings-notifications-permissions">
                <Switch
                  checked={settings.notifications.permissions()}
                  onChange={(checked) => settings.notifications.setPermissions(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.notifications.errors.title")}
              description={language.t("settings.general.notifications.errors.description")}
            >
              <div data-action="settings-notifications-errors">
                <Switch
                  checked={settings.notifications.errors()}
                  onChange={(checked) => settings.notifications.setErrors(checked)}
                />
              </div>
            </SettingsRow>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.sounds")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.general.sounds.agent.title")}
              description={language.t("settings.general.sounds.agent.description")}
            >
              <Select
                data-action="settings-sounds-agent"
                {...soundProps(
                  () => settings.sounds.agentEnabled(),
                  () => settings.sounds.agent(),
                  (value) => settings.sounds.setAgentEnabled(value),
                  (id) => settings.sounds.setAgent(id),
                )}
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.sounds.permissions.title")}
              description={language.t("settings.general.sounds.permissions.description")}
            >
              <Select
                data-action="settings-sounds-permissions"
                {...soundProps(
                  () => settings.sounds.permissionsEnabled(),
                  () => settings.sounds.permissions(),
                  (value) => settings.sounds.setPermissionsEnabled(value),
                  (id) => settings.sounds.setPermissions(id),
                )}
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.sounds.errors.title")}
              description={language.t("settings.general.sounds.errors.description")}
            >
              <Select
                data-action="settings-sounds-errors"
                {...soundProps(
                  () => settings.sounds.errorsEnabled(),
                  () => settings.sounds.errors(),
                  (value) => settings.sounds.setErrorsEnabled(value),
                  (id) => settings.sounds.setErrors(id),
                )}
              />
            </SettingsRow>
          </div>
        </div>
      </div>
    </div>
  )
}

const SettingsRow: Component<{
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
