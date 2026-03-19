import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "@/util/lazy"
import { VM } from "@/vm"
import { errors } from "../error"
import z from "zod"

export const VmRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List VMs",
        description: "Get all registered VMs for the current project.",
        operationId: "vm.list",
        responses: {
          200: {
            description: "VM list",
            content: {
              "application/json": {
                schema: resolver(VM.Summary.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await VM.list())
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create VM",
        description: "Create a VM record for the current project.",
        operationId: "vm.create",
        responses: {
          200: {
            description: "Created VM",
            content: {
              "application/json": {
                schema: resolver(VM.Detail),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", VM.Create.schema),
      async (c) => {
        return c.json(await VM.Create(c.req.valid("json")))
      },
    )
    .post(
      "/test",
      describeRoute({
        summary: "Test draft VM",
        description: "Test an unsaved VM connection using the provided credentials.",
        operationId: "vm.testDraft",
        responses: {
          200: {
            description: "Tested VM",
            content: {
              "application/json": {
                schema: resolver(VM.Detail),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", VM.Create.schema),
      async (c) => {
        return c.json(await VM.testDraft(c.req.valid("json")))
      },
    )
    .post(
      "/:vmID/test",
      describeRoute({
        summary: "Test VM",
        description: "Test a saved VM connection and refresh its detected facts.",
        operationId: "vm.test",
        responses: {
          200: {
            description: "Tested VM",
            content: {
              "application/json": {
                schema: resolver(VM.Detail),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ vmID: VM.Detail.shape.id })),
      async (c) => {
        return c.json(await VM.test(c.req.valid("param").vmID))
      },
    )
    .get(
      "/:vmID/activity",
      describeRoute({
        summary: "List VM activity",
        description: "Get recent remote activity recorded for a VM.",
        operationId: "vm.activity",
        responses: {
          200: {
            description: "VM activity",
            content: {
              "application/json": {
                schema: resolver(VM.Activity.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ vmID: VM.Detail.shape.id })),
      async (c) => {
        return c.json(await VM.activity(c.req.valid("param").vmID))
      },
    )
    .get(
      "/:vmID",
      describeRoute({
        summary: "Get VM",
        description: "Get a saved VM including its stored credentials.",
        operationId: "vm.get",
        responses: {
          200: {
            description: "VM detail",
            content: {
              "application/json": {
                schema: resolver(VM.Detail),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ vmID: VM.Detail.shape.id })),
      async (c) => {
        return c.json(await VM.get(c.req.valid("param").vmID))
      },
    )
    .patch(
      "/:vmID",
      describeRoute({
        summary: "Update VM",
        description: "Update a saved VM.",
        operationId: "vm.update",
        responses: {
          200: {
            description: "Updated VM",
            content: {
              "application/json": {
                schema: resolver(VM.Detail),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ vmID: VM.Detail.shape.id })),
      validator("json", VM.Update.schema.omit({ vmID: true })),
      async (c) => {
        return c.json(await VM.Update({ ...c.req.valid("json"), vmID: c.req.valid("param").vmID }))
      },
    )
    .delete(
      "/:vmID",
      describeRoute({
        summary: "Delete VM",
        description: "Delete a saved VM and its recorded activity.",
        operationId: "vm.delete",
        responses: {
          200: {
            description: "VM deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ vmID: VM.Detail.shape.id })),
      async (c) => {
        return c.json(await VM.Delete(c.req.valid("param").vmID))
      },
    ),
)
