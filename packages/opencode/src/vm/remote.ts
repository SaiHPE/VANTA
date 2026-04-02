import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Snapshot } from "@/snapshot"
import { Database, NotFoundError, and, desc, eq } from "@/storage/db"
import { fn } from "@/util/fn"
import { git } from "@/util/git"
import { createInterface } from "readline"
import type { ClientChannel } from "ssh2"
import path from "path"
import fs from "fs/promises"
import z from "zod"
import { VM } from "./index"
import { VMSSH } from "./ssh"
import { VmJobTable, VmRemoteSessionTable } from "./vm.sql"
import { VMWorker } from "./worker"
import { VMWorkspace } from "./workspace"

export namespace VMRemote {
  export const JobLogs = z
    .object({
      id: Identifier.schema("vm_job"),
      status: VM.Job.shape.status,
      log: z.string(),
      timedOut: z.boolean().optional(),
    })
    .meta({
      ref: "VMJobLogs",
    })
  export type JobLogs = z.infer<typeof JobLogs>

  export const RemoteRead = z
    .object({
      output: z.string(),
    })
    .meta({
      ref: "VMRemoteRead",
    })
  export type RemoteRead = z.infer<typeof RemoteRead>

  export const RemoteGrep = z
    .object({
      output: z.string(),
      matches: z.number().int(),
    })
    .meta({
      ref: "VMRemoteGrep",
    })
  export type RemoteGrep = z.infer<typeof RemoteGrep>

  export const RemoteGlob = z
    .object({
      paths: z.array(z.string()),
    })
    .meta({
      ref: "VMRemoteGlob",
    })
  export type RemoteGlob = z.infer<typeof RemoteGlob>

  export const SessionOpenInput = z
    .object({
      sessionID: z.string(),
      vmID: Identifier.schema("vm"),
      baseDir: z.string().optional(),
      repoUrl: z.string().optional(),
      ref: z.string().optional(),
      sparsePaths: z.array(z.string()).optional(),
      cacheRoot: z.string().optional(),
      cacheDirs: z.array(z.string()).optional(),
    })
    .meta({
      ref: "VMRemoteSessionOpenInput",
    })

  export const SessionStatusInput = z
    .object({
      vmSessionID: Identifier.schema("vm_remote_session"),
    })
    .meta({
      ref: "VMRemoteSessionStatusInput",
    })

  export const SessionCloseInput = SessionStatusInput.meta({
    ref: "VMRemoteSessionCloseInput",
  })

  export const SyncInput = z
    .object({
      vmSessionID: Identifier.schema("vm_remote_session"),
      includeUntracked: z.boolean().default(false),
    })
    .meta({
      ref: "VMSyncInput",
    })

  export const JobStartInput = z
    .object({
      vmSessionID: Identifier.schema("vm_remote_session"),
      command: z.string().min(1),
      cwd: z.string().optional(),
    })
    .meta({
      ref: "VMJobStartInput",
    })

  export const JobLogsInput = z
    .object({
      vmJobID: Identifier.schema("vm_job"),
      tail: z.number().int().positive().optional(),
      follow: z.boolean().default(false),
    })
    .meta({
      ref: "VMJobLogsInput",
    })

  export const JobWaitInput = z
    .object({
      vmJobID: Identifier.schema("vm_job"),
      timeoutMs: z.number().int().positive().optional(),
    })
    .meta({
      ref: "VMJobWaitInput",
    })

  export const JobCancelInput = z
    .object({
      vmJobID: Identifier.schema("vm_job"),
    })
    .meta({
      ref: "VMJobCancelInput",
    })

  export const RemoteReadInput = z
    .object({
      vmSessionID: Identifier.schema("vm_remote_session"),
      path: z.string().optional(),
      offset: z.number().int().positive().optional(),
      limit: z.number().int().positive().optional(),
    })
    .meta({
      ref: "VMRemoteReadInput",
    })

  export const RemoteGrepInput = z
    .object({
      vmSessionID: Identifier.schema("vm_remote_session"),
      pattern: z.string().min(1),
      path: z.string().optional(),
      include: z.string().optional(),
    })
    .meta({
      ref: "VMRemoteGrepInput",
    })

  export const RemoteGlobInput = z
    .object({
      vmSessionID: Identifier.schema("vm_remote_session"),
      pattern: z.string().min(1),
      path: z.string().optional(),
    })
    .meta({
      ref: "VMRemoteGlobInput",
    })

  type Row = typeof VmRemoteSessionTable.$inferSelect
  type JobRow = typeof VmJobTable.$inferSelect

  type Wait = {
    resolve(value: any): void
    reject(reason?: unknown): void
  }

  type Transport = {
    id: string
    key: string
    vmID: string
    sessionID: string
    stream: ClientChannel
    calls: Map<string, Wait>
    ping?: ReturnType<typeof setInterval>
    closed: boolean
    ready: Promise<void>
    done: (status: VM.RemoteSession["status"]) => Promise<void>
  }

  function later<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  function key(sessionID: string, vmID: string) {
    return `${sessionID}\n${vmID}`
  }

  function quote(value: string) {
    return `'${value.replaceAll(`'`, `'\\''`)}'`
  }

  const state = Instance.state(
    () => ({
      remote: new Map<string, Transport>(),
    }),
    async (entry) => {
      await Promise.all([...entry.remote.values()].map((item) => item.done("closed")))
    },
  )

  function fromSession(row: Row) {
    return VM.RemoteSession.parse({
      id: row.id,
      vmID: row.vm_id,
      sessionID: row.session_id,
      status: row.status,
      workspaceDir: row.workspace_dir,
      workspaceRef: row.workspace_ref,
      workspaceRepo: row.workspace_repo,
      baseRef: row.base_ref,
      lastSyncHash: row.last_sync_hash ?? undefined,
      lastSyncAt: row.last_sync_at ?? undefined,
      runtime: row.runtime,
      workerVersion: row.worker_version,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    })
  }

  function fromJob(row: JobRow) {
    return VM.Job.parse({
      id: row.id,
      vmSessionID: row.vm_session_id,
      vmID: row.vm_id,
      status: row.status,
      command: row.command,
      cwd: row.cwd ?? undefined,
      pid: row.pid ?? undefined,
      startedAt: row.started_at ?? undefined,
      endedAt: row.ended_at ?? undefined,
      exitCode: row.exit_code ?? undefined,
      logDir: row.log_dir ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    })
  }

  function row(vmSessionID: string) {
    const item = Database.use((db) => db.select().from(VmRemoteSessionTable).where(eq(VmRemoteSessionTable.id, vmSessionID)).get())
    if (!item) throw new NotFoundError({ message: `VM remote session not found: ${vmSessionID}` })
    return item
  }

  function jobRow(vmJobID: string) {
    const item = Database.use((db) => db.select().from(VmJobTable).where(eq(VmJobTable.id, vmJobID)).get())
    if (!item) throw new NotFoundError({ message: `VM job not found: ${vmJobID}` })
    return item
  }

  async function sessionTransport(vmSessionID: string) {
    const item = fromSession(row(vmSessionID))
    const live = state().remote.get(key(item.sessionID, item.vmID))
    if (!live || live.closed) throw new Error("VM session transport is not active. Open a new vm_session first.")
    return {
      live,
      item,
    }
  }

  async function updateSession(input: {
    id: string
    status?: VM.RemoteSession["status"]
    lastSyncHash?: string | null
    lastSyncAt?: number | null
  }) {
    const next = Database.use((db) =>
      db
        .update(VmRemoteSessionTable)
        .set({
          ...(input.status ? { status: input.status } : {}),
          ...(input.lastSyncHash !== undefined ? { last_sync_hash: input.lastSyncHash } : {}),
          ...(input.lastSyncAt !== undefined ? { last_sync_at: input.lastSyncAt } : {}),
          time_updated: Date.now(),
        })
        .where(eq(VmRemoteSessionTable.id, input.id))
        .returning()
        .get(),
    )
    if (!next) throw new NotFoundError({ message: `VM remote session not found: ${input.id}` })
    return fromSession(next)
  }

  async function updateJob(input: {
    id: string
    status?: VM.Job["status"]
    pid?: number | null
    startedAt?: number | null
    endedAt?: number | null
    exitCode?: number | null
    logDir?: string | null
  }) {
    const next = Database.use((db) =>
      db
        .update(VmJobTable)
        .set({
          ...(input.status ? { status: input.status } : {}),
          ...(input.pid !== undefined ? { pid: input.pid } : {}),
          ...(input.startedAt !== undefined ? { started_at: input.startedAt } : {}),
          ...(input.endedAt !== undefined ? { ended_at: input.endedAt } : {}),
          ...(input.exitCode !== undefined ? { exit_code: input.exitCode } : {}),
          ...(input.logDir !== undefined ? { log_dir: input.logDir } : {}),
          time_updated: Date.now(),
        })
        .where(eq(VmJobTable.id, input.id))
        .returning()
        .get(),
    )
    if (!next) throw new NotFoundError({ message: `VM job not found: ${input.id}` })
    return fromJob(next)
  }

  function renderRead(result: any) {
    if (result.kind === "directory") {
      return [
        `<path>${result.path}</path>`,
        "<type>directory</type>",
        "<entries>",
        ...(result.entries as string[]),
        result.truncated ? `\n(Showing ${result.entries.length} of ${result.total} entries. Use offset=${result.next_offset} to continue.)` : `\n(${result.total} entries)`,
        "</entries>",
      ].join("\n")
    }
    return [
      `<path>${result.path}</path>`,
      "<type>file</type>",
      "<content>",
      ...(result.lines as string[]).map((line, idx) => `${(result.next_offset ?? (result.lines.length + 1)) - result.lines.length + idx}: ${line}`),
      result.truncated
        ? `\n(Showing lines ${(result.next_offset ?? (result.lines.length + 1)) - result.lines.length}-${(result.next_offset ?? (result.lines.length + 1)) - 1} of ${result.total}. Use offset=${result.next_offset} to continue.)`
        : `\n(End of file - total ${result.total} lines)`,
      "</content>",
    ].join("\n")
  }

  function renderGrep(items: Array<{ path: string; line: number; text: string }>) {
    if (items.length === 0) return { output: "No files found", matches: 0 }
    const out = [`Found ${items.length} matches`]
    let last = ""
    items.forEach((item) => {
      if (item.path !== last) {
        if (last) out.push("")
        last = item.path
        out.push(`${item.path}:`)
      }
      out.push(`  Line ${item.line}: ${item.text}`)
    })
    return {
      output: out.join("\n"),
      matches: items.length,
    }
  }

  function diff(input: { baseRef: string; includeUntracked: boolean }) {
    return git(["diff", "--name-status", "--no-renames", input.baseRef, "--", "."], {
      cwd: Instance.worktree,
    }).then(async (result) => {
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.toString().trim() || `Failed to diff local workspace against ${input.baseRef}`)
      }
      const files = result
        .text()
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [status = "", file = ""] = line.split("\t")
          return {
            status,
            file: file.replaceAll("\\", "/"),
          }
        })
      if (!input.includeUntracked) return files
      const extra = await git(["ls-files", "--others", "--exclude-standard", "--"], {
        cwd: Instance.worktree,
      })
      if (extra.exitCode !== 0) return files
      return [
        ...files,
        ...extra
          .text()
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((file) => ({
            status: "A",
            file: file.replaceAll("\\", "/"),
          })),
      ]
    })
  }

  async function rpc<T>(item: Transport, method: string, args?: Record<string, unknown>) {
    if (item.closed) throw new Error("VM session transport is closed")
    const id = Identifier.ascending("tool")
    const wait = later<T>()
    item.calls.set(id, wait)
    item.stream.write(JSON.stringify({ type: "call", id, method, args }) + "\n")
    return wait.promise.finally(() => item.calls.delete(id))
  }

  async function close(item: Transport, status: VM.RemoteSession["status"]) {
    if (item.closed) return
    item.closed = true
    if (item.ping) clearInterval(item.ping)
    state().remote.delete(item.key)
    item.calls.forEach((wait) => wait.reject(new Error("VM session transport closed")))
    item.calls.clear()
    item.stream.end()
    await updateSession({
      id: item.id,
      status,
    }).catch(() => undefined)
  }

  async function mount(input: {
    id: string
    vmID: string
    sessionID: string
    stream: ClientChannel
  }) {
    const hello = later<void>()
    const caps = later<void>()
    const value = {} as Transport
    value.id = input.id
    value.vmID = input.vmID
    value.sessionID = input.sessionID
    value.stream = input.stream
    value.key = key(input.sessionID, input.vmID)
    value.calls = new Map()
    value.closed = false
    value.ready = Promise.all([hello.promise, caps.promise]).then(() => undefined)
    value.done = (status) => close(value, status)
    const rl = createInterface({
      input: input.stream,
      crlfDelay: Infinity,
    })
    rl.on("line", (line) => {
      if (!line.trim()) return
      const msg = JSON.parse(line)
      if (msg.type === "hello") {
        hello.resolve()
        return
      }
      if (msg.type === "capabilities") {
        caps.resolve()
        return
      }
      if (msg.type === "heartbeat" || msg.type === "shutdown") return
      const wait = value.calls.get(msg.id)
      if (!wait) return
      if (msg.type === "result") {
        wait.resolve(msg.result)
        return
      }
      if (msg.type === "error") {
        wait.reject(new Error(String(msg.error || "remote worker failed")))
      }
    })
    input.stream.once("close", () => void close(value, "closed"))
    input.stream.once("error", () => void close(value, "error"))
    value.ping = setInterval(() => {
      if (value.closed) return
      value.stream.write(JSON.stringify({ type: "heartbeat", time: Date.now() }) + "\n")
    }, 15_000)
    state().remote.set(value.key, value)
    return value
  }

  export async function session(input: z.infer<typeof SessionStatusInput>) {
    return fromSession(row(input.vmSessionID))
  }

  export async function sessionClose(input: z.infer<typeof SessionCloseInput>) {
    const info = fromSession(row(input.vmSessionID))
    const live = state().remote.get(key(info.sessionID, info.vmID))
    if (live && !live.closed) {
      live.stream.write(JSON.stringify({ type: "shutdown" }) + "\n")
      await live.done("closed")
    }
    return updateSession({
      id: info.id,
      status: "closed",
    })
  }

  export async function sessionOpen(input: z.infer<typeof SessionOpenInput> & { abort?: AbortSignal }) {
    const vm = await VM.get(input.vmID)
    const current = state().remote.get(key(input.sessionID, vm.id))
    if (current && !current.closed) {
      return fromSession(row(current.id))
    }

    const conn = await VM.connect({
      sessionID: input.sessionID,
      vm,
      abort: input.abort,
    })
    const local = await VMWorkspace.local({
      repoUrl: !input.repoUrl && !vm.repoUrl,
      ref: !input.ref,
    })
    const baseDir = VMWorkspace.root({
      baseDir: input.baseDir,
      vm,
    })
    const repoUrl = VMWorkspace.repo({
      repoUrl: input.repoUrl,
      fallback: local.repoUrl,
      vm,
    })
    const ref = input.ref ?? local.ref ?? ""
    const cacheRoot = input.cacheRoot ?? vm.cacheRoot
    if ((input.cacheDirs?.length ?? 0) > 0 && !cacheRoot) {
      throw new Error("cache_root is required when cache_dirs are provided")
    }
    const workspace = await VMSSH.workspace({
      client: conn.client,
      baseDir,
      projectID: Instance.project.id,
      repoUrl,
      ref,
      sparsePaths: input.sparsePaths,
      cacheRoot,
      cacheDirs: input.cacheDirs,
    })
    const workerVersion = await VMWorker.version()
    const runtime = await VMSSH.runtime(conn.client)
    const shell = await VM.shell({ conn })
    const dir = path.posix.join(baseDir, Instance.project.id, ".opencode", "worker", workerVersion)
    const file = path.posix.join(dir, "worker.js")
    await VMSSH.upload({
      client: conn.client,
      dest: file,
      content: VMWorker.script({ version: workerVersion }),
      mode: "755",
      createDirs: true,
      sftp: VM.sftp({ conn }),
    })

    const latest = Database.use((db) =>
      db
        .select()
        .from(VmRemoteSessionTable)
        .where(and(eq(VmRemoteSessionTable.session_id, input.sessionID), eq(VmRemoteSessionTable.vm_id, vm.id)))
        .orderBy(desc(VmRemoteSessionTable.time_created))
        .get(),
    )
    const now = Date.now()
    const next = Database.use((db) =>
      latest
        ? db
            .update(VmRemoteSessionTable)
            .set({
              status: "open",
              workspace_dir: workspace.workspaceDir,
              workspace_ref: workspace.workspaceRef,
              workspace_repo: workspace.workspaceRepo,
              base_ref: workspace.workspaceRef,
              last_sync_hash: null,
              last_sync_at: null,
              runtime,
              worker_version: workerVersion,
              time_updated: now,
            })
            .where(eq(VmRemoteSessionTable.id, latest.id))
            .returning()
            .get()
        : db
            .insert(VmRemoteSessionTable)
            .values({
              id: Identifier.ascending("vm_remote_session"),
              vm_id: vm.id,
              session_id: input.sessionID,
              status: "open",
              workspace_dir: workspace.workspaceDir,
              workspace_ref: workspace.workspaceRef,
              workspace_repo: workspace.workspaceRepo,
              base_ref: workspace.workspaceRef,
              last_sync_hash: null,
              last_sync_at: null,
              runtime,
              worker_version: workerVersion,
              time_created: now,
              time_updated: now,
            })
            .returning()
            .get(),
    )
    if (!next) throw new Error("Failed to persist VM remote session")
    const live = await mount({
      id: next.id,
      vmID: vm.id,
      sessionID: input.sessionID,
      stream: await VMSSH.start({
        client: conn.client,
        command: `${runtime} ${quote(file)} --workspace ${quote(workspace.workspaceDir)}`,
        shell,
        abort: input.abort,
      }),
    })
    await live.ready
    return fromSession(next)
  }

  export const SessionOpen = fn(SessionOpenInput, sessionOpen)
  export const SessionStatus = fn(SessionStatusInput, session)
  export const SessionClose = fn(SessionCloseInput, sessionClose)

  export async function sync(input: z.infer<typeof SyncInput>) {
    const item = await sessionTransport(input.vmSessionID)
    const plan = await diff({
      baseRef: item.item.baseRef,
      includeUntracked: input.includeUntracked,
    })
    let uploaded = 0
    let deleted = 0
    let skipped = 0
    const files = [] as string[]
    for (const step of plan) {
      if (!step.file) continue
      files.push(step.file)
      if (step.status.startsWith("D")) {
        await rpc(item.live, "delete", { path: step.file })
        deleted += 1
        continue
      }
      const file = path.join(Instance.worktree, step.file)
      const stat = await fs.lstat(file).catch(() => undefined)
      if (!stat) {
        skipped += 1
        continue
      }
      if (stat.isSymbolicLink()) {
        await rpc(item.live, "write", {
          path: step.file,
          kind: "symlink",
          target: await fs.readlink(file),
        })
        uploaded += 1
        continue
      }
      if (!stat.isFile()) {
        skipped += 1
        continue
      }
      await rpc(item.live, "write", {
        path: step.file,
        data: Buffer.from(await Bun.file(file).bytes()).toString("base64"),
        encoding: "base64",
        mode: (stat.mode & 0o777).toString(8),
      })
      uploaded += 1
    }
    const hash = (await Snapshot.track()) ?? `sync-${Date.now()}`
    await updateSession({
      id: item.item.id,
      lastSyncHash: hash,
      lastSyncAt: Date.now(),
    })
    return VM.SyncStatus.parse({
      vmSessionID: item.item.id,
      vmID: item.item.vmID,
      hash,
      uploaded,
      deleted,
      skipped,
      files,
      time: Date.now(),
    })
  }

  export const Sync = fn(SyncInput, sync)

  export async function jobStart(input: z.infer<typeof JobStartInput>) {
    const item = await sessionTransport(input.vmSessionID)
    const id = Identifier.ascending("vm_job")
    const meta = await rpc<any>(item.live, "job.start", {
      id,
      command: input.command,
      cwd: input.cwd,
    })
    const now = Date.now()
    const row = Database.use((db) =>
      db
        .insert(VmJobTable)
        .values({
          id,
          vm_session_id: item.item.id,
          vm_id: item.item.vmID,
          status: meta.status,
          command: input.command,
          cwd: meta.cwd ?? input.cwd ?? null,
          pid: meta.pid ?? null,
          started_at: meta.started_at ?? now,
          ended_at: meta.ended_at ?? null,
          exit_code: meta.exit_code ?? null,
          log_dir: meta.log_dir ?? null,
          time_created: now,
          time_updated: now,
        })
        .returning()
        .get(),
    )
    if (!row) throw new Error("Failed to persist VM job")
    return fromJob(row)
  }

  export const JobStart = fn(JobStartInput, jobStart)

  export async function jobLogs(input: z.infer<typeof JobLogsInput>) {
    if (input.follow) throw new Error("follow is not supported yet for vm_job_logs")
    const row = jobRow(input.vmJobID)
    const item = await sessionTransport(row.vm_session_id)
    const result = await rpc<any>(item.live, "job.logs", {
      id: row.id,
      tail: input.tail,
    })
    return JobLogs.parse({
      id: row.id,
      status: result.status,
      log: result.log ?? "",
    })
  }

  export const JobLogsGet = fn(JobLogsInput, jobLogs)

  export async function jobWait(input: z.infer<typeof JobWaitInput>) {
    const row = jobRow(input.vmJobID)
    const item = await sessionTransport(row.vm_session_id)
    const result = await rpc<any>(item.live, "job.wait", {
      id: row.id,
      timeout_ms: input.timeoutMs,
    })
    const next = await updateJob({
      id: row.id,
      status: result.status,
      pid: result.pid ?? null,
      startedAt: result.started_at ?? row.started_at ?? null,
      endedAt: result.ended_at ?? null,
      exitCode: result.exit_code ?? null,
      logDir: result.log_dir ?? row.log_dir ?? null,
    })
    return input.timeoutMs && result.timed_out
      ? {
          ...next,
          timedOut: true,
        }
      : next
  }

  export const JobWait = fn(JobWaitInput, jobWait)

  export async function jobCancel(input: z.infer<typeof JobCancelInput>) {
    const row = jobRow(input.vmJobID)
    const item = await sessionTransport(row.vm_session_id)
    const result = await rpc<any>(item.live, "job.cancel", {
      id: row.id,
    })
    return updateJob({
      id: row.id,
      status: result.status === "running" ? "cancelled" : result.status,
    })
  }

  export const JobCancel = fn(JobCancelInput, jobCancel)

  export async function remoteRead(input: z.infer<typeof RemoteReadInput>) {
    const item = await sessionTransport(input.vmSessionID)
    const result = await rpc<any>(item.live, "read", {
      path: input.path,
      offset: input.offset,
      limit: input.limit,
    })
    return RemoteRead.parse({
      output: renderRead(result),
    })
  }

  export const ReadRemote = fn(RemoteReadInput, remoteRead)

  export async function remoteGrep(input: z.infer<typeof RemoteGrepInput>) {
    const item = await sessionTransport(input.vmSessionID)
    const result = await rpc<Array<{ path: string; line: number; text: string }>>(item.live, "grep", {
      pattern: input.pattern,
      path: input.path,
      include: input.include,
    })
    return RemoteGrep.parse(renderGrep(result))
  }

  export const GrepRemote = fn(RemoteGrepInput, remoteGrep)

  export async function remoteGlob(input: z.infer<typeof RemoteGlobInput>) {
    const item = await sessionTransport(input.vmSessionID)
    const paths = await rpc<string[]>(item.live, "glob", {
      pattern: input.pattern,
      path: input.path,
    })
    return RemoteGlob.parse({
      paths,
    })
  }

  export const GlobRemote = fn(RemoteGlobInput, remoteGlob)
}
