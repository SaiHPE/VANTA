import { type MessageV2 } from "./message-v2"
import { VMSignal } from "@/vm/signal"

export namespace SessionDoom {
  const EXACT = 3
  const STALL = 2

  export type Hit = {
    mode: "exact" | "semantic"
    tool: string
    input: unknown
    failureClass?: string
    category?: string
    target?: string
    failures?: string[]
  }

  function tools(parts: MessageV2.Part[]) {
    return parts.filter((part): part is MessageV2.ToolPart => part.type === "tool" && part.state.status !== "pending")
  }

  function exact(parts: MessageV2.Part[], tool: string, input: unknown): Hit | undefined {
    const tail = tools(parts).slice(-EXACT)
    if (tail.length !== EXACT) return
    if (
      tail.every(
        (part) =>
          part.tool === tool &&
          JSON.stringify(part.state.input) === JSON.stringify(input),
      )
    ) {
      return {
        mode: "exact",
        tool,
        input,
      } satisfies Hit
    }
  }

  function meta(part: MessageV2.ToolPart) {
    if (part.state.status !== "completed" && part.state.status !== "error") return
    return part.state.metadata
  }

  function semantic(parts: MessageV2.Part[], tool: string, input: Record<string, unknown>): Hit | undefined {
    if (tool !== "vm_exec") return
    const next = VMSignal.plan({
      tool,
      args: input,
    })
    if (!next.category) return
    const tail = tools(parts)
      .slice(-8)
      .flatMap((part) => {
        if (part.tool !== tool) return []
        const data = meta(part)
        if (!data || typeof data !== "object") return []
        const failureClass = typeof data.failure_class === "string" ? data.failure_class : undefined
        const retryable = typeof data.retryable === "boolean" ? data.retryable : undefined
        const category = typeof data.plan_category === "string" ? data.plan_category : undefined
        const target = typeof data.target === "string" ? data.target : undefined
        const failed = part.state.status === "error" || !!failureClass
        if (!failed || retryable === true || category !== next.category) return []
        if (target && next.target && target !== next.target) return []
        return [
          {
            failureClass: failureClass ?? "command_failed",
            category,
            target,
          },
        ]
      })
      .slice(-STALL)
    if (tail.length !== STALL) return
    if (tail.every((item) => item.category === tail[0]?.category && item.target === tail[0]?.target)) {
      return {
        mode: "semantic",
        tool,
        input,
        failureClass: tail.every((item) => item.failureClass === tail[0]?.failureClass)
          ? tail[0]?.failureClass
          : undefined,
        category: tail[0]?.category,
        target: tail[0]?.target ?? next.target,
        failures: [...new Set(tail.map((item) => item.failureClass).filter(Boolean))],
      } satisfies Hit
    }
  }

  export function trip(parts: MessageV2.Part[], tool: string, input: unknown): Hit | undefined {
    return (
      exact(parts, tool, input) ??
      (input && typeof input === "object" && !Array.isArray(input)
        ? semantic(parts, tool, input as Record<string, unknown>)
        : undefined)
    )
  }
}
