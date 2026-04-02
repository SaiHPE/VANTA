import { Runbook } from "@/runbook"
import { Tool } from "./tool"
import z from "zod"

export const RunbookStatusTool = Tool.define("runbook_status", {
  description:
    "Inspect the session runbook file and latest execution state. Use this before planning or resuming doc-backed multi-VM work.",
  parameters: z.object({}),
  async execute(_input, ctx) {
    const result = await Runbook.status(ctx.sessionID)
    return {
      title: "Runbook status",
      output: result.output,
      metadata: {
        state: result.value,
      },
    }
  },
})

export const RunbookExecTool = Tool.define("runbook_exec", {
  description:
    "Execute the current session runbook deterministically. This runs the saved plan file instead of improvising mutating steps live.",
  parameters: z.object({}),
  async execute(_input, ctx) {
    const value = await Runbook.execute({
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      abort: ctx.abort,
      metadata: ctx.metadata,
    })
    return {
      title: "Runbook execution",
      output: [
        `status: ${value.run?.status ?? "idle"}`,
        value.run?.pauseReason ? `pause_reason: ${value.run.pauseReason}` : "",
        value.run?.error ? `error: ${value.run.error}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        state: value,
      },
    }
  },
})

export const RunbookResumeTool = Tool.define("runbook_resume", {
  description:
    "Resume the latest paused or failed runbook execution for the current session after missing inputs, bindings, or verification issues are handled.",
  parameters: z.object({
    run_id: z.string().optional(),
  }),
  async execute(input, ctx) {
    const value = await Runbook.resume({
      runID: input.run_id,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      abort: ctx.abort,
      metadata: ctx.metadata,
    })
    return {
      title: "Runbook resumed",
      output: [
        `status: ${value.run?.status ?? "idle"}`,
        value.run?.pauseReason ? `pause_reason: ${value.run.pauseReason}` : "",
        value.run?.error ? `error: ${value.run.error}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        state: value,
      },
    }
  },
})
