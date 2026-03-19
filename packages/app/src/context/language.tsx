import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { dict as en } from "@/i18n/en"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"

export type Locale = "en"

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>

function cookie(locale: Locale) {
  return `oc_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

const LOCALES = ["en"] as const satisfies readonly Locale[]

const INTL: Record<Locale, string> = {
  en: "en",
}

const LABEL_KEY: Record<Locale, keyof Dictionary> = {
  en: "language.en",
}

const base = i18n.flatten({ ...en, ...uiEn })
const DICT: Record<Locale, Dictionary> = {
  en: base,
}

function detectLocale(): Locale {
  return "en"
}

function normalizeLocale(_value: string): Locale {
  return "en"
}

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  init: () => {
    const [store, setStore, _, ready] = persisted(
      Persist.global("language", ["language.v1"]),
      createStore({
        locale: detectLocale(),
      }),
    )

    const locale = createMemo<Locale>(() => normalizeLocale(store.locale))
    console.log("locale", locale())
    const intl = createMemo(() => INTL[locale()])

    const dict = createMemo<Dictionary>(() => DICT[locale()])

    const t = i18n.translator(dict, i18n.resolveTemplate)

    const label = (value: Locale) => t(LABEL_KEY[value])

    createEffect(() => {
      if (typeof document !== "object") return
      document.documentElement.lang = locale()
      document.cookie = cookie(locale())
    })

    return {
      ready,
      locale,
      intl,
      locales: LOCALES,
      label,
      t,
      setLocale(next: Locale) {
        setStore("locale", normalizeLocale(next))
      },
    }
  },
})
