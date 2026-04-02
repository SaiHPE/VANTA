import matter from "gray-matter"
import z from "zod"
import { VMWorkspace } from "@/vm/workspace"

const nonEmpty = z.string().trim().min(1)

export const SourcePolicy = z.enum(["user_source_first", "official_first"]).meta({
  ref: "RunbookSourcePolicy",
})

export const Approval = z.enum(["once_with_exceptions", "always"]).meta({
  ref: "RunbookApproval",
})

export const StepApproval = z.enum(["inherit", "always"]).meta({
  ref: "RunbookStepApproval",
})

export const Scope = z.object({
  read: z.enum(["all", "declared_roles"]).default("all"),
  write: z.enum(["declared_roles", "all"]).default("declared_roles"),
})

export const Source = z
  .object({
    kind: z.enum(["url", "file", "attachment", "text"]),
    role: z.enum(["primary", "supporting"]).default("supporting"),
    label: z.string().optional(),
    url: z.string().optional(),
    path: z.string().optional(),
    text: z.string().optional(),
    fetched_at: z.number().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.kind === "url" && !input.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "url sources require url" })
    }
    if ((input.kind === "file" || input.kind === "attachment") && !input.path) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["path"], message: "file sources require path" })
    }
    if (input.kind === "text" && !input.text) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: "text sources require text" })
    }
  })
  .meta({
    ref: "RunbookSource",
  })

export const Role = z
  .object({
    match: z.array(nonEmpty).min(1),
    min: z.number().int().positive().default(1),
    max: z.number().int().positive().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.max !== undefined && input.max < input.min) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["max"], message: "max must be >= min" })
    }
  })
  .meta({
    ref: "RunbookRole",
  })

export const Input = z
  .object({
    name: nonEmpty,
    prompt: nonEmpty,
    required: z.boolean().default(true),
    secret: z.boolean().default(false),
    default: z.string().optional(),
  })
  .meta({
    ref: "RunbookInput",
  })

export const Verify = z
  .object({
    exit_codes: z.array(z.number().int()).optional(),
    stdout_contains: z.array(z.string()).optional(),
    stderr_not_contains: z.array(z.string()).optional(),
    facts_present: z.array(nonEmpty).optional(),
  })
  .meta({
    ref: "RunbookVerify",
  })

export const Targets = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("all") }),
    z.object({ type: z.literal("roles"), roles: z.array(nonEmpty).min(1) }),
    z.object({ type: z.literal("match"), match: z.array(nonEmpty).min(1) }),
  ])
  .meta({
    ref: "RunbookTargets",
  })

const StepBase = z.object({
  id: nonEmpty,
  phase: z.string().optional(),
  title: nonEmpty,
})

const StepMode = z.enum(["serial", "parallel"]).default("serial")
const StepConcurrency = z.number().int().positive().default(VMWorkspace.DEFAULT_CONCURRENCY)

export const QuestionStep = StepBase.extend({
  kind: z.literal("question"),
  header: z.string().default("Input"),
  question: nonEmpty,
  options: z
    .array(
      z.object({
        label: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
  multiple: z.boolean().default(false),
  custom: z.boolean().default(true),
  save_as: nonEmpty,
}).meta({
  ref: "RunbookQuestionStep",
})

export const ExecStep = StepBase.extend({
  kind: z.literal("exec"),
  intent: z.enum(["read", "write"]),
  targets: Targets,
  mode: StepMode,
  concurrency: StepConcurrency,
  needs: z.array(nonEmpty).default([]),
  command: nonEmpty,
  cwd: z.string().optional(),
  shell: z.enum(["auto", "bash", "sh"]).default("auto"),
  timeout_secs: z.number().int().positive().default(1800),
  capture: z.enum(["none", "json"]).default("none"),
  verify: Verify.optional(),
  retries: z.number().int().min(0).default(0),
  approval: StepApproval.default("inherit"),
}).meta({
  ref: "RunbookExecStep",
})

export const UploadStep = StepBase.extend({
  kind: z.literal("upload"),
  targets: Targets,
  mode: StepMode,
  concurrency: StepConcurrency,
  needs: z.array(nonEmpty).default([]),
  src_path: z.string().optional(),
  content: z.string().optional(),
  dest_path: nonEmpty,
  file_mode: z.string().optional(),
  create_dirs: z.boolean().default(true),
  approval: StepApproval.default("inherit"),
})
  .superRefine((input, ctx) => {
    if (!!input.src_path === !!input.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["src_path"],
        message: "Provide exactly one of src_path or content",
      })
    }
    if (input.targets.type !== "roles") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targets"],
        message: "upload steps must target declared roles",
      })
    }
  })
  .meta({
    ref: "RunbookUploadStep",
  })

export const DownloadStep = StepBase.extend({
  kind: z.literal("download"),
  targets: Targets,
  mode: StepMode,
  concurrency: StepConcurrency,
  needs: z.array(nonEmpty).default([]),
  remote_path: nonEmpty,
  local_name: z.string().optional(),
  save_as: z.string().optional(),
  approval: StepApproval.default("inherit"),
}).meta({
  ref: "RunbookDownloadStep",
})

export const WorkspaceStep = StepBase.extend({
  kind: z.literal("workspace_prepare"),
  targets: z.object({ type: z.literal("roles"), roles: z.array(nonEmpty).min(1) }),
  mode: StepMode,
  concurrency: StepConcurrency,
  needs: z.array(nonEmpty).default([]),
  repo_url: z.string().optional(),
  ref: z.string().optional(),
  base_dir: z.string().optional(),
  approval: StepApproval.default("inherit"),
}).meta({
  ref: "RunbookWorkspacePrepareStep",
})

export const Step = z
  .discriminatedUnion("kind", [QuestionStep, ExecStep, UploadStep, DownloadStep, WorkspaceStep])
  .superRefine((input, ctx) => {
    if (input.kind !== "exec") return
    if (input.intent === "write" && input.targets.type !== "roles") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targets"],
        message: "write exec steps must target declared roles",
      })
    }
  })
  .meta({
    ref: "RunbookStep",
  })

export const PlanFrontmatter = z
  .object({
    schema: z.literal("newton.runbook/v1"),
    title: nonEmpty,
    source_policy: SourcePolicy.default("user_source_first"),
    approval: Approval.default("once_with_exceptions"),
    vm_scope: Scope.default({ read: "all", write: "declared_roles" }),
    sources: z.array(Source).default([]),
    roles: z.record(nonEmpty, Role).default({}),
    inputs: z.array(Input).default([]),
    steps: z.array(Step).min(1),
  })
  .meta({
    ref: "RunbookPlan",
  })

export const Document = PlanFrontmatter.extend({
  body: z.string().default(""),
  path: z.string().optional(),
}).meta({
  ref: "RunbookDocument",
})

export const PauseReason = z
  .enum(["binding", "missing_fact", "question", "verify", "approval", "error"])
  .meta({
    ref: "RunbookPauseReason",
  })

export const RunStatus = z
  .enum(["ready", "running", "paused", "failed", "completed", "cancelled"])
  .meta({
    ref: "RunbookRunStatus",
  })

export const StepStatus = z
  .enum(["pending", "running", "paused", "failed", "completed", "cancelled"])
  .meta({
    ref: "RunbookStepStatus",
  })

export const Run = z
  .object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string().optional(),
    path: z.string(),
    status: RunStatus,
    stepIdx: z.number().int(),
    bindings: z.record(z.string(), z.array(z.string())).default({}),
    facts: z.record(z.string(), z.string()).default({}),
    approval: z
      .object({
        confirmed: z.boolean().optional(),
        roles: z.record(z.string(), z.array(z.string())).optional(),
      })
      .default({}),
    sourceBundle: z.array(Source).default([]),
    pauseReason: PauseReason.optional(),
    error: z.string().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
      started: z.number().optional(),
      ended: z.number().optional(),
    }),
  })
  .meta({
    ref: "RunbookRun",
  })

export const StepRecord = z
  .object({
    id: z.string(),
    runID: z.string(),
    sessionID: z.string(),
    stepID: z.string(),
    stepIdx: z.number().int(),
    kind: z.enum(["question", "exec", "upload", "download", "workspace_prepare"]),
    title: z.string(),
    attempt: z.number().int(),
    status: StepStatus,
    summary: z.string().optional(),
    outputPreview: z.string().optional(),
    vmActivityIDs: z.record(z.string(), z.string()).default({}),
    artifacts: z.array(
      z.object({
        name: z.string(),
        mime: z.string(),
        url: z.string(),
      }),
    ).default([]),
    error: z.string().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
      started: z.number().optional(),
      ended: z.number().optional(),
    }),
  })
  .meta({
    ref: "RunbookStepRecord",
  })

export const SessionState = z
  .object({
    sessionID: z.string(),
    path: z.string(),
    exists: z.boolean(),
    raw: z.string().optional(),
    plan: Document.optional(),
    run: Run.optional(),
    steps: z.array(StepRecord).default([]),
  })
  .meta({
    ref: "RunbookSessionState",
  })

export function parse(input: { content: string; path?: string }) {
  const doc = matter(input.content)
  return Document.parse({
    ...doc.data,
    body: doc.content.trim(),
    path: input.path,
  })
}

export function stringify(input: z.input<typeof Document>) {
  const doc = Document.parse(input)
  return matter.stringify(doc.body, {
    schema: doc.schema,
    title: doc.title,
    source_policy: doc.source_policy,
    approval: doc.approval,
    vm_scope: doc.vm_scope,
    sources: doc.sources,
    roles: doc.roles,
    inputs: doc.inputs,
    steps: doc.steps,
  })
}
