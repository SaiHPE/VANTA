import { Button } from "@opencode-ai/ui/button"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useParams } from "@solidjs/router"
import { PromptInput } from "@/components/prompt-input"
import { SessionHeader } from "@/components/session/session-header"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { sessionPermissionRequest, sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import { useSessionCommands } from "@/pages/session/use-session-commands"

export default function SessionPage() {
  const params = useParams()
  const permission = usePermission()
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const language = useLanguage()
  const [busy, setBusy] = createSignal("")
  const [replying, setReplying] = createSignal(false)
  let input: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined

  useSessionCommands({
    focusInput: () => input?.focus(),
  })

  createEffect(() => {
    const id = params.id
    if (!id) return
    void sync.session.sync(id)
    void sync.session.todo(id)
    void sync.session.runbook(id)
  })

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const user = createMemo(() => messages().filter((m) => m.role === "user"))
  const assistant = createMemo(() => messages().filter((m) => m.role === "assistant"))
  const pending = createMemo(() =>
    assistant().findLast((item) => typeof item.time.completed !== "number"),
  )
  const active = createMemo(() => pending()?.parentID ?? user().at(-1)?.id)
  const status = createMemo(() => (params.id ? sync.data.session_status[params.id] : undefined))
  const historyMore = createMemo(() => (params.id ? sync.session.history.more(params.id) : false))
  const historyLoading = createMemo(() => (params.id ? sync.session.history.loading(params.id) : false))
  const runbook = createMemo(() => (params.id ? sync.data.runbook[params.id] : undefined))
  const perm = createMemo(() => sessionPermissionRequest(sync.data.session, sync.data.permission, params.id))
  const question = createMemo(() => sessionQuestionRequest(sync.data.session, sync.data.question, params.id))
  const todos = createMemo(() => (params.id ? sync.data.todo[params.id] ?? [] : []))
  const showTodos = createMemo(() =>
    todos().some((item) => item.status === "pending" || item.status === "in_progress"),
  )

  createEffect(() => {
    messages().length
    requestAnimationFrame(() => {
      if (!scroller) return
      scroller.scrollTop = scroller.scrollHeight
    })
  })

  const act = async (kind: "execute" | "resume" | "cancel") => {
    const sessionID = params.id
    const runID = runbook()?.run?.id
    if (!sessionID) return
    if ((kind === "resume" || kind === "cancel") && !runID) return
    setBusy(kind)
    try {
      if (kind === "execute") await sync.session.runbookExecute(sessionID)
      if (kind === "resume") await sync.session.runbookResume({ runID: runID!, sessionID })
      if (kind === "cancel") await sync.session.runbookCancel({ runID: runID!, sessionID })
    } finally {
      setBusy("")
    }
  }

  const decide = async (response: "once" | "always" | "reject") => {
    const req = perm()
    if (!req) return
    setReplying(true)
    try {
      permission.respond({
        sessionID: req.sessionID,
        permissionID: req.id,
        response,
        directory: sdk.directory,
      })
      requestAnimationFrame(() => input?.focus())
    } finally {
      setReplying(false)
    }
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <SessionHeader />
      <Show when={runbook()?.exists || runbook()?.run}>
        <div class="flex items-center justify-between gap-3 border-b border-border-weak-base px-4 py-3">
          <div class="min-w-0">
            <div class="text-12-medium text-text-strong">Runbook</div>
            <div class="truncate text-12-regular text-text-weak">
              {runbook()?.run ? `${runbook()?.run?.status} | step ${runbook()?.run?.stepIdx ?? 0}` : runbook()?.path}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Button
              size="small"
              variant="secondary"
              disabled={!!busy() || runbook()?.run?.status === "running"}
              onClick={() => void act("execute")}
            >
              Execute
            </Button>
            <Show when={runbook()?.run?.status === "paused"}>
              <Button size="small" variant="secondary" disabled={!!busy()} onClick={() => void act("resume")}>
                Resume
              </Button>
            </Show>
            <Show when={runbook()?.run?.status === "running" || runbook()?.run?.status === "paused"}>
              <Button size="small" variant="ghost" disabled={!!busy()} onClick={() => void act("cancel")}>
                Cancel
              </Button>
            </Show>
          </div>
        </div>
      </Show>
      <div ref={scroller} class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex w-full max-w-[1000px] flex-col gap-6 px-4 py-6">
          <Show when={params.id && (historyMore() || historyLoading())}>
            <div class="flex justify-center">
              <Button
                variant="ghost"
                size="small"
                disabled={historyLoading()}
                onClick={() => params.id && void sync.session.history.loadMore(params.id)}
              >
                {historyLoading() ? language.t("session.messages.loadingEarlier") : language.t("session.messages.loadEarlier")}
              </Button>
            </div>
          </Show>
          <Show when={user().length > 0} fallback={<EmptyState title={info()?.title} />}>
            <For each={user()}>
              {(item) => (
                <SessionTurn
                  sessionID={params.id ?? ""}
                  messageID={item.id}
                  active={active() === item.id}
                  queued={false}
                  status={active() === item.id ? status() : undefined}
                  showReasoningSummaries={settings.general.showReasoningSummaries()}
                  shellToolDefaultOpen={settings.general.shellToolPartsExpanded()}
                  editToolDefaultOpen={settings.general.editToolPartsExpanded()}
                  classes={{
                    root: "min-w-0 w-full relative",
                    content: "flex flex-col justify-between !overflow-visible",
                    container: "w-full px-0",
                  }}
                />
              )}
            </For>
          </Show>
        </div>
      </div>
      <div class="border-t border-border-weak-base px-4 py-4">
        <div data-component="session-prompt-dock" class="mx-auto flex w-full max-w-[1000px] flex-col gap-3">
          <Show when={showTodos()}>
            <SessionTodoDock
              todos={todos()}
              title={language.t("ui.tool.todos")}
              collapseLabel={language.t("ui.common.collapse")}
              expandLabel={language.t("ui.common.expand")}
            />
          </Show>
          <Show when={perm()}>
            {(value) => (
              <SessionPermissionDock request={value()} responding={replying()} onDecide={(value) => void decide(value)} />
            )}
          </Show>
          <Show when={!perm() && question()}>
            {(value) => <SessionQuestionDock request={value()} onSubmit={() => input?.focus()} />}
          </Show>
          <Show when={!perm() && !question()}>
            <PromptInput ref={(el) => (input = el)} />
          </Show>
        </div>
      </div>
    </div>
  )
}

function EmptyState(props: { title?: string }) {
  return (
    <div class="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-weak-base px-6 py-10 text-center">
      <div class="text-14-medium text-text-strong">{props.title ?? "New session"}</div>
      <div class="max-w-120 text-13-regular text-text-weak">
        Start a conversation, switch to the `execute` agent, and ask for VM work in normal chat.
      </div>
    </div>
  )
}
