import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { OllamaSetup } from "./settings-ollama"

export function DialogConnectOllama() {
  const dialog = useDialog()
  return (
    <Dialog title="Connect Ollama" transition>
      <OllamaSetup dialog onSaved={() => dialog.close()} />
    </Dialog>
  )
}
