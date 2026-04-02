import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Question } from "@/question"
import { Session } from "@/session"
import { Filesystem } from "@/util/filesystem"
import { Database, desc, eq } from "@/storage/db"
import { RunbookRunTable, RunbookStepTable } from "./runbook.sql"
import * as RunbookSchema from "./schema"
import { VM } from "@/vm"
import { VMSSH } from "@/vm/ssh"
import { VMOperate } from "@/vm/operate"
import { VMWorkspace } from "@/vm/workspace"
import { Instance } from "@/project/instance"
import path from "path"
import z from "zod"

export namespace Runbook {
  export import Schema = RunbookSchema

  type RunRow = typeof RunbookRunTable.$inferSelect
  type StepRow = typeof RunbookStepTable.$inferSelect
  type Step = z.infer<typeof Schema.Step>
  type WriteStep =
    | Extract<Step, { kind: "upload" }>
    | Extract<Step, { kind: "exec"; intent: "write" }>
    | Extract<Step, { kind: "workspace_prepare" }>

  export const Event = {
    RunUpdated: BusEvent.define(
      "runbook.run.updated",
      z.object({
        sessionID: z.string(),
        run: Schema.Run,
      }),
    ),
    StepUpdated: BusEvent.define(
      "runbook.step.updated",
      z.object({
        sessionID: z.string(),
        step: Schema.StepRecord,
      }),
    ),
  }

  function fromRunRow(row: RunRow) {
    return Schema.Run.parse({
      id: row.id,
      sessionID: row.session_id,
      messageID: row.message_id ?? undefined,
      path: row.path,
      status: row.status,
      stepIdx: row.step_idx,
      bindings: row.bindings ?? {},
      facts: row.facts ?? {},
      approval: row.approval ?? {},
      sourceBundle: row.source_bundle ?? [],
      pauseReason: row.pause_reason ?? undefined,
      error: row.error ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        started: row.time_started ?? undefined,
        ended: row.time_ended ?? undefined,
      },
    })
  }

  function fromStepRow(row: StepRow) {
    return Schema.StepRecord.parse({
      id: row.id,
      runID: row.run_id,
      sessionID: row.session_id,
      stepID: row.step_id,
      stepIdx: row.step_idx,
      kind: row.kind,
      title: row.title,
      attempt: row.attempt,
      status: row.status,
      summary: row.summary ?? undefined,
      outputPreview: row.output_preview ?? undefined,
      vmActivityIDs: row.vm_activity_ids ?? {},
      artifacts: row.artifacts ?? [],
      error: row.error ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        started: row.time_started ?? undefined,
        ended: row.time_ended ?? undefined,
      },
    })
  }

  function present(state: z.infer<typeof Schema.SessionState>) {
    const plan = state.plan
    const run = state.run
    const step = run ? state.steps.find((item) => item.stepIdx === run.stepIdx) : undefined
    const parts = [
      `runbook_path: ${state.path}`,
      `exists: ${state.exists ? "yes" : "no"}`,
      plan ? `title: ${plan.title}` : "",
      plan ? `steps: ${plan.steps.length}` : "",
      run ? `run_status: ${run.status}` : "run_status: idle",
      step ? `current_step: ${step.title}` : "",
      run?.pauseReason ? `pause_reason: ${run.pauseReason}` : "",
      run?.error ? `error: ${run.error}` : "",
    ].filter(Boolean)
    return parts.join("\n")
  }

  async function publishRun(run: z.infer<typeof Schema.Run>) {
    await Bus.publish(Event.RunUpdated, {
      sessionID: run.sessionID,
      run,
    })
  }

  async function publishStep(step: z.infer<typeof Schema.StepRecord>) {
    await Bus.publish(Event.StepUpdated, {
      sessionID: step.sessionID,
      step,
    })
  }

  async function planPath(sessionID: string) {
    const session = await Session.get(sessionID)
    return Session.plan(session)
  }

  async function loadPlan(sessionID: string) {
    const path = await planPath(sessionID)
    const exists = await Filesystem.exists(path)
    if (!exists) return { path, exists: false as const }
    const raw = await Bun.file(path).text()
    const plan = Schema.parse({ content: raw, path })
    return { path, exists: true as const, raw, plan }
  }

  function latestRunRow(sessionID: string) {
    return Database.use((db) =>
      db
        .select()
        .from(RunbookRunTable)
        .where(eq(RunbookRunTable.session_id, sessionID))
        .orderBy(desc(RunbookRunTable.time_created))
        .get(),
    )
  }

  function listStepRows(runID: string) {
    return Database.use((db) =>
      db.select().from(RunbookStepTable).where(eq(RunbookStepTable.run_id, runID)).orderBy(RunbookStepTable.step_idx).all(),
    )
  }

  function isWrite(step: Step): step is WriteStep {
    if (step.kind === "exec") return step.intent === "write"
    if (step.kind === "upload") return true
    if (step.kind === "workspace_prepare") return true
    return false
  }

  function verifyOutput(input: {
    step: Extract<z.infer<typeof Schema.Step>, { kind: "exec" }>
    raw: string[]
    stderr: string[]
    facts: Record<string, string>
  }) {
    const verify = input.step.verify
    const text = input.raw.join("\n\n")
    const err = input.stderr.join("\n\n")
    for (const item of verify?.stdout_contains ?? []) {
      if (!text.includes(item)) return { ok: false, message: `stdout is missing "${item}"` }
    }
    for (const item of verify?.stderr_not_contains ?? []) {
      if (err.includes(item)) return { ok: false, message: `stderr contains "${item}"` }
    }
    for (const item of verify?.facts_present ?? []) {
      if (!input.facts[item]) return { ok: false, message: `fact "${item}" is missing` }
    }
    return { ok: true as const }
  }

  function render(input: string, facts: Record<string, string>) {
    const missing = new Set<string>()
    const value = input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_all, raw) => {
      const key = String(raw).trim()
      const match = facts[key]
      if (match === undefined) {
        missing.add(key)
        return ""
      }
      return match
    })
    return {
      value,
      missing: [...missing],
    }
  }

  function resolveNeeds(step: Step, facts: Record<string, string>) {
    if (step.kind === "question") return []
    return step.needs.filter((item) => !facts[item])
  }

  async function updateRun(input: {
    runID: string
    status?: z.infer<typeof Schema.RunStatus>
    stepIdx?: number
    bindings?: Record<string, string[]>
    facts?: Record<string, string>
    approval?: { confirmed?: boolean; roles?: Record<string, string[]> }
    pauseReason?: z.infer<typeof Schema.PauseReason> | null
    error?: string | null
    started?: number | null
    ended?: number | null
  }) {
    const row = Database.use((db) =>
      db
        .update(RunbookRunTable)
        .set({
          ...(input.status ? { status: input.status } : {}),
          ...(input.stepIdx !== undefined ? { step_idx: input.stepIdx } : {}),
          ...(input.bindings ? { bindings: input.bindings } : {}),
          ...(input.facts ? { facts: input.facts } : {}),
          ...(input.approval ? { approval: input.approval } : {}),
          ...(input.pauseReason !== undefined ? { pause_reason: input.pauseReason ?? null } : {}),
          ...(input.error !== undefined ? { error: input.error ?? null } : {}),
          ...(input.started !== undefined ? { time_started: input.started ?? null } : {}),
          ...(input.ended !== undefined ? { time_ended: input.ended ?? null } : {}),
          time_updated: Date.now(),
        })
        .where(eq(RunbookRunTable.id, input.runID))
        .returning()
        .get(),
    )
    if (!row) throw new Error(`Runbook run not found: ${input.runID}`)
    const run = fromRunRow(row)
    await publishRun(run)
    return run
  }

  async function updateStep(input: {
    id: string
    attempt?: number
    status?: z.infer<typeof Schema.StepStatus>
    summary?: string | null
    outputPreview?: string | null
    vmActivityIDs?: Record<string, string>
    artifacts?: VM.Artifact[]
    error?: string | null
    started?: number | null
    ended?: number | null
  }) {
    const row = Database.use((db) =>
      db
        .update(RunbookStepTable)
        .set({
          ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.summary !== undefined ? { summary: input.summary ?? null } : {}),
          ...(input.outputPreview !== undefined ? { output_preview: input.outputPreview ?? null } : {}),
          ...(input.vmActivityIDs ? { vm_activity_ids: input.vmActivityIDs } : {}),
          ...(input.artifacts ? { artifacts: input.artifacts } : {}),
          ...(input.error !== undefined ? { error: input.error ?? null } : {}),
          ...(input.started !== undefined ? { time_started: input.started ?? null } : {}),
          ...(input.ended !== undefined ? { time_ended: input.ended ?? null } : {}),
          time_updated: Date.now(),
        })
        .where(eq(RunbookStepTable.id, input.id))
        .returning()
        .get(),
    )
    if (!row) throw new Error(`Runbook step not found: ${input.id}`)
    const step = fromStepRow(row)
    await publishStep(step)
    return step
  }

  async function bindRoles(input: {
    sessionID: string
    plan: z.infer<typeof Schema.Document>
    run: z.infer<typeof Schema.Run>
    messageID?: string
    callID?: string
  }) {
    const roles = [
      ...new Set(
        input.plan.steps.flatMap((step) => {
          if (!isWrite(step)) return []
          if (step.targets.type !== "roles") return []
          return step.targets.roles
        }),
      ),
    ]
    if (roles.length === 0) return input.run

    const cached = roles.every((role) => (input.run.bindings[role] ?? []).length > 0)
    if (cached && input.run.approval.confirmed) return input.run

    const questions = await Promise.all(
      roles.map(async (name) => {
        const role = input.plan.roles[name]
        if (!role) throw new Error(`Runbook role not found: ${name}`)
        const match = await VM.resolve(role.match)
        const labels = new Map<string, string>()
        const options = match.items.map((item, idx) => {
          const label = `${idx + 1}. ${item.name}`
          labels.set(label, item.id)
          return {
            label,
            description: [item.hostname, item.ip, item.username].filter(Boolean).join(" "),
          }
        })
        return {
          labels,
          info: {
            header: name,
            question: `Select the VM targets for role "${name}".`,
            options,
            multiple: role.max === undefined || role.max > 1 || role.min > 1,
            custom: false,
          },
          role,
          name,
        }
      }),
    )

    const answers = await Question.ask({
      sessionID: input.sessionID,
      tool: input.callID && input.messageID ? { messageID: input.messageID, callID: input.callID } : undefined,
      questions: questions.map((item) => item.info),
    })

    const bindings = { ...input.run.bindings }
    for (const [idx, item] of questions.entries()) {
      const selected = (answers[idx] ?? []).map((label) => item.labels.get(label)).filter((value): value is string => !!value)
      if (selected.length < item.role.min) {
        return updateRun({
          runID: input.run.id,
          status: "paused",
          pauseReason: "binding",
          error: `Role "${item.name}" requires at least ${item.role.min} target(s)`,
        })
      }
      if (item.role.max !== undefined && selected.length > item.role.max) {
        return updateRun({
          runID: input.run.id,
          status: "paused",
          pauseReason: "binding",
          error: `Role "${item.name}" accepts at most ${item.role.max} target(s)`,
        })
      }
      bindings[item.name] = selected
    }

    return updateRun({
      runID: input.run.id,
      bindings,
      approval: {
        confirmed: true,
        roles: bindings,
      },
      pauseReason: null,
      error: null,
    })
  }

  async function collectInputs(input: {
    sessionID: string
    plan: z.infer<typeof Schema.Document>
    run: z.infer<typeof Schema.Run>
    messageID?: string
    callID?: string
  }) {
    const items = input.plan.inputs.filter((item) => item.required && !input.run.facts[item.name])
    if (items.length === 0) return input.run

    const answers = await Question.ask({
      sessionID: input.sessionID,
      tool: input.callID && input.messageID ? { messageID: input.messageID, callID: input.callID } : undefined,
      questions: items.map((item) => ({
        header: item.name,
        question: item.prompt,
        options: item.default ? [{ label: item.default, description: "Use default value" }] : [],
        multiple: false,
        custom: true,
      })),
    })

    const facts = { ...input.run.facts }
    for (const [idx, item] of items.entries()) {
      const value = (answers[idx] ?? [])[0]?.trim()
      if (!value) {
        return updateRun({
          runID: input.run.id,
          status: "paused",
          pauseReason: "question",
          error: `Input "${item.name}" is required`,
        })
      }
      facts[item.name] = value
    }

    return updateRun({
      runID: input.run.id,
      facts,
      pauseReason: null,
      error: null,
    })
  }

  async function resolveTargets(input: {
    step: z.infer<typeof Schema.Step>
    run: z.infer<typeof Schema.Run>
  }) {
    if (input.step.kind === "question") return []
    const targets = input.step.targets
    if (targets.type === "all") return VM.resolve().then((item) => item.items)
    if (targets.type === "match") return VM.resolve(targets.match).then((item) => item.items)
    const ids = targets.roles.flatMap((name) => input.run.bindings[name] ?? [])
    if (ids.length === 0) {
      throw new Error(`No bound targets for roles: ${targets.roles.join(", ")}`)
    }
    return Promise.all(ids.map((id) => VM.get(id)))
  }

  async function applyCapture(input: {
    step: Extract<z.infer<typeof Schema.Step>, { kind: "exec" }>
    facts: Record<string, string>
    result: VMOperate.Result<Awaited<ReturnType<typeof VMSSH.exec>>>
  }) {
    if (input.step.capture !== "json") return input.facts
    const next = { ...input.facts }
    for (const item of input.result.results) {
      if (item.status !== "completed") continue
      const value = item.value
      if (!value) continue
      const text = value.stdout.trim()
      if (!text) continue
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Step "${input.step.id}" capture=json requires stdout to be a JSON object`)
      }
      for (const [key, value] of Object.entries(parsed)) {
        if (value === undefined || value === null) continue
        next[key] = typeof value === "string" ? value : JSON.stringify(value)
      }
    }
    return next
  }

  function fault<T>(result: VMOperate.Result<T>) {
    return result.results.find((item) => item.status === "error")
  }

  function unique(values: string[]) {
    return [...new Set(values.filter(Boolean))]
  }

  async function stop(input: {
    runID: string
    row: z.infer<typeof Schema.StepRecord>
    message: string
    facts?: Record<string, string>
    result?: VMOperate.Result<unknown>
    status?: "paused" | "failed"
    reason?: z.infer<typeof Schema.PauseReason>
  }) {
    await updateStep({
      id: input.row.id,
      status: input.status ?? "paused",
      summary: input.message,
      outputPreview: input.result?.output,
      vmActivityIDs: input.result?.metadata.activity_ids,
      artifacts: input.result?.metadata.artifacts ?? [],
      error: input.message,
      ended: Date.now(),
    })
    return updateRun({
      runID: input.runID,
      status: input.status ?? "paused",
      pauseReason: input.reason ?? "error",
      error: input.message,
      facts: input.facts,
      stepIdx: input.row.stepIdx,
      ended: input.status === "failed" ? Date.now() : undefined,
    })
  }

  async function runStep(input: {
    ctx: VMOperate.Context
    plan: z.infer<typeof Schema.Document>
    run: z.infer<typeof Schema.Run>
    row: z.infer<typeof Schema.StepRecord>
  }) {
    const step = input.plan.steps[input.row.stepIdx]
    const attempt = input.row.attempt + 1
    await updateStep({
      id: input.row.id,
      attempt,
      status: "running",
      started: Date.now(),
      ended: null,
      error: null,
    })

    const needs = resolveNeeds(step, input.run.facts)
    if (needs.length > 0) {
      return stop({
        runID: input.run.id,
        row: input.row,
        message: `Missing facts for step "${step.title}": ${needs.join(", ")}`,
        reason: "missing_fact",
      })
    }

    if (step.kind === "question") {
      const answers = await Question.ask({
        sessionID: input.run.sessionID,
        tool: input.ctx.callID && input.ctx.messageID ? { messageID: input.ctx.messageID, callID: input.ctx.callID } : undefined,
        questions: [
          {
            header: step.header,
            question: step.question,
            options: step.options,
            multiple: step.multiple,
            custom: step.custom,
          },
        ],
      })
      const value = (answers[0] ?? []).join(", ")
      const facts = { ...input.run.facts, [step.save_as]: value }
      await updateStep({
        id: input.row.id,
        status: "completed",
        summary: value ? `Saved ${step.save_as}` : `No answer recorded for ${step.save_as}`,
        outputPreview: value || undefined,
        ended: Date.now(),
      })
      return updateRun({
        runID: input.run.id,
        facts,
        stepIdx: input.row.stepIdx + 1,
        status: "running",
        pauseReason: null,
        error: null,
      })
    }

    if (step.approval === "always") {
      const answers = await Question.ask({
        sessionID: input.run.sessionID,
        tool: input.ctx.callID && input.ctx.messageID ? { messageID: input.ctx.messageID, callID: input.ctx.callID } : undefined,
        questions: [
          {
            header: "Approve",
            question: `Approve runbook step "${step.title}"?`,
            options: [
              { label: "Yes", description: "Run this step now" },
              { label: "No", description: "Pause before running this step" },
            ],
            multiple: false,
            custom: false,
          },
        ],
      })
      if ((answers[0] ?? [])[0] !== "Yes") {
        await updateStep({
          id: input.row.id,
          status: "paused",
          summary: "Paused for approval",
          ended: Date.now(),
        })
        return updateRun({
          runID: input.run.id,
          status: "paused",
          pauseReason: "approval",
          error: `Approval required for "${step.title}"`,
          stepIdx: input.row.stepIdx,
        })
      }
    }

    const vms = await resolveTargets({
      step,
      run: input.run,
    })

    if (step.kind === "exec") {
      const command = render(step.command, input.run.facts)
      const cwd = step.cwd ? render(step.cwd, input.run.facts) : undefined
      const missing = [...command.missing, ...(cwd?.missing ?? [])]
      if (missing.length > 0) {
        return stop({
          runID: input.run.id,
          row: input.row,
          message: `Missing template values for "${step.title}": ${missing.join(", ")}`,
          reason: "missing_fact",
        })
      }

      const result = await VMOperate.run({
        ctx: input.ctx,
        tool: "runbook_exec",
        vms,
        title: `Runbook: ${step.title}`,
        mode: step.mode,
        concurrency: step.concurrency,
        async work(vm, push) {
          const conn = await VM.connect({
            sessionID: input.run.sessionID,
            vm,
            abort: input.ctx.abort,
          })
          return VMSSH.exec({
            client: conn.client,
            command: command.value,
            cwd: cwd?.value,
            timeout: step.timeout_secs * 1000,
            shell: step.shell === "auto" ? await VM.shell({ conn }) : step.shell,
            abort: input.ctx.abort,
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
        async fail(vm, err) {
          const text = err instanceof Error ? err.stack ?? err.message : String(err)
          const info = await VMOperate.capture(text)
          return {
            summary: err instanceof Error ? err.message : String(err),
            output: info.output,
            transcriptPath: info.transcriptPath,
            artifacts: VMOperate.inline(vm, "exec-error", text),
            ran: false,
          }
        },
      })

      const err = fault(result)
      if (err) {
        return stop({
          runID: input.run.id,
          row: input.row,
          message: err.summary,
          result,
          status: "failed",
          reason: "error",
        })
      }

      const stdout = result.results.map((item) => item.value?.stdout?.trim()).filter((item): item is string => !!item)
      const stderr = result.results.map((item) => item.value?.stderr?.trim()).filter((item): item is string => !!item)
      const codes = result.results.map((item) => item.exitCode).filter((item): item is number => item !== undefined)
      const expected = step.verify?.exit_codes ?? [0]
      const bad = codes.find((code) => !expected.includes(code))
      let facts = input.run.facts
      if (step.capture === "json") {
        facts = await applyCapture({
          step,
          facts,
          result,
        })
      }
      const verify = verifyOutput({
        step,
        raw: stdout,
        stderr,
        facts,
      })
      if (!verify.ok || bad !== undefined) {
        return stop({
          runID: input.run.id,
          row: input.row,
          message: bad !== undefined ? `Unexpected exit code: ${bad}` : (verify.message ?? "Verification failed"),
          facts,
          result,
          reason: "verify",
        })
      }

      await updateStep({
        id: input.row.id,
        status: "completed",
        summary: result.output || "Step completed",
        outputPreview: result.output,
        vmActivityIDs: result.metadata.activity_ids,
        artifacts: result.metadata.artifacts ?? [],
        ended: Date.now(),
      })
      return updateRun({
        runID: input.run.id,
        facts,
        stepIdx: input.row.stepIdx + 1,
        status: "running",
        pauseReason: null,
        error: null,
      })
    }

    if (step.kind === "workspace_prepare") {
      const repo = step.repo_url ? render(step.repo_url, input.run.facts) : undefined
      const ref = step.ref ? render(step.ref, input.run.facts) : undefined
      const base = step.base_dir ? render(step.base_dir, input.run.facts) : undefined
      const missing = [...(repo?.missing ?? []), ...(ref?.missing ?? []), ...(base?.missing ?? [])]
      if (missing.length > 0) {
        return stop({
          runID: input.run.id,
          row: input.row,
          message: `Missing template values for "${step.title}": ${missing.join(", ")}`,
          reason: "missing_fact",
        })
      }

      const local = await VMWorkspace.local({
        repoUrl: !repo?.value && vms.some((vm) => !vm.repoUrl),
        ref: !ref?.value,
      })

      const result = await VMOperate.run({
        ctx: input.ctx,
        tool: "runbook_workspace_prepare",
        vms,
        title: `Runbook: ${step.title}`,
        mode: step.mode,
        concurrency: step.concurrency,
        async work(vm, push) {
          const conn = await VM.connect({
            sessionID: input.run.sessionID,
            vm,
            abort: input.ctx.abort,
          })
          const value = await VMSSH.workspace({
            client: conn.client,
            baseDir: VMWorkspace.root({
              baseDir: base?.value,
              vm,
            }),
            projectID: Instance.project.id,
            repoUrl: VMWorkspace.repo({
              repoUrl: repo?.value,
              fallback: local.repoUrl,
              vm,
            }),
            ref: ref?.value ?? local.ref ?? "",
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
        async fail(vm, err) {
          const text = err instanceof Error ? err.stack ?? err.message : String(err)
          const info = await VMOperate.capture(text)
          return {
            summary: err instanceof Error ? err.message : String(err),
            output: info.output,
            transcriptPath: info.transcriptPath,
            artifacts: VMOperate.inline(vm, "workspace-prepare-error", text),
            ran: false,
          }
        },
      })

      const err = fault(result)
      if (err) {
        return stop({
          runID: input.run.id,
          row: input.row,
          message: err.summary,
          result,
          status: "failed",
          reason: "error",
        })
      }

      const dirs = unique(result.results.flatMap((item) => (item.value ? [item.value.workspaceDir] : [])))
      const refs = unique(result.results.flatMap((item) => (item.value ? [item.value.workspaceRef] : [])))
      const repos = unique(result.results.flatMap((item) => (item.value ? [item.value.workspaceRepo] : [])))
      if (dirs.length !== 1 || refs.length !== 1 || repos.length !== 1) {
        return stop({
          runID: input.run.id,
          row: input.row,
          message: "workspace_prepare produced inconsistent workspace metadata across targets",
          result,
          status: "failed",
          reason: "error",
        })
      }

      const facts = {
        ...input.run.facts,
        workspace_dir: dirs[0]!,
        workspace_ref: refs[0]!,
        workspace_repo: repos[0]!,
      }

      await updateStep({
        id: input.row.id,
        status: "completed",
        summary: result.output || "Step completed",
        outputPreview: result.output,
        vmActivityIDs: result.metadata.activity_ids,
        artifacts: result.metadata.artifacts ?? [],
        ended: Date.now(),
      })
      return updateRun({
        runID: input.run.id,
        facts,
        stepIdx: input.row.stepIdx + 1,
        status: "running",
        pauseReason: null,
        error: null,
      })
    }

    if (step.kind === "upload") {
      const dest = render(step.dest_path, input.run.facts)
      const src = step.src_path ? render(step.src_path, input.run.facts) : undefined
      const content = step.content ? render(step.content, input.run.facts) : undefined
      const missing = [...dest.missing, ...(src?.missing ?? []), ...(content?.missing ?? [])]
      if (missing.length > 0) {
        return stop({
          runID: input.run.id,
          row: input.row,
          message: `Missing template values for "${step.title}": ${missing.join(", ")}`,
          reason: "missing_fact",
        })
      }

      const srcPath = src?.value
        ? path.isAbsolute(src.value)
          ? src.value
          : path.resolve(Instance.directory, src.value)
        : undefined

      const result = await VMOperate.run({
        ctx: input.ctx,
        tool: "runbook_upload",
        vms,
        title: `Runbook: ${step.title}`,
        mode: step.mode,
        concurrency: step.concurrency,
        async work(vm, push) {
          const conn = await VM.connect({
            sessionID: input.run.sessionID,
            vm,
            abort: input.ctx.abort,
          })
          await VMSSH.upload({
            client: conn.client,
            dest: dest.value,
            srcPath,
            content: content?.value,
            mode: step.file_mode,
            createDirs: step.create_dirs,
            sftp: VM.sftp({ conn }),
          })
          push(`uploaded to ${dest.value}`)
          return true
        },
        done() {
          return {
            summary: `uploaded ${path.posix.basename(dest.value)}`,
            ran: true,
          }
        },
        async fail(vm, err) {
          const text = err instanceof Error ? err.stack ?? err.message : String(err)
          const info = await VMOperate.capture(text)
          return {
            summary: err instanceof Error ? err.message : String(err),
            output: info.output,
            transcriptPath: info.transcriptPath,
            artifacts: VMOperate.inline(vm, "upload-error", text),
            ran: false,
          }
        },
      })

      const err = fault(result)
      if (err) {
        return stop({
          runID: input.run.id,
          row: input.row,
          message: err.summary,
          result,
          status: "failed",
          reason: "error",
        })
      }

      await updateStep({
        id: input.row.id,
        status: "completed",
        summary: result.output || "Step completed",
        outputPreview: result.output,
        vmActivityIDs: result.metadata.activity_ids,
        artifacts: result.metadata.artifacts ?? [],
        ended: Date.now(),
      })
      return updateRun({
        runID: input.run.id,
        stepIdx: input.row.stepIdx + 1,
        status: "running",
        pauseReason: null,
        error: null,
      })
    }

    const remote = render(step.remote_path, input.run.facts)
    const local = step.local_name ? render(step.local_name, input.run.facts) : undefined
    const gaps = [...remote.missing, ...(local?.missing ?? [])]
    if (gaps.length > 0) {
      return stop({
        runID: input.run.id,
        row: input.row,
        message: `Missing template values for "${step.title}": ${gaps.join(", ")}`,
        reason: "missing_fact",
      })
    }

    const result = await VMOperate.run({
      ctx: input.ctx,
      tool: "runbook_download",
      vms,
      title: `Runbook: ${step.title}`,
      mode: step.mode,
      concurrency: step.concurrency,
      async work(vm, push) {
        const conn = await VM.connect({
          sessionID: input.run.sessionID,
          vm,
          abort: input.ctx.abort,
        })
        const item = await VMSSH.download({
          client: conn.client,
          remote: remote.value,
          localName: local?.value
            ? (vms.length > 1 ? `${vm.name}-${local.value}` : local.value)
            : vms.length > 1
              ? `${vm.name}-${path.posix.basename(remote.value)}`
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
      async fail(vm, err) {
        const text = err instanceof Error ? err.stack ?? err.message : String(err)
        const info = await VMOperate.capture(text)
        return {
          summary: err instanceof Error ? err.message : String(err),
          output: info.output,
          transcriptPath: info.transcriptPath,
          artifacts: VMOperate.inline(vm, "download-error", text),
          ran: false,
        }
      },
    })

    const err = fault(result)
    if (err) {
      return stop({
        runID: input.run.id,
        row: input.row,
        message: err.summary,
        result,
        status: "failed",
        reason: "error",
      })
    }

    const facts = step.save_as && result.results[0]?.value
      ? {
          ...input.run.facts,
          [step.save_as]: result.results[0].value.name,
        }
      : input.run.facts

    await updateStep({
      id: input.row.id,
      status: "completed",
      summary: result.output || "Step completed",
      outputPreview: result.output,
      vmActivityIDs: result.metadata.activity_ids,
      artifacts: result.metadata.artifacts ?? [],
      ended: Date.now(),
    })
    return updateRun({
      runID: input.run.id,
      facts,
      stepIdx: input.row.stepIdx + 1,
      status: "running",
      pauseReason: null,
      error: null,
    })
  }

  async function drive(input: {
    ctx: VMOperate.Context
    plan: z.infer<typeof Schema.Document>
    run: z.infer<typeof Schema.Run>
  }) {
    let run = input.run
    for (;;) {
      if (input.ctx.abort.aborted) throw new Error("Runbook execution aborted")
      if (run.status === "cancelled" || run.status === "completed") return run
      const step = listStepRows(run.id).map(fromStepRow)[run.stepIdx]
      if (!step) {
        return updateRun({
          runID: run.id,
          status: "completed",
          pauseReason: null,
          error: null,
          ended: Date.now(),
        })
      }
      run = await runStep({
        ctx: input.ctx,
        plan: input.plan,
        run,
        row: step,
      })
      if (run.status !== "running") return run
    }
  }

  async function createRows(input: {
    sessionID: string
    messageID?: string
    plan: z.infer<typeof Schema.Document>
    path: string
  }) {
    const now = Date.now()
    const facts = Object.fromEntries(
      input.plan.inputs.filter((item) => item.default !== undefined).map((item) => [item.name, item.default!]),
    )
    const run = Database.transaction((db) => {
      const run = db
        .insert(RunbookRunTable)
        .values({
          id: Identifier.ascending("runbook_run"),
          session_id: input.sessionID,
          message_id: input.messageID ?? null,
          path: input.path,
          status: "ready",
          step_idx: 0,
          bindings: {},
          facts,
          approval: {},
          source_bundle: input.plan.sources,
          pause_reason: null,
          error: null,
          time_started: now,
          time_ended: null,
          time_created: now,
          time_updated: now,
        })
        .returning()
        .get()
      if (!run) throw new Error("Failed to create runbook run")
      input.plan.steps.forEach((step, idx) => {
        db.insert(RunbookStepTable)
          .values({
            id: Identifier.ascending("runbook_step"),
            run_id: run.id,
            session_id: input.sessionID,
            step_id: step.id,
            step_idx: idx,
            kind: step.kind,
            title: step.title,
            attempt: 0,
            status: "pending",
            summary: null,
            output_preview: null,
            vm_activity_ids: {},
            artifacts: [],
            error: null,
            time_started: null,
            time_ended: null,
            time_created: now,
            time_updated: now,
          })
          .run()
      })
      return run
    })
    const value = fromRunRow(run)
    await publishRun(value)
    const steps = listStepRows(value.id).map(fromStepRow)
    await Promise.all(steps.map((step) => publishStep(step)))
    return value
  }

  export async function state(sessionID: string) {
    const plan = await loadPlan(sessionID)
    const row = latestRunRow(sessionID)
    const run = row ? fromRunRow(row) : undefined
    const steps = run ? listStepRows(run.id).map(fromStepRow) : []
    return Schema.SessionState.parse({
      sessionID,
      path: plan.path,
      exists: plan.exists,
      raw: plan.exists ? plan.raw : undefined,
      plan: plan.exists ? plan.plan : undefined,
      run,
      steps,
    })
  }

  export async function execute(input: {
    sessionID: string
    messageID?: string
    callID?: string
    abort: AbortSignal
    metadata?: VMOperate.Context["metadata"]
  }) {
    const loaded = await loadPlan(input.sessionID)
    if (!loaded.exists) throw new Error(`Runbook file not found: ${loaded.path}`)
    const run = await createRows({
      sessionID: input.sessionID,
      messageID: input.messageID,
      path: loaded.path,
      plan: loaded.plan,
    }).then((run) =>
      bindRoles({
        sessionID: input.sessionID,
        plan: loaded.plan,
        run,
        messageID: input.messageID,
        callID: input.callID,
      }),
    ).then((run) =>
      collectInputs({
        sessionID: input.sessionID,
        plan: loaded.plan,
        run,
        messageID: input.messageID,
        callID: input.callID,
      }),
    )
    if (run.status !== "ready" && run.status !== "running") return state(input.sessionID)
    const next = await updateRun({
      runID: run.id,
      status: "running",
      started: run.time.started ?? Date.now(),
    })
    await drive({
      ctx: {
        ...input,
        sessionID: run.sessionID,
      },
      plan: loaded.plan,
      run: next,
    })
    return state(input.sessionID)
  }

  export async function resume(input: {
    runID?: string
    sessionID?: string
    messageID?: string
    callID?: string
    abort: AbortSignal
    metadata?: VMOperate.Context["metadata"]
  }) {
    if (!input.runID && !input.sessionID) throw new Error("sessionID is required when runID is not provided")
    const row = input.runID
      ? Database.use((db) => db.select().from(RunbookRunTable).where(eq(RunbookRunTable.id, input.runID!)).get())
      : latestRunRow(input.sessionID!)
    if (!row) throw new Error("Runbook run not found")
    const run = fromRunRow(row)
    const loaded = await loadPlan(run.sessionID)
    if (!loaded.exists) throw new Error(`Runbook file not found: ${loaded.path}`)
    const bound = await bindRoles({
      sessionID: run.sessionID,
      plan: loaded.plan,
      run,
      messageID: input.messageID,
      callID: input.callID,
    })
    const seeded = await collectInputs({
      sessionID: run.sessionID,
      plan: loaded.plan,
      run: bound,
      messageID: input.messageID,
      callID: input.callID,
    })
    if (seeded.status !== "ready" && seeded.status !== "running" && seeded.status !== "paused") {
      return state(run.sessionID)
    }
    const next = await updateRun({
      runID: seeded.id,
      status: "running",
      pauseReason: null,
      error: null,
      started: seeded.time.started ?? Date.now(),
    })
    await drive({
      ctx: {
        abort: input.abort,
        callID: input.callID,
        messageID: input.messageID,
        metadata: input.metadata,
        sessionID: run.sessionID,
      },
      plan: loaded.plan,
      run: next,
    })
    return state(run.sessionID)
  }

  export async function cancel(input: { runID?: string; sessionID?: string }) {
    if (!input.runID && !input.sessionID) throw new Error("sessionID is required when runID is not provided")
    const row = input.runID
      ? Database.use((db) => db.select().from(RunbookRunTable).where(eq(RunbookRunTable.id, input.runID!)).get())
      : latestRunRow(input.sessionID!)
    if (!row) throw new Error("Runbook run not found")
    await updateRun({
      runID: row.id,
      status: "cancelled",
      pauseReason: null,
      error: null,
      ended: Date.now(),
    })
    return state(row.session_id)
  }

  export async function status(sessionID: string) {
    const value = await state(sessionID)
    return {
      value,
      output: present(value),
    }
  }
}
