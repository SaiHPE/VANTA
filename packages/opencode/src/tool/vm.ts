import { Instance } from "@/project/instance"
import { MessageV2 } from "@/session/message-v2"
import { Tool } from "./tool"
import { VM } from "@/vm"
import { VMSSH } from "@/vm/ssh"
import path from "path"
import z from "zod"

const Targets = z.union([z.string(), z.array(z.string()).min(1)])
const Shell = z.enum(["auto", "bash", "sh"])
const Mode = z.enum(["serial", "parallel"])

type TargetState = {
  id: string
  name: string
  status: "pending" | "running" | "completed" | "error"
  exitCode?: number
  summary?: string
}

type Done = {
  summary: string
  exitCode?: number
  artifacts?: VM.Artifact[]
  output?: string
  ran?: boolean
}

function text(input: string, limit = 12_000) {
  return input.length <= limit ? input : input.slice(input.length - limit)
}

function body(stdout: string, stderr: string, limit = 8_000) {
  const items = [
    stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
    stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
  ].filter(Boolean)
  if (items.length === 0) return ""
  return text(items.join("\n\n"), limit)
}

function artifact(name: string, mime: string, body: string) {
  return {
    name,
    mime,
    url: `data:${mime};base64,${Buffer.from(body).toString("base64")}`,
  }
}

function file(item: VM.Artifact): Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID"> {
  return {
    type: "file",
    filename: item.name,
    mime: item.mime,
    url: item.url,
  }
}

function host(vm: Pick<VM.Detail, "hostname" | "ip">) {
  return vm.hostname ?? vm.ip ?? "unknown"
}

function listOutput(items: VM.Detail[]) {
  return items
    .map((item) =>
      [
        `${item.name} (${item.id})`,
        item.hostname ? `hostname=${item.hostname}` : "",
        item.ip ? `ip=${item.ip}` : "",
        `user=${item.username}`,
        `status=${item.lastStatus}`,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n")
}

function meta(input: {
  logs: Record<string, string>
  targets: TargetState[]
  acts: Record<string, string>
  artifacts?: VM.Artifact[]
}) {
  const preview = text(
    input.targets
      .map((item) => {
        const log = input.logs[item.id]
        if (!log) return undefined
        return [`[${item.name}]`, log].join("\n")
      })
      .filter((item): item is string => !!item)
      .join("\n\n"),
  )
  return {
    preview,
    targets: input.targets,
    activity_id: Object.values(input.acts)[0],
    activity_ids: input.acts,
    artifacts: input.artifacts,
  }
}

async function confirm(ctx: Tool.Context, targets: string | string[]) {
  return VM.confirm({
    sessionID: ctx.sessionID,
    targets,
    tool: ctx.callID
      ? {
          messageID: ctx.messageID,
          callID: ctx.callID,
        }
      : undefined,
  })
}

async function run<T>(input: {
  ctx: Tool.Context
  tool: string
  targets: string | string[]
  title: string
  work: (vm: VM.Detail, push: (chunk: string) => void, activityID: string) => Promise<T>
  done: (vm: VM.Detail, value: T) => Done
  fail?: (vm: VM.Detail, err: unknown) => Done
  mode?: "serial" | "parallel"
}) {
  const vms = await confirm(input.ctx, input.targets)
  const logs: Record<string, string> = {}
  const states: TargetState[] = vms.map((item) => ({
    id: item.id,
    name: item.name,
    status: "pending",
  }))
  const acts: Record<string, string> = {}
  const artifacts: VM.Artifact[] = []
  let dirty = true
  let ran = false
  const sync = async () => {
    if (!dirty) return
    dirty = false
    await input.ctx.metadata({
      title: input.title,
      metadata: meta({ logs, targets: states, acts, artifacts }),
    })
  }

  const timer = setInterval(() => {
    void sync()
  }, 350)

  const one = async (vm: VM.Detail) => {
    const state = states.find((item) => item.id === vm.id)
    if (!state) return undefined
    state.status = "running"
    dirty = true
    const act = await VM.activityStart({
      vmID: vm.id,
      sessionID: input.ctx.sessionID,
      messageID: input.ctx.messageID,
      callID: input.ctx.callID,
      tool: input.tool,
      title: input.title,
      summary: `${vm.name} (${host(vm)})`,
    })
    acts[vm.id] = act.id
    dirty = true
    const push = (chunk: string) => {
      logs[vm.id] = text((logs[vm.id] ?? "") + chunk, 4_000)
      dirty = true
    }

    try {
      const value = await input.work(vm, push, act.id)
      const done = input.done(vm, value)
      ran = ran || done.ran !== false
      state.status = "completed"
      state.exitCode = done.exitCode
      state.summary = done.summary
      if (done.artifacts) artifacts.push(...done.artifacts)
      dirty = true
      await VM.activityFinish({
        activityID: act.id,
        status: "completed",
        summary: done.summary,
        exitCode: done.exitCode,
        transcript: logs[vm.id],
        artifacts: done.artifacts,
      })
      return {
        vm,
        ...done,
      }
    } catch (err) {
      const done = input.fail?.(vm, err) ?? {
        summary: err instanceof Error ? err.message : String(err),
        ran: false,
      }
      ran = ran || done.ran === true
      state.status = "error"
      state.exitCode = done.exitCode
      state.summary = done.summary
      if (done.artifacts) artifacts.push(...done.artifacts)
      dirty = true
      await VM.activityFinish({
        activityID: act.id,
        status: "error",
        summary: done.summary,
        exitCode: done.exitCode,
        transcript: logs[vm.id],
        artifacts: done.artifacts,
      }).catch(() => undefined)
      return {
        vm,
        ...done,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const values =
    input.mode === "parallel" ? await Promise.all(vms.map((vm) => one(vm))) : await serial(vms.map((vm) => () => one(vm)))

  clearInterval(timer)
  await sync()

  const output = values
    .filter((item): item is NonNullable<typeof item> => !!item)
    .map((item) => {
      const parts = [`${item.vm.name}: ${item.summary}`]
      if (item.output) parts.push(item.output)
      if ("error" in item && item.error) parts.push(item.error)
      return parts.join("\n")
    })
    .join("\n\n")

  if (!ran) {
    throw new Error(output || "No VM actions completed")
  }

  return {
    title: input.title,
    output,
    metadata: meta({ logs, targets: states, acts, artifacts }),
    attachments: artifacts.map(file),
  }
}

async function serial<T>(items: Array<() => Promise<T>>) {
  const result: T[] = []
  for (const item of items) {
    result.push(await item())
  }
  return result
}

function transcript(vm: VM.Detail, name: string, body: string) {
  if (!body || body.length < 2_000) return []
  return [
    artifact(
      `${vm.name}-${name}.txt`,
      "text/plain",
      body,
    ),
  ]
}

export const VMListTool = Tool.define("vm_list", {
  description: "List registered VMs or filter them by id, name, hostname, or ip address.",
  parameters: z.object({
    targets: Targets.optional(),
  }),
  async execute(input) {
    const items = input.targets ? (await VM.resolve(input.targets)).items : await VM.resolve().then((item) => item.items)
    return {
      title: `Listed ${items.length} VM${items.length === 1 ? "" : "s"}`,
      output: items.length > 0 ? listOutput(items) : "No VMs are registered in this project.",
      metadata: {
        count: items.length,
      },
    }
  },
})

export const VMTestTool = Tool.define("vm_test", {
  description: "Connect to one or more registered VMs over SSH and refresh their detected facts.",
  parameters: z.object({
    targets: Targets,
  }),
  async execute(input, ctx) {
    return run({
      ctx,
      tool: "vm_test",
      targets: input.targets,
      title: "Testing VM connectivity",
      async work(vm, push) {
        const conn = await VM.connect({
          sessionID: ctx.sessionID,
          vm,
          abort: ctx.abort,
        })
        const facts = await VMSSH.facts(conn.client)
        push(JSON.stringify(facts, null, 2))
        return facts
      },
      done(vm, facts) {
        return {
          summary: [
            `connected to ${host(vm)}`,
            facts.osName ? `os=${facts.osName}` : "",
            facts.kernel ? `kernel=${facts.kernel}` : "",
          ]
            .filter(Boolean)
            .join(" "),
          ran: true,
        }
      },
      fail(vm, err) {
        return {
          summary: `failed to connect to ${host(vm)}`,
          ran: false,
          artifacts: transcript(vm, "test", err instanceof Error ? err.stack ?? err.message : String(err)),
        }
      },
    })
  },
})

export const VMExecTool = Tool.define("vm_exec", {
  description: "Run a shell command on one or more registered Linux VMs over SSH.",
  parameters: z.object({
    targets: Targets,
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeout_secs: z.number().int().positive().default(1800),
    shell: Shell.default("auto"),
    mode: Mode.default("serial"),
  }),
  async execute(input, ctx) {
    return run({
      ctx,
      tool: "vm_exec",
      targets: input.targets,
      title: "Executing remote command",
      mode: input.mode,
      async work(vm, push) {
        const conn = await VM.connect({
          sessionID: ctx.sessionID,
          vm,
          abort: ctx.abort,
        })
        return VMSSH.exec({
          client: conn.client,
          command: input.command,
          cwd: input.cwd,
          timeout: input.timeout_secs * 1000,
          shell: input.shell,
          abort: ctx.abort,
          onData(chunk) {
            push(chunk.text)
          },
        })
      },
      done(vm, value) {
        const raw = body(value.stdout, value.stderr, 200_000)
        const out = body(value.stdout, value.stderr)
        const summary = [`exit=${value.code ?? "unknown"}`, value.timedOut ? "timed out" : "completed"].join(" ")
        return {
          summary,
          exitCode: value.code,
          output: out,
          artifacts: transcript(vm, "exec", raw),
          ran: true,
        }
      },
      fail(vm, err) {
        return {
          summary: err instanceof Error ? err.message : String(err),
          artifacts: transcript(vm, "exec-error", err instanceof Error ? err.stack ?? err.message : String(err)),
          ran: false,
        }
      },
    })
  },
})

export const VMUploadTool = Tool.define("vm_upload", {
  description: "Upload a local file or inline content to one or more registered VMs over SSH.",
  parameters: z
    .object({
      targets: Targets,
      dest_path: z.string().min(1),
      src_path: z.string().optional(),
      content: z.string().optional(),
      file_mode: z.string().optional(),
      create_dirs: z.boolean().default(true),
    })
    .superRefine((input, issue) => {
      if (!!input.src_path === !!input.content) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provide exactly one of src_path or content.",
          path: ["src_path"],
        })
      }
    }),
  async execute(input, ctx) {
    const srcPath = input.src_path
      ? path.isAbsolute(input.src_path)
        ? input.src_path
        : path.resolve(Instance.directory, input.src_path)
      : undefined
    return run({
      ctx,
      tool: "vm_upload",
      targets: input.targets,
      title: "Uploading file to VM",
      async work(vm, push) {
        const conn = await VM.connect({
          sessionID: ctx.sessionID,
          vm,
          abort: ctx.abort,
        })
        await VMSSH.upload({
          client: conn.client,
          dest: input.dest_path,
          srcPath,
          content: input.content,
          mode: input.file_mode,
          createDirs: input.create_dirs,
        })
        push(`uploaded to ${input.dest_path}`)
        return true
      },
      done() {
        return {
          summary: `uploaded ${path.posix.basename(input.dest_path)}`,
          ran: true,
        }
      },
      fail(vm, err) {
        return {
          summary: err instanceof Error ? err.message : String(err),
          artifacts: transcript(vm, "upload-error", err instanceof Error ? err.stack ?? err.message : String(err)),
          ran: false,
        }
      },
    })
  },
})

export const VMDownloadTool = Tool.define("vm_download", {
  description: "Download a file from one or more registered VMs and attach it to the current session.",
  parameters: z.object({
    targets: Targets,
    remote_path: z.string().min(1),
    local_name: z.string().optional(),
  }),
  async execute(input, ctx) {
    return run({
      ctx,
      tool: "vm_download",
      targets: input.targets,
      title: "Downloading file from VM",
      async work(vm, push) {
        const conn = await VM.connect({
          sessionID: ctx.sessionID,
          vm,
          abort: ctx.abort,
        })
        const item = await VMSSH.download({
          client: conn.client,
          remote: input.remote_path,
          localName: input.local_name
            ? (Array.isArray(input.targets) ? `${vm.name}-${input.local_name}` : input.local_name)
            : Array.isArray(input.targets)
              ? `${vm.name}-${path.posix.basename(input.remote_path)}`
              : undefined,
        })
        push(`downloaded ${item.name}`)
        return item
      },
      done(_vm, value) {
        return {
          summary: `downloaded ${value.name}`,
          artifacts: [value],
          ran: true,
        }
      },
      fail(vm, err) {
        return {
          summary: err instanceof Error ? err.message : String(err),
          artifacts: transcript(vm, "download-error", err instanceof Error ? err.stack ?? err.message : String(err)),
          ran: false,
        }
      },
    })
  },
})
