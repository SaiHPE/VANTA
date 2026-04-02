import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "@/util/lazy"
import { Runbook } from "@/runbook"
import { errors } from "../error"
import z from "zod"

export const RunbookRoutes = lazy(() =>
  new Hono()
    .post(
      "/:runID/resume",
      describeRoute({
        summary: "Resume runbook",
        description: "Resume a paused or failed runbook execution.",
        operationId: "runbook.resume",
        responses: {
          200: {
            description: "Runbook session state",
            content: {
              "application/json": {
                schema: resolver(Runbook.Schema.SessionState),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        return c.json(
          await Runbook.resume({
            runID: c.req.valid("param").runID,
            abort: c.req.raw.signal,
          }),
        )
      },
    )
    .post(
      "/:runID/cancel",
      describeRoute({
        summary: "Cancel runbook",
        description: "Cancel an active or paused runbook execution.",
        operationId: "runbook.cancel",
        responses: {
          200: {
            description: "Runbook session state",
            content: {
              "application/json": {
                schema: resolver(Runbook.Schema.SessionState),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        return c.json(
          await Runbook.cancel({
            runID: c.req.valid("param").runID,
          }),
        )
      },
    ),
)
