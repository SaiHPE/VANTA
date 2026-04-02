import { Instance } from "@/project/instance"
import { Tool } from "./tool"
import { VM } from "@/vm"
import { VMSSH } from "@/vm/ssh"
import { VMOperate } from "@/vm/operate"
import { VMWorkspace } from "@/vm/workspace"
import path from "path"
import z from "zod"

const Targets = z.union([z.string(), z.array(z.string()).min(1)])
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
