import { type MessageV2 } from "@/session/message-v2"
import { Truncate } from "@/tool/truncation"
import { VM } from "@/vm"
import { VMWorkspace } from "./workspace"

const MAX = 30_000
const TAIL = 10_000
const SMALL = 16 * 1024

export namespace VMOperate {
  export type Context = {
    sessionID: string
    messageID?: string
    callID?: string
    abort: AbortSignal
    metadata?: (input: { title?: string; metadata?: Metadata }) => void
  }

  export type Metadata = {
    output?: string
    activity_ids: Record<string, string>
    artifacts?: VM.Artifact[]
  }

  export type Done = {
    summary: string
    exitCode?: number
    output?: string
    transcriptPath?: string
    artifacts?: VM.Artifact[]
    ran: boolean
  }

  export type Item<T> = {
    vm: VM.Detail
    activityID: string
    status: "completed" | "error"
    summary: string
    exitCode?: number
    output?: string
    transcriptPath?: string
    artifacts?: VM.Artifact[]
    value?: T
    error?: unknown
  }

  export type Result<T> = {
    title: string
    output: string
    metadata: Metadata
    attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
    results: Item<T>[]
  }

  function join(items: Array<string | undefined>) {
    return items.filter(Boolean).join("\n\n")
  }

  function cut(value: string, max: number) {
    if (value.length <= max) return value
    return value.slice(-max)
  }

  function sync(ctx: Context, state: Metadata, title: string) {
    ctx.metadata?.({
      title,
      metadata: {
        ...state,
        output: state.output ? cut(state.output, MAX) : state.output,
      },
    })
  }

  export function text(value: string) {
    return `data:text/plain;base64,${Buffer.from(value).toString("base64")}`
  }

  export function artifact(name: string, body: string, mime = "text/plain") {
    return {
      name,
      mime,
      url: `data:${mime};base64,${Buffer.from(body).toString("base64")}`,
    } satisfies VM.Artifact
  }

  export function inline(vm: Pick<VM.Detail, "name">, name: string, body: string) {
    if (!body) return undefined
    if (Buffer.byteLength(body, "utf-8") > SMALL) return undefined
    return [artifact(`${vm.name}-${name}.txt`, body)]
  }

  export async function capture(text?: string) {
    if (!text) return {}
    const out = await Truncate.output(text, {
      direction: "tail",
    })
    return {
      output: out.content,
      transcriptPath: out.truncated ? out.outputPath : undefined,
    }
  }

  export function body(stdout?: string, stderr?: string, max?: number) {
    const out = [stdout?.trim(), stderr?.trim() ? `stderr:\n${stderr.trim()}` : ""].filter(Boolean).join("\n\n")
    if (!max || out.length <= max) return out
    return out.slice(0, max)
  }

  function attach(item: VM.Artifact) {
    return {
      type: "file" as const,
      filename: item.name,
      mime: item.mime,
      url: item.url,
    }
  }

  async function workers<I, T>(items: I[], size: number, fn: (item: I, idx: number) => Promise<Item<T>>) {
    const out = Array<Item<T>>(items.length)
    let idx = 0
    const run = async (): Promise<void> => {
      const cur = idx++
      if (cur >= items.length) return
      out[cur] = await fn(items[cur]!, cur)
      await run()
    }
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()))
    return out
  }

  function tails(vms: VM.Detail[], map: Record<string, string>) {
    return join(
      vms.map((vm) => {
        const body = map[vm.id]
        if (!body) return undefined
        return `[${vm.name}]\n${body}`
      }),
    )
  }

  export async function run<T>(input: {
    ctx: Context
    tool: string
    vms: VM.Detail[]
    title: string
    mode?: "serial" | "parallel"
    concurrency?: number
    work: (vm: VM.Detail, push: (chunk: string) => void, activityID: string) => Promise<T>
    done: (vm: VM.Detail, value: T) => Done | Promise<Done>
    fail?: (vm: VM.Detail, err: unknown) => Done | Promise<Done>
  }) {
    const state: Metadata = {
      output: "",
      activity_ids: {},
      artifacts: [],
    }
    const logs = {} as Record<string, string>
    const push = (vm: VM.Detail, chunk: string) => {
      const text = chunk.trim()
      if (!text) return
      logs[vm.id] = cut(join([logs[vm.id], text]), TAIL)
      state.output = tails(input.vms, logs)
      sync(input.ctx, state, input.title)
    }
    sync(input.ctx, state, input.title)

    const exec = async (vm: VM.Detail): Promise<Item<T>> => {
      const act = await VM.activityStart({
        vmID: vm.id,
        sessionID: input.ctx.sessionID,
        messageID: input.ctx.messageID,
        callID: input.ctx.callID,
        tool: input.tool,
        title: input.title,
      })
      state.activity_ids[vm.id] = act.id
      sync(input.ctx, state, input.title)

      return input
        .work(vm, (chunk) => push(vm, chunk), act.id)
        .then(async (value) => {
          const done = await input.done(vm, value)
          if (done.artifacts?.length) state.artifacts = [...(state.artifacts ?? []), ...done.artifacts]
          await VM.activityFinish({
            activityID: act.id,
            status: "completed",
            summary: done.summary,
            exitCode: done.exitCode,
            transcript: done.output,
            transcriptPath: done.transcriptPath,
            artifacts: done.artifacts,
          })
          sync(input.ctx, state, input.title)
          return {
            vm,
            activityID: act.id,
            status: "completed" as const,
            summary: done.summary,
            exitCode: done.exitCode,
            output: done.output,
            transcriptPath: done.transcriptPath,
            artifacts: done.artifacts,
            value,
          }
        })
        .catch(async (err) => {
          const done = input.fail
            ? await input.fail(vm, err)
            : {
                summary: err instanceof Error ? err.message : String(err),
                ran: false,
              }
          if (done.artifacts?.length) state.artifacts = [...(state.artifacts ?? []), ...done.artifacts]
          await VM.activityFinish({
            activityID: act.id,
            status: "error",
            summary: done.summary,
            exitCode: done.exitCode,
            transcript: done.output,
            transcriptPath: done.transcriptPath,
            artifacts: done.artifacts,
          })
          sync(input.ctx, state, input.title)
          return {
            vm,
            activityID: act.id,
            status: "error" as const,
            summary: done.summary,
            exitCode: done.exitCode,
            output: done.output,
            transcriptPath: done.transcriptPath,
            artifacts: done.artifacts,
            error: err,
          }
        })
    }

    const items =
      input.mode === "parallel"
        ? await workers(input.vms, input.concurrency ?? VMWorkspace.DEFAULT_CONCURRENCY, exec)
        : await input.vms.reduce(
            (acc, vm) => acc.then(async (list) => [...list, await exec(vm)]),
            Promise.resolve([] as Item<T>[]),
          )

    const artifacts = state.artifacts ?? []
    return {
      title: input.title,
      output: join(
        items.map((item) =>
          join([
            `${item.vm.name}: ${item.summary}`,
            item.output,
          ]),
        ),
      ),
      metadata: {
        activity_ids: state.activity_ids,
        artifacts,
        output: state.output,
      },
      attachments: artifacts.length ? artifacts.map(attach) : undefined,
      results: items,
    } satisfies Result<T>
  }
}
