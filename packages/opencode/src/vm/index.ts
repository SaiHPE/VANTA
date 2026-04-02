import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Database, NotFoundError, and, desc, eq } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { fn } from "@/util/fn"
import { Question } from "@/question"
import z from "zod"
import { type Client, type SFTPWrapper } from "ssh2"
import { VMSSH } from "./ssh"
import { VmActivityTable, VmTable } from "./vm.sql"

export namespace VM {
  const IDLE = 5 * 60 * 1000

  export const AuthType = z.enum(["password", "private_key"]).meta({
    ref: "VMAuthType",
  })

  export const Facts = z
    .object({
      osName: z.string().optional(),
      osVersion: z.string().optional(),
      kernel: z.string().optional(),
      arch: z.string().optional(),
      shell: z.string().optional(),
      homeDir: z.string().optional(),
    })
    .meta({
      ref: "VMFacts",
    })
  export type Facts = z.infer<typeof Facts>

  export const Status = z.enum(["unknown", "ok", "error"]).meta({
    ref: "VMStatus",
  })

  export const Artifact = z
    .object({
      name: z.string(),
      mime: z.string(),
      url: z.string(),
    })
    .meta({
      ref: "VMArtifact",
    })
  export type Artifact = z.infer<typeof Artifact>

  export const Summary = z
    .object({
      id: Identifier.schema("vm"),
      projectID: z.string(),
      name: z.string(),
      hostname: z.string().optional(),
      ip: z.string().optional(),
      port: z.number().int(),
      username: z.string(),
      authType: AuthType,
      notes: z.string().optional(),
      workspaceRoot: z.string().optional(),
      repoUrl: z.string().optional(),
      cacheRoot: z.string().optional(),
      maxConcurrency: z.number().int().positive().optional(),
      weight: z.number().int().positive().optional(),
      retryCount: z.number().int().min(0).optional(),
      retryBackoffSecs: z.number().int().positive().optional(),
      facts: Facts.optional(),
      lastStatus: Status,
      lastSeenAt: z.number().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "VMSummary",
    })
  export type Summary = z.infer<typeof Summary>

  export const Detail = Summary.extend({
    password: z.string().optional(),
    privateKey: z.string().optional(),
    passphrase: z.string().optional(),
  }).meta({
    ref: "VMDetail",
  })
  export type Detail = z.infer<typeof Detail>

  export const RemoteSession = z
    .object({
      id: Identifier.schema("vm_remote_session"),
      vmID: Identifier.schema("vm"),
      sessionID: z.string(),
      status: z.enum(["open", "closed", "error"]),
      workspaceDir: z.string(),
      workspaceRef: z.string(),
      workspaceRepo: z.string(),
      baseRef: z.string(),
      lastSyncHash: z.string().optional(),
      lastSyncAt: z.number().optional(),
      runtime: z.enum(["bun", "node"]),
      workerVersion: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "VMRemoteSession",
    })
  export type RemoteSession = z.infer<typeof RemoteSession>

  export const Job = z
    .object({
      id: Identifier.schema("vm_job"),
      vmSessionID: Identifier.schema("vm_remote_session"),
      vmID: Identifier.schema("vm"),
      status: z.enum(["running", "completed", "failed", "cancelled"]),
      command: z.string(),
      cwd: z.string().optional(),
      pid: z.number().int().optional(),
      startedAt: z.number().optional(),
      endedAt: z.number().optional(),
      exitCode: z.number().int().optional(),
      logDir: z.string().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "VMJob",
    })
  export type Job = z.infer<typeof Job>

  export const SyncStatus = z
    .object({
      vmSessionID: Identifier.schema("vm_remote_session"),
      vmID: Identifier.schema("vm"),
      hash: z.string(),
      uploaded: z.number().int(),
      deleted: z.number().int(),
      skipped: z.number().int(),
      files: z.array(z.string()),
      time: z.number(),
    })
    .meta({
      ref: "VMSyncStatus",
    })
  export type SyncStatus = z.infer<typeof SyncStatus>

  export const Activity = z
    .object({
      id: Identifier.schema("vm_activity"),
      vmID: Identifier.schema("vm"),
      sessionID: z.string().optional(),
      messageID: z.string().optional(),
      partID: z.string().optional(),
      tool: z.string(),
      title: z.string(),
      status: z.enum(["running", "completed", "error"]),
      summary: z.string().optional(),
      exitCode: z.number().int().optional(),
      transcript: z.string().optional(),
      transcriptPath: z.string().optional(),
      artifacts: Artifact.array().optional(),
      startedAt: z.number(),
      endedAt: z.number().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "VMActivity",
    })
  export type Activity = z.infer<typeof Activity>

  const Draft = z
    .object({
      name: z.string(),
      hostname: z.string().optional(),
      ip: z.string().optional(),
      port: z.number().int().positive().optional(),
      username: z.string(),
      authType: AuthType,
      password: z.string().optional(),
      privateKey: z.string().optional(),
      passphrase: z.string().optional(),
      notes: z.string().optional(),
      workspaceRoot: z.string().optional(),
      repoUrl: z.string().optional(),
      cacheRoot: z.string().optional(),
      maxConcurrency: z.number().int().positive().optional(),
      weight: z.number().int().positive().optional(),
      retryCount: z.number().int().min(0).optional(),
      retryBackoffSecs: z.number().int().positive().optional(),
    })
    .meta({
      ref: "VMDraft",
    })

  export const Create = fn(Draft, async (input) => {
    const now = Date.now()
    const data = normalize(input)
    const result: Detail = {
      id: Identifier.ascending("vm"),
      projectID: Instance.project.id,
      lastStatus: "unknown",
      lastSeenAt: undefined,
      facts: undefined,
      time: {
        created: now,
        updated: now,
      },
      ...data,
    }
    Database.use((db) => {
      db.insert(VmTable)
        .values(toRow(result))
        .run()
      Database.effect(() => Bus.publish(Event.Created, summary(result)))
    })
    return result
  })

  export const Update = fn(
    Draft.partial().extend({
      vmID: Identifier.schema("vm"),
    }),
    async (input) => {
      const existing = await get(input.vmID)
      const data = normalize({
        ...existing,
        ...input,
      })
      const result: Detail = {
        ...existing,
        ...data,
        time: {
          ...existing.time,
          updated: Date.now(),
        },
      }
      Database.use((db) => {
        const row = db
          .update(VmTable)
          .set({
            name: result.name,
            hostname: result.hostname ?? null,
            ip: result.ip ?? null,
            port: result.port,
            username: result.username,
            auth_type: result.authType,
            password: result.password ?? null,
            private_key: result.privateKey ?? null,
            passphrase: result.passphrase ?? null,
            notes: result.notes ?? null,
            workspace_root: result.workspaceRoot ?? null,
            repo_url: result.repoUrl ?? null,
            cache_root: result.cacheRoot ?? null,
            max_concurrency: result.maxConcurrency ?? null,
            weight: result.weight ?? null,
            retry_count: result.retryCount ?? null,
            retry_backoff_secs: result.retryBackoffSecs ?? null,
            time_updated: result.time.updated,
          })
          .where(and(eq(VmTable.project_id, Instance.project.id), eq(VmTable.id, input.vmID)))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `VM not found: ${input.vmID}` })
        Database.effect(() => Bus.publish(Event.Updated, summary(fromRow(row))))
      })
      return result
    },
  )

  export const Delete = fn(Identifier.schema("vm"), async (vmID) => {
    const info = await get(vmID)
    Database.use((db) => {
      db.delete(VmTable)
        .where(and(eq(VmTable.project_id, Instance.project.id), eq(VmTable.id, vmID)))
        .run()
      Database.effect(() => Bus.publish(Event.Deleted, summary(info)))
    })
    const s = state()
    const prefix = "\n" + vmID
    for (const key of [...s.conn.keys()]) {
      if (!key.endsWith(prefix)) continue
      s.conn.get(key)?.client.end()
      s.conn.delete(key)
    }
    return true
  })

  export const Event = {
    Created: BusEvent.define("vm.created", Summary),
    Updated: BusEvent.define("vm.updated", Summary),
    Deleted: BusEvent.define("vm.deleted", Summary),
    ActivityCreated: BusEvent.define("vm.activity.created", Activity),
    ActivityUpdated: BusEvent.define("vm.activity.updated", Activity),
  }

  export type Connection = {
    client: Client
    host: string
    time: number
    shell?: "bash" | "sh"
    shelling?: Promise<"bash" | "sh">
    facts?: Facts
    learning?: Promise<Facts>
    sftp?: Promise<SFTPWrapper>
  }

  const state = Instance.state(
    () => ({
      confirmed: {} as Record<string, string[]>,
      conn: new Map<string, Connection>(),
    }),
    async (entry) => {
      for (const item of entry.conn.values()) {
        item.client.end()
      }
    },
  )

  function clean(value?: string | null) {
    const next = value?.trim()
    return next ? next : undefined
  }

  function normalize(input: z.input<typeof Draft> | (Partial<Detail> & { name: string; username: string; authType: Detail["authType"] })) {
    const name = clean(input.name)
    const username = clean(input.username)
    const hostname = clean(input.hostname)
    const ip = clean(input.ip)
    const password = clean(input.password)
    const privateKey = input.authType === "private_key" ? input.privateKey : undefined
    const passphrase = input.authType === "private_key" ? clean(input.passphrase) : undefined
    const notes = clean(input.notes)
    const workspaceRoot = clean(input.workspaceRoot)
    const repoUrl = clean(input.repoUrl)
    const cacheRoot = clean(input.cacheRoot)
    const maxConcurrency = input.maxConcurrency ?? undefined
    const weight = input.weight ?? undefined
    const retryCount = input.retryCount ?? undefined
    const retryBackoffSecs = input.retryBackoffSecs ?? undefined
    const port = input.port ?? 22

    if (!name) throw new Error("VM name is required")
    if (!username) throw new Error("VM username is required")
    if (!hostname && !ip) throw new Error("VM must include a hostname or ip address")
    if (input.authType === "password" && !password) throw new Error("VM password is required")
    if (input.authType === "private_key" && !clean(privateKey)) throw new Error("VM private key is required")

    return {
      name,
      hostname,
      ip,
      port,
      username,
      authType: input.authType,
      password: input.authType === "password" ? password : undefined,
      privateKey: input.authType === "private_key" ? clean(privateKey) : undefined,
      passphrase,
      notes,
      workspaceRoot,
      repoUrl,
      cacheRoot,
      maxConcurrency,
      weight,
      retryCount,
      retryBackoffSecs,
    } satisfies Omit<Detail, "id" | "projectID" | "facts" | "lastStatus" | "lastSeenAt" | "time">
  }

  function shape(input: {
    os_name?: string | null
    os_version?: string | null
    kernel?: string | null
    arch?: string | null
    shell?: string | null
    home_dir?: string | null
  }) {
    const value = {
      osName: clean(input.os_name),
      osVersion: clean(input.os_version),
      kernel: clean(input.kernel),
      arch: clean(input.arch),
      shell: clean(input.shell),
      homeDir: clean(input.home_dir),
    }
    if (Object.values(value).every((item) => !item)) return undefined
    return value
  }

  function summary(input: Detail | Summary) {
    return Summary.parse({
      id: input.id,
      projectID: input.projectID,
      name: input.name,
      hostname: input.hostname,
      ip: input.ip,
      port: input.port,
      username: input.username,
      authType: input.authType,
      notes: input.notes,
      workspaceRoot: input.workspaceRoot,
      repoUrl: input.repoUrl,
      cacheRoot: input.cacheRoot,
      maxConcurrency: input.maxConcurrency,
      weight: input.weight,
      retryCount: input.retryCount,
      retryBackoffSecs: input.retryBackoffSecs,
      facts: input.facts,
      lastStatus: input.lastStatus,
      lastSeenAt: input.lastSeenAt,
      time: input.time,
    })
  }

  function toRow(input: Detail) {
    return {
      id: input.id,
      project_id: input.projectID,
      name: input.name,
      hostname: input.hostname ?? null,
      ip: input.ip ?? null,
      port: input.port,
      username: input.username,
      auth_type: input.authType,
      password: input.password ?? null,
      private_key: input.privateKey ?? null,
      passphrase: input.passphrase ?? null,
      notes: input.notes ?? null,
      workspace_root: input.workspaceRoot ?? null,
      repo_url: input.repoUrl ?? null,
      cache_root: input.cacheRoot ?? null,
      max_concurrency: input.maxConcurrency ?? null,
      weight: input.weight ?? null,
      retry_count: input.retryCount ?? null,
      retry_backoff_secs: input.retryBackoffSecs ?? null,
      os_name: input.facts?.osName ?? null,
      os_version: input.facts?.osVersion ?? null,
      kernel: input.facts?.kernel ?? null,
      arch: input.facts?.arch ?? null,
      shell: input.facts?.shell ?? null,
      home_dir: input.facts?.homeDir ?? null,
      last_status: input.lastStatus,
      last_seen_at: input.lastSeenAt ?? null,
      time_created: input.time.created,
      time_updated: input.time.updated,
    }
  }

  function fromRow(row: typeof VmTable.$inferSelect): Detail {
    return {
      id: row.id,
      projectID: row.project_id,
      name: row.name,
      hostname: row.hostname ?? undefined,
      ip: row.ip ?? undefined,
      port: row.port,
      username: row.username,
      authType: AuthType.parse(row.auth_type),
      password: row.password ?? undefined,
      privateKey: row.private_key ?? undefined,
      passphrase: row.passphrase ?? undefined,
      notes: row.notes ?? undefined,
      workspaceRoot: row.workspace_root ?? undefined,
      repoUrl: row.repo_url ?? undefined,
      cacheRoot: row.cache_root ?? undefined,
      maxConcurrency: row.max_concurrency ?? undefined,
      weight: row.weight ?? undefined,
      retryCount: row.retry_count ?? undefined,
      retryBackoffSecs: row.retry_backoff_secs ?? undefined,
      facts: shape(row),
      lastStatus: Status.parse(row.last_status),
      lastSeenAt: row.last_seen_at ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }
  }

  function fromActivity(row: typeof VmActivityTable.$inferSelect): Activity {
    return {
      id: row.id,
      vmID: row.vm_id,
      sessionID: row.session_id ?? undefined,
      messageID: row.message_id ?? undefined,
      partID: row.part_id ?? undefined,
      tool: row.tool,
      title: row.title,
      status: Activity.shape.status.parse(row.status),
      summary: row.summary ?? undefined,
      exitCode: row.exit_code ?? undefined,
      transcript: row.transcript ?? undefined,
      transcriptPath: row.transcript_path ?? undefined,
      artifacts: row.artifacts ?? undefined,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }
  }

  export async function list() {
    return Database.use((db) =>
      db
        .select()
        .from(VmTable)
        .where(eq(VmTable.project_id, Instance.project.id))
        .orderBy(VmTable.id)
        .all()
        .map((row) => summary(fromRow(row))),
    )
  }

  export async function get(vmID: string) {
    const row = Database.use((db) =>
      db
        .select()
        .from(VmTable)
        .where(and(eq(VmTable.project_id, Instance.project.id), eq(VmTable.id, vmID)))
        .get(),
    )
    if (!row) throw new NotFoundError({ message: `VM not found: ${vmID}` })
    return fromRow(row)
  }

  export async function activity(vmID: string) {
    await get(vmID)
    return Database.use((db) =>
      db
        .select()
        .from(VmActivityTable)
        .where(eq(VmActivityTable.vm_id, vmID))
        .orderBy(desc(VmActivityTable.started_at), desc(VmActivityTable.id))
        .all()
        .map(fromActivity),
    )
  }

  function auth(vm: Detail) {
    return {
      hostname: vm.hostname,
      ip: vm.ip,
      port: vm.port,
      username: vm.username,
      authType: vm.authType,
      password: vm.password,
      privateKey: vm.privateKey,
      passphrase: vm.passphrase,
    } satisfies VMSSH.Auth
  }

  async function updateProbe(input: {
    vmID: string
    lastStatus: Detail["lastStatus"]
    lastSeenAt: number
    facts?: Facts
  }) {
    const row = Database.use((db) =>
      db
        .update(VmTable)
        .set({
          os_name: input.facts?.osName ?? null,
          os_version: input.facts?.osVersion ?? null,
          kernel: input.facts?.kernel ?? null,
          arch: input.facts?.arch ?? null,
          shell: input.facts?.shell ?? null,
          home_dir: input.facts?.homeDir ?? null,
          last_status: input.lastStatus,
          last_seen_at: input.lastSeenAt,
          time_updated: Date.now(),
        })
        .where(and(eq(VmTable.project_id, Instance.project.id), eq(VmTable.id, input.vmID)))
        .returning()
        .get(),
    )
    if (!row) throw new NotFoundError({ message: `VM not found: ${input.vmID}` })
    const info = summary(fromRow(row))
    Database.effect(() => Bus.publish(Event.Updated, info))
    return info
  }

  export async function facts(input: {
    conn: Connection
    vmID: string
  }) {
    if (input.conn.facts) return input.conn.facts
    if (!input.conn.learning) {
      input.conn.learning = VMSSH.facts(input.conn.client)
        .then(async (facts) => {
          input.conn.facts = facts
          await updateProbe({
            vmID: input.vmID,
            lastStatus: "ok",
            lastSeenAt: Date.now(),
            facts,
          }).catch(() => undefined)
          return facts
        })
        .catch(async (err) => {
          await updateProbe({
            vmID: input.vmID,
            lastStatus: "ok",
            lastSeenAt: Date.now(),
          }).catch(() => undefined)
          throw err
        })
        .finally(() => {
          input.conn.learning = undefined
        })
    }
    return input.conn.learning
  }

  export async function shell(input: {
    conn: Connection
  }) {
    if (input.conn.shell) return input.conn.shell
    if (!input.conn.shelling) {
      input.conn.shelling = VMSSH.shell(input.conn.client).then((shell) => {
        input.conn.shell = shell
        return shell
      }).finally(() => {
        input.conn.shelling = undefined
      })
    }
    return input.conn.shelling
  }

  export function sftp(input: {
    conn: Connection
  }) {
    if (!input.conn.sftp) input.conn.sftp = VMSSH.sftp(input.conn.client)
    return input.conn.sftp
  }

  export async function testDraft(input: z.input<typeof Draft>) {
    const now = Date.now()
    const data = normalize(input)
    const info: Detail = {
      id: "vm_draft",
      projectID: Instance.project.id,
      lastStatus: "unknown",
      lastSeenAt: undefined,
      facts: undefined,
      time: {
        created: now,
        updated: now,
      },
      ...data,
    }
    const { client } = await VMSSH.connect({ auth: auth(info) })
    try {
      const next = await VMSSH.facts(client)
      return {
        ...info,
        facts: next,
        lastStatus: "ok" as const,
        lastSeenAt: Date.now(),
      }
    } finally {
      await VMSSH.end(client)
    }
  }

  export async function test(vmID: string) {
    const vm = await get(vmID)
    const { client } = await VMSSH.connect({ auth: auth(vm) })
    try {
      const next = await VMSSH.facts(client)
      await updateProbe({
        vmID,
        lastStatus: "ok",
        lastSeenAt: Date.now(),
        facts: next,
      })
      return {
        ...vm,
        facts: next,
        lastStatus: "ok" as const,
        lastSeenAt: Date.now(),
      }
    } catch (err) {
      await updateProbe({
        vmID,
        lastStatus: "error",
        lastSeenAt: Date.now(),
      }).catch(() => undefined)
      throw err
    } finally {
      await VMSSH.end(client)
    }
  }

  export async function connect(input: {
    sessionID: string
    vm: Detail
    abort?: AbortSignal
  }) {
    const key = `${input.sessionID}\n${input.vm.id}`
    const current = state().conn.get(key)
    if (current && Date.now() - current.time < IDLE) {
      current.time = Date.now()
      return current
    }
    if (current) {
      current.client.end()
      state().conn.delete(key)
    }

    try {
      const next = await VMSSH.connect({
        auth: auth(input.vm),
        abort: input.abort,
      })
      const value: Connection = {
        ...next,
        time: Date.now(),
      }
      state().conn.set(key, value)
      await facts({
        conn: value,
        vmID: input.vm.id,
      }).catch(() => undefined)
      return value
    } catch (err) {
      await updateProbe({
        vmID: input.vm.id,
        lastStatus: "error",
        lastSeenAt: Date.now(),
      }).catch(() => undefined)
      throw err
    }
  }

  export function clearTargets(sessionID: string) {
    delete state().confirmed[sessionID]
  }

  function one(query: string, items: Detail[]) {
    const exact = items.filter((item) => [item.id, item.name, item.hostname, item.ip].includes(query))
    if (exact.length > 0) return exact
    const lower = query.toLowerCase()
    const name = items.filter((item) => item.name.toLowerCase() === lower)
    if (name.length > 0) return name
    return items.filter((item) =>
      [item.name, item.hostname, item.ip].some((value) => value?.toLowerCase().includes(lower)),
    )
  }

  export async function resolve(targets?: string | string[]) {
    const items = await all()
    if (!targets || (Array.isArray(targets) && targets.length === 0)) {
      return {
        items,
        matches: [] as Array<{ query: string; items: Detail[] }>,
        ambiguous: false,
      }
    }

    const list = (Array.isArray(targets) ? targets : [targets]).map((item) => item.trim()).filter(Boolean)
    const matches = list.map((query) => ({
      query,
      items: uniq(one(query, items)),
    }))
    const empty = matches.find((item) => item.items.length === 0)
    if (empty) throw new Error(`No VM matched "${empty.query}"`)

    return {
      items: uniq(matches.flatMap((item) => item.items)),
      matches,
      ambiguous: matches.some((item) => item.items.length > 1),
    }
  }

  async function all() {
    return Database.use((db) =>
      db
        .select()
        .from(VmTable)
        .where(eq(VmTable.project_id, Instance.project.id))
        .orderBy(VmTable.id)
        .all()
        .map(fromRow),
    )
  }

  function uniq<T extends { id: string }>(items: T[]) {
    return items.filter((item, idx) => items.findIndex((other) => other.id === item.id) === idx)
  }

  function key(ids: string[]) {
    return ids.slice().sort().join(",")
  }

  export async function confirm(input: {
    sessionID: string
    targets: string | string[]
    tool?: { messageID: string; callID: string }
  }) {
    const match = await resolve(input.targets)
    const ids = match.items.map((item) => item.id)
    const current = state().confirmed[input.sessionID]
    if (current && key(current) === key(ids)) return match.items

    const labels = new Map<string, Detail>()
    const options = match.items.map((item, idx) => {
      const label = `${idx + 1}. ${item.name}`
      labels.set(label, item)
      return {
        label,
        description: [item.hostname, item.ip, item.username].filter(Boolean).join(" "),
      }
    })

    const answers = await Question.ask({
      sessionID: input.sessionID,
      tool: input.tool,
      questions: [
        {
          header: "VMs",
          question: match.ambiguous
            ? "Select the VM targets to use for this execution."
            : "Confirm the VM targets for this execution.",
          options,
          multiple: true,
          custom: false,
        },
      ],
    })

    const selected = (answers[0] ?? []).map((item) => labels.get(item)).filter((item): item is Detail => !!item)
    if (selected.length === 0) throw new Error("No VM targets were confirmed")
    state().confirmed[input.sessionID] = selected.map((item) => item.id)
    return selected
  }

  export async function context(input: { agent: string; text: string }) {
    const list = await all()
    if (list.length === 0) return
    const lower = input.text.toLowerCase()
    const matches = list.filter((item) =>
      [item.name, item.hostname, item.ip].some((value) => value && lower.includes(value.toLowerCase())),
    )
    if (matches.length === 0 && input.agent !== "execute") return
    const lines = [
      `Registered VMs in this project: ${list.length}.`,
      `Use vm_list to inspect the inventory and the vm_* tools for remote operations.`,
    ]
    if (matches.length > 0) {
      lines.push("Matched VM candidates from the latest user message:")
      lines.push(
        ...matches.map((item) =>
          [
            `- ${item.name}`,
            item.hostname ? `hostname=${item.hostname}` : "",
            item.ip ? `ip=${item.ip}` : "",
            `user=${item.username}`,
            `status=${item.lastStatus}`,
          ]
            .filter(Boolean)
            .join(" "),
        ),
      )
    }
    lines.push("VM tools will ask the user to confirm targets before the first remote action in a session.")
    return lines.join("\n")
  }

  async function part(messageID: string, callID?: string) {
    if (!callID) return undefined
    const items = await MessageV2.parts(messageID)
    return items.find((item) => item.type === "tool" && item.callID === callID)?.id
  }

  export async function activityStart(input: {
    vmID: string
    sessionID?: string
    messageID?: string
    callID?: string
    tool: string
    title: string
    summary?: string
  }) {
    const now = Date.now()
    const result: Activity = {
      id: Identifier.ascending("vm_activity"),
      vmID: input.vmID,
      sessionID: input.sessionID,
      messageID: input.messageID,
      partID: input.messageID ? await part(input.messageID, input.callID) : undefined,
      tool: input.tool,
      title: input.title,
      status: "running",
      summary: input.summary,
      transcript: undefined,
      transcriptPath: undefined,
      artifacts: undefined,
      exitCode: undefined,
      startedAt: now,
      endedAt: undefined,
      time: {
        created: now,
        updated: now,
      },
    }
    Database.use((db) => {
      db.insert(VmActivityTable)
        .values({
          id: result.id,
          vm_id: result.vmID,
          session_id: result.sessionID ?? null,
          message_id: result.messageID ?? null,
          part_id: result.partID ?? null,
          tool: result.tool,
          title: result.title,
          status: result.status,
          summary: result.summary ?? null,
          exit_code: result.exitCode ?? null,
          transcript: result.transcript ?? null,
          transcript_path: result.transcriptPath ?? null,
          artifacts: result.artifacts,
          started_at: result.startedAt,
          ended_at: result.endedAt ?? null,
          time_created: result.time.created,
          time_updated: result.time.updated,
        })
        .run()
      Database.effect(() => Bus.publish(Event.ActivityCreated, result))
    })
    return result
  }

  export async function activityFinish(input: {
    activityID: string
    status: Activity["status"]
    summary?: string
    exitCode?: number
    transcript?: string
    transcriptPath?: string
    artifacts?: Artifact[]
  }) {
    const row = Database.use((db) =>
      db
        .update(VmActivityTable)
        .set({
          status: input.status,
          summary: input.summary ?? null,
          exit_code: input.exitCode ?? null,
          transcript: input.transcript ?? null,
          transcript_path: input.transcriptPath ?? null,
          artifacts: input.artifacts,
          ended_at: Date.now(),
          time_updated: Date.now(),
        })
        .where(eq(VmActivityTable.id, input.activityID))
        .returning()
        .get(),
    )
    if (!row) throw new NotFoundError({ message: `VM activity not found: ${input.activityID}` })
    const info = fromActivity(row)
    Database.effect(() => Bus.publish(Event.ActivityUpdated, info))
    return info
  }
}
