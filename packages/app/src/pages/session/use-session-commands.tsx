import { createMemo } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { DialogSelectMcp } from "@/components/dialog-select-mcp"
import { showToast } from "@opencode-ai/ui/toast"
import { findLast } from "@opencode-ai/util/array"
import { extractPromptFromParts } from "@/utils/prompt"
import { UserMessage } from "@opencode-ai/sdk/v2"

export type SessionCommandContext = {
  focusInput: () => void
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (actions: SessionCommandContext) => {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const permission = usePermission()
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const params = useParams()
  const navigate = useNavigate()

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const idle = { type: "idle" as const }
  const status = createMemo(() => sync.data.session_status[params.id ?? ""] ?? idle)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const user = createMemo(() => messages().filter((m) => m.role === "user") as UserMessage[])
  const visible = createMemo(() => {
    const revert = info()?.revert?.messageID
    if (!revert) return user()
    return user().filter((m) => m.id < revert)
  })

  const sessionCommand = withCategory(language.t("command.category.session"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const modelCommand = withCategory(language.t("command.category.model"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const agentCommand = withCategory(language.t("command.category.agent"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))

  const isAutoAcceptActive = () => {
    const sessionID = params.id
    if (sessionID) return permission.isAutoAccepting(sessionID, sdk.directory)
    return permission.isAutoAcceptingDirectory(sdk.directory)
  }

  command.register("session", () =>
    [
      sessionCommand({
        id: "session.new",
        title: language.t("command.session.new"),
        keybind: "mod+shift+s",
        slash: "new",
        onSelect: () => navigate(`/${params.dir}/session`),
      }),
      viewCommand({
        id: "input.focus",
        title: language.t("command.input.focus"),
        keybind: "ctrl+l",
        onSelect: () => actions.focusInput(),
      }),
      modelCommand({
        id: "model.choose",
        title: language.t("command.model.choose"),
        description: language.t("command.model.choose.description"),
        keybind: "mod+'",
        slash: "model",
        onSelect: () => dialog.show(() => <DialogSelectModel />),
      }),
      mcpCommand({
        id: "mcp.toggle",
        title: language.t("command.mcp.toggle"),
        description: language.t("command.mcp.toggle.description"),
        keybind: "mod+;",
        slash: "mcp",
        onSelect: () => dialog.show(() => <DialogSelectMcp />),
      }),
      agentCommand({
        id: "agent.cycle",
        title: language.t("command.agent.cycle"),
        description: language.t("command.agent.cycle.description"),
        keybind: "mod+.",
        slash: "agent",
        onSelect: () => local.agent.move(1),
      }),
      agentCommand({
        id: "agent.cycle.reverse",
        title: language.t("command.agent.cycle.reverse"),
        description: language.t("command.agent.cycle.reverse.description"),
        keybind: "shift+mod+.",
        onSelect: () => local.agent.move(-1),
      }),
      modelCommand({
        id: "model.variant.cycle",
        title: language.t("command.model.variant.cycle"),
        description: language.t("command.model.variant.cycle.description"),
        keybind: "shift+mod+d",
        onSelect: () => local.model.variant.cycle(),
      }),
      permissionsCommand({
        id: "permissions.autoaccept",
        title: isAutoAcceptActive()
          ? language.t("command.permissions.autoaccept.disable")
          : language.t("command.permissions.autoaccept.enable"),
        keybind: "mod+shift+a",
        onSelect: () => {
          const sessionID = params.id
          if (sessionID) permission.toggleAutoAccept(sessionID, sdk.directory)
          else permission.toggleAutoAcceptDirectory(sdk.directory)
          const active = sessionID
            ? permission.isAutoAccepting(sessionID, sdk.directory)
            : permission.isAutoAcceptingDirectory(sdk.directory)
          showToast({
            title: active
              ? language.t("toast.permissions.autoaccept.on.title")
              : language.t("toast.permissions.autoaccept.off.title"),
            description: active
              ? language.t("toast.permissions.autoaccept.on.description")
              : language.t("toast.permissions.autoaccept.off.description"),
          })
        },
      }),
      sessionCommand({
        id: "session.undo",
        title: language.t("command.session.undo"),
        description: language.t("command.session.undo.description"),
        slash: "undo",
        disabled: !params.id || visible().length === 0,
        onSelect: async () => {
          const sessionID = params.id
          if (!sessionID) return
          if (status()?.type !== "idle") await sdk.client.session.abort({ sessionID }).catch(() => {})
          const revert = info()?.revert?.messageID
          const msg = findLast(user(), (x) => !revert || x.id < revert)
          if (!msg) return
          await sdk.client.session.revert({ sessionID, messageID: msg.id })
          const parts = sync.data.part[msg.id]
          if (parts) prompt.set(extractPromptFromParts(parts, { directory: sdk.directory }))
        },
      }),
      sessionCommand({
        id: "session.redo",
        title: language.t("command.session.redo"),
        description: language.t("command.session.redo.description"),
        slash: "redo",
        disabled: !params.id || !info()?.revert?.messageID,
        onSelect: async () => {
          const sessionID = params.id
          const revertID = info()?.revert?.messageID
          if (!sessionID || !revertID) return
          const next = user().find((x) => x.id > revertID)
          if (!next) {
            await sdk.client.session.unrevert({ sessionID })
            prompt.reset()
            return
          }
          await sdk.client.session.revert({ sessionID, messageID: next.id })
        },
      }),
      sessionCommand({
        id: "session.compact",
        title: language.t("command.session.compact"),
        description: language.t("command.session.compact.description"),
        slash: "compact",
        disabled: !params.id || visible().length === 0,
        onSelect: async () => {
          const sessionID = params.id
          const model = local.model.current()
          if (!sessionID || !model) {
            showToast({
              title: language.t("toast.model.none.title"),
              description: language.t("toast.model.none.description"),
            })
            return
          }
          await sdk.client.session.summarize({
            sessionID,
            modelID: model.id,
            providerID: model.provider.id,
          })
        },
      }),
    ].flatMap((x) => x),
  )
}
