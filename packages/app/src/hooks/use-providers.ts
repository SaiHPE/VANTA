import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = [
  "ollama",
]

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const currentDirectory = createMemo(() => decode64(params.dir) ?? "")
  const providers = createMemo(() => {
    if (currentDirectory()) {
      const [projectStore] = globalSync.child(currentDirectory())
      return projectStore.provider
    }
    return globalSync.data.provider
  })
  const all = createMemo(() => providers().all.filter((item) => item.id === "ollama"))
  const connectedIDs = createMemo(() => new Set<string>(providers().connected.filter((item) => item === "ollama")))
  const connected = createMemo(() => all().filter((p) => connectedIDs().has(p.id)))
  return {
    all,
    default: createMemo(() => providers().default),
    connected,
  }
}
