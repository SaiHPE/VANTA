import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Tool } from "./tool"
import { VM, VMRemote } from "@/vm"
import { VMSSH } from "@/vm/ssh"
import { VMOperate } from "@/vm/operate"
import { VMWorkspace } from "@/vm/workspace"
import path from "path"
import z from "zod"

const Targets = z.union([z.string(), z.array(z.string()).min(1)])
const SessionIDs = z.union([Identifier.schema("vm_remote_session"), z.array(Identifier.schema("vm_remote_session")).min(1)])
const JobIDs = z.union([Identifier.schema("vm_job"), z.array(Identifier.schema("vm_job")).min(1)])
const Shell = z.enum(["auto", "bash", "sh"])
const Mode = z.enum(["serial", "parallel"])
const Concurrency = z.number().int().positive().default(VMWorkspace.DEFAULT_CONCURRENCY)

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
        item.workspaceRoot ? `workspace=${item.workspaceRoot}` : "",
        item.repoUrl ? `repo=${item.repoUrl}` : "",
        `user=${item.username}`,
        `status=${item.lastStatus}`,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n")
}

function lines(input: string | string[]) {
  return Array.isArray(input) ? input : [input]
}

async function batch<T>(input: {
  items: string[]
  mode?: "serial" | "parallel"
  concurrency?: number
  work: (item: string, idx: number) => Promise<T>
}) {
  if (input.mode !== "parallel") {
    return input.items.reduce(
      (acc, item, idx) => acc.then(async (list) => [...list, await input.work(item, idx)]),
      Promise.resolve([] as T[]),
    )
  }
  const out = Array<T>(input.items.length)
  let idx = 0
  const next = async (): Promise<void> => {
    const cur = idx++
    if (cur >= input.items.length) return
    out[cur] = await input.work(input.items[cur]!, cur)
    await next()
  }
  await Promise.all(Array.from({ length: Math.min(input.concurrency ?? VMWorkspace.DEFAULT_CONCURRENCY, input.items.length) }, () => next()))
  return out
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

async function failure(vm: VM.Detail, name: string, err: unknown) {
  const text = err instanceof Error ? err.stack ?? err.message : String(err)
  const info = await VMOperate.capture(text)
  return {
    summary: err instanceof Error ? err.message : String(err),
    output: info.output,
    transcriptPath: info.transcriptPath,
    artifacts: VMOperate.inline(vm, name, text),
    ran: false,
  } satisfies VMOperate.Done
}

async function run<T>(input: {
  ctx: Tool.Context
  tool: string
  targets: string | string[]
  title: string
  work: (vm: VM.Detail, push: (chunk: string) => void, activityID: string) => Promise<T>
  done: (vm: VM.Detail, value: T) => VMOperate.Done | Promise<VMOperate.Done>
  fail?: (vm: VM.Detail, err: unknown) => VMOperate.Done | Promise<VMOperate.Done>
  mode?: "serial" | "parallel"
  concurrency?: number
}) {
  const vms = await confirm(input.ctx, input.targets)
  return VMOperate.run({
    ctx: input.ctx,
    tool: input.tool,
    vms,
    title: input.title,
    mode: input.mode,
    concurrency: input.concurrency,
    work: input.work,
    done: input.done,
    fail: input.fail,
  })
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
    mode: Mode.default("serial"),
    concurrency: Concurrency,
  }),
  async execute(input, ctx) {
    return run({
      ctx,
      tool: "vm_test",
      targets: input.targets,
      title: "Testing VM connectivity",
      mode: input.mode,
      concurrency: input.concurrency,
      async work(vm, push) {
        const conn = await VM.connect({
          sessionID: ctx.sessionID,
          vm,
          abort: ctx.abort,
        })
        const facts = await VM.facts({
          conn,
          vmID: vm.id,
        })
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
        return failure(vm, "test-error", err)
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
    concurrency: Concurrency,
  }),
  async execute(input, ctx) {
    return run({
      ctx,
      tool: "vm_exec",
      targets: input.targets,
      title: "Executing remote command",
      mode: input.mode,
      concurrency: input.concurrency,
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
          shell: input.shell === "auto" ? await VM.shell({ conn }) : input.shell,
          abort: ctx.abort,
          onData(chunk) {
            push(chunk.text)
          },
        })
      },
      async done(_vm, value) {
        const info = await VMOperate.capture(VMOperate.body(value.stdout, value.stderr))
        return {
          summary: [`exit=${value.code ?? "unknown"}`, value.timedOut ? "timed out" : "completed"].join(" "),
          exitCode: value.code,
          output: info.output,
          transcriptPath: info.transcriptPath,
          ran: true,
        }
      },
      fail(vm, err) {
        return failure(vm, "exec-error", err)
      },
    })
  },
})

export const VMWorkspacePrepareTool = Tool.define("vm_workspace_prepare", {
  description:
    "Prepare or reuse a cached git checkout and deterministic worktree inside one or more Linux VMs for repeated runbook or command execution.",
  parameters: z.object({
    targets: Targets,
    repo_url: z.string().optional(),
    ref: z.string().optional(),
    base_dir: z.string().optional(),
    mode: Mode.default("serial"),
    concurrency: Concurrency,
  }),
  async execute(input, ctx) {
    const needs = {
      repoUrl: !input.repo_url,
      ref: !input.ref,
    }
    const local = needs.repoUrl || needs.ref ? await VMWorkspace.local(needs) : {}
    return run({
      ctx,
      tool: "vm_workspace_prepare",
      targets: input.targets,
      title: "Preparing remote workspace",
      mode: input.mode,
      concurrency: input.concurrency,
      async work(vm, push) {
        const conn = await VM.connect({
          sessionID: ctx.sessionID,
          vm,
          abort: ctx.abort,
        })
        const value = await VMSSH.workspace({
          client: conn.client,
          baseDir: VMWorkspace.root({
            baseDir: input.base_dir,
            vm,
          }),
          projectID: Instance.project.id,
          repoUrl: VMWorkspace.repo({
            repoUrl: input.repo_url,
            fallback: local.repoUrl,
            vm,
          }),
          ref: input.ref ?? local.ref ?? "",
        })
        push(`${value.workspaceDir}\n${value.workspaceRef}`)
        return value
      },
      done(_vm, value) {
        return {
          summary: `prepared ${value.workspaceDir}`,
          output: [
            `workspace_dir=${value.workspaceDir}`,
            `workspace_ref=${value.workspaceRef}`,
            `workspace_repo=${value.workspaceRepo}`,
            `repo_url=${value.repoUrl}`,
          ].join("\n"),
          ran: true,
        }
      },
      fail(vm, err) {
        return failure(vm, "workspace-prepare-error", err)
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
      mode: Mode.default("serial"),
      concurrency: Concurrency,
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
      mode: input.mode,
      concurrency: input.concurrency,
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
          sftp: VM.sftp({ conn }),
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
        return failure(vm, "upload-error", err)
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
    mode: Mode.default("serial"),
    concurrency: Concurrency,
  }),
  async execute(input, ctx) {
    return run({
      ctx,
      tool: "vm_download",
      targets: input.targets,
      title: "Downloading file from VM",
      mode: input.mode,
      concurrency: input.concurrency,
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
          sftp: VM.sftp({ conn }),
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
        return failure(vm, "download-error", err)
      },
    })
  },
})

export const VMSessionTool = Tool.define("vm_session", {
  description: "Open, inspect, or close a persistent remote opencode worker session inside one or more Linux VMs.",
  parameters: z
    .object({
      action: z.enum(["open", "status", "close"]),
      targets: Targets.optional(),
      vm_session_id: SessionIDs.optional(),
      base_dir: z.string().optional(),
      repo_url: z.string().optional(),
      ref: z.string().optional(),
      sparse_paths: z.array(z.string()).optional(),
      cache_root: z.string().optional(),
      cache_dirs: z.array(z.string()).optional(),
      mode: Mode.default("serial"),
      concurrency: Concurrency,
    })
    .superRefine((input, issue) => {
      if (input.action === "open" && !input.targets) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "targets are required when action=open" })
      }
      if (input.action !== "open" && !input.vm_session_id) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["vm_session_id"],
          message: "vm_session_id is required when action is status or close",
        })
      }
    }),
  async execute(input, ctx) {
    if (input.action === "open") {
      return run({
        ctx,
        tool: "vm_session",
        targets: input.targets!,
        title: "Opening remote VM session",
        mode: input.mode,
        concurrency: input.concurrency,
        async work(vm, push) {
          const value = await VMRemote.sessionOpen({
            sessionID: ctx.sessionID,
            vmID: vm.id,
            baseDir: input.base_dir,
            repoUrl: input.repo_url,
            ref: input.ref,
            sparsePaths: input.sparse_paths,
            cacheRoot: input.cache_root,
            cacheDirs: input.cache_dirs,
            abort: ctx.abort,
          })
          push(value.workspaceDir)
          return value
        },
        done(_vm, value) {
          return {
            summary: `opened ${value.workspaceDir}`,
            output: [
              `vm_session_id=${value.id}`,
              `workspace_dir=${value.workspaceDir}`,
              `workspace_ref=${value.workspaceRef}`,
              `workspace_repo=${value.workspaceRepo}`,
            ].join("\n"),
            ran: true,
          }
        },
        fail(vm, err) {
          return failure(vm, "session-open-error", err)
        },
      })
    }

    const ids = lines(input.vm_session_id!)
    if (input.action === "status") {
      const items = await batch({
        items: ids,
        mode: input.mode,
        concurrency: input.concurrency,
        work: (id) => VMRemote.session({ vmSessionID: id }),
      })
      return {
        title: `Loaded ${items.length} VM session${items.length === 1 ? "" : "s"}`,
        output: items
          .map((item) =>
            [
              `vm_session_id=${item.id}`,
              `vm_id=${item.vmID}`,
              `status=${item.status}`,
              `workspace_dir=${item.workspaceDir}`,
              `workspace_ref=${item.workspaceRef}`,
            ].join(" "),
          )
          .join("\n"),
        metadata: {
          activity_ids: {},
          artifacts: [],
          output: undefined,
          count: items.length,
        },
      }
    }

    const items = await batch({
      items: ids,
      mode: input.mode,
      concurrency: input.concurrency,
      work: (id) => VMRemote.sessionClose({ vmSessionID: id }),
    })
    return {
      title: `Closed ${items.length} VM session${items.length === 1 ? "" : "s"}`,
      output: items.map((item) => `${item.id} ${item.status}`).join("\n"),
      metadata: {
        activity_ids: {},
        artifacts: [],
        output: undefined,
        count: items.length,
      },
    }
  },
})

export const VMSyncTool = Tool.define("vm_sync", {
  description: "Overlay changed local working-tree files onto one or more prepared remote VM sessions.",
  parameters: z.object({
    vm_session_id: SessionIDs,
    include_untracked: z.boolean().default(false),
    mode: Mode.default("serial"),
    concurrency: Concurrency,
  }),
  async execute(input) {
    const items = await batch({
      items: lines(input.vm_session_id),
      mode: input.mode,
      concurrency: input.concurrency,
      work: (id) =>
        VMRemote.sync({
          vmSessionID: id,
          includeUntracked: input.include_untracked,
        }),
    })
    return {
      title: `Synced ${items.length} VM session${items.length === 1 ? "" : "s"}`,
      output: items
        .map((item) =>
          [
            `vm_session_id=${item.vmSessionID}`,
            `hash=${item.hash}`,
            `uploaded=${item.uploaded}`,
            `deleted=${item.deleted}`,
            `skipped=${item.skipped}`,
          ].join(" "),
        )
        .join("\n"),
      metadata: {
        count: items.length,
      },
    }
  },
})

export const VMJobStartTool = Tool.define("vm_job_start", {
  description: "Start a long-running command inside one or more active remote VM sessions.",
  parameters: z.object({
    vm_session_id: SessionIDs,
    command: z.string().min(1),
    cwd: z.string().optional(),
    mode: Mode.default("serial"),
    concurrency: Concurrency,
  }),
  async execute(input) {
    const items = await batch({
      items: lines(input.vm_session_id),
      mode: input.mode,
      concurrency: input.concurrency,
      work: (id) =>
        VMRemote.jobStart({
          vmSessionID: id,
          command: input.command,
          cwd: input.cwd,
        }),
    })
    return {
      title: `Started ${items.length} VM job${items.length === 1 ? "" : "s"}`,
      output: items.map((item) => [`vm_job_id=${item.id}`, `status=${item.status}`, `cwd=${item.cwd ?? ""}`].filter(Boolean).join(" ")).join("\n"),
      metadata: {
        count: items.length,
      },
    }
  },
})

export const VMJobLogsTool = Tool.define("vm_job_logs", {
  description: "Read logs from one or more VM jobs.",
  parameters: z.object({
    vm_job_id: JobIDs,
    tail: z.number().int().positive().optional(),
    follow: z.boolean().default(false),
    mode: Mode.default("serial"),
    concurrency: Concurrency,
  }),
  async execute(input) {
    const items = await batch({
      items: lines(input.vm_job_id),
      mode: input.mode,
      concurrency: input.concurrency,
      work: (id) =>
        VMRemote.jobLogs({
          vmJobID: id,
          tail: input.tail,
          follow: input.follow,
        }),
    })
    return {
      title: `Loaded ${items.length} VM job log${items.length === 1 ? "" : "s"}`,
      output: items.map((item) => [`[${item.id}]`, item.log].join("\n")).join("\n\n"),
      metadata: {
        count: items.length,
      },
    }
  },
})

export const VMJobWaitTool = Tool.define("vm_job_wait", {
  description: "Wait for one or more VM jobs to complete.",
  parameters: z.object({
    vm_job_id: JobIDs,
    timeout_ms: z.number().int().positive().optional(),
    mode: Mode.default("serial"),
    concurrency: Concurrency,
  }),
  async execute(input) {
    const items = await batch({
      items: lines(input.vm_job_id),
      mode: input.mode,
      concurrency: input.concurrency,
      work: (id) =>
        VMRemote.jobWait({
          vmJobID: id,
          timeoutMs: input.timeout_ms,
        }),
    })
    return {
      title: `Waited on ${items.length} VM job${items.length === 1 ? "" : "s"}`,
      output: items
        .map((item) =>
          [
            `vm_job_id=${item.id}`,
            `status=${item.status}`,
            typeof item.exitCode === "number" ? `exit=${item.exitCode}` : "",
            "timedOut" in item && item.timedOut ? "timed_out=true" : "",
          ]
            .filter(Boolean)
            .join(" "),
        )
        .join("\n"),
      metadata: {
        count: items.length,
      },
    }
  },
})

export const VMJobCancelTool = Tool.define("vm_job_cancel", {
  description: "Cancel one or more running VM jobs.",
  parameters: z.object({
    vm_job_id: JobIDs,
    mode: Mode.default("serial"),
    concurrency: Concurrency,
  }),
  async execute(input) {
    const items = await batch({
      items: lines(input.vm_job_id),
      mode: input.mode,
      concurrency: input.concurrency,
      work: (id) =>
        VMRemote.jobCancel({
          vmJobID: id,
        }),
    })
    return {
      title: `Cancelled ${items.length} VM job${items.length === 1 ? "" : "s"}`,
      output: items.map((item) => `${item.id} ${item.status}`).join("\n"),
      metadata: {
        count: items.length,
      },
    }
  },
})

export const VMReadTool = Tool.define("vm_read", {
  description: "Read files or directories inside an active remote VM workspace session.",
  parameters: z.object({
    vm_session_id: Identifier.schema("vm_remote_session"),
    path: z.string().optional(),
    offset: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  }),
  async execute(input) {
    const result = await VMRemote.remoteRead({
      vmSessionID: input.vm_session_id,
      path: input.path,
      offset: input.offset,
      limit: input.limit,
    })
    return {
      title: "Remote read",
      output: result.output,
      metadata: {},
    }
  },
})

export const VMGrepTool = Tool.define("vm_grep", {
  description: "Search file contents inside an active remote VM workspace session.",
  parameters: z.object({
    vm_session_id: Identifier.schema("vm_remote_session"),
    pattern: z.string().min(1),
    path: z.string().optional(),
    include: z.string().optional(),
  }),
  async execute(input) {
    const result = await VMRemote.remoteGrep({
      vmSessionID: input.vm_session_id,
      pattern: input.pattern,
      path: input.path,
      include: input.include,
    })
    return {
      title: input.pattern,
      output: result.output,
      metadata: {
        matches: result.matches,
      },
    }
  },
})

export const VMGlobTool = Tool.define("vm_glob", {
  description: "List files in an active remote VM workspace session using a glob pattern.",
  parameters: z.object({
    vm_session_id: Identifier.schema("vm_remote_session"),
    pattern: z.string().min(1),
    path: z.string().optional(),
  }),
  async execute(input) {
    const result = await VMRemote.remoteGlob({
      vmSessionID: input.vm_session_id,
      pattern: input.pattern,
      path: input.path,
    })
    return {
      title: input.pattern,
      output: result.paths.length > 0 ? result.paths.join("\n") : "No files found",
      metadata: {
        count: result.paths.length,
      },
    }
  },
})
