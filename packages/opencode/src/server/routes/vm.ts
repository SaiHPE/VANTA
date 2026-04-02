import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "@/util/lazy"
import { VM, VMRemote } from "@/vm"
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
    .post(
      "/session",
      describeRoute({
        summary: "Open VM remote session",
        description: "Prepare a remote workspace, bootstrap the VM worker, and return a reusable VM session handle.",
        operationId: "vm.sessionOpen",
        responses: {
          200: {
            description: "VM remote session",
            content: {
              "application/json": {
                schema: resolver(VM.RemoteSession),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", VMRemote.SessionOpenInput),
      async (c) => {
        return c.json(await VMRemote.sessionOpen({ ...c.req.valid("json"), abort: c.req.raw.signal }))
      },
    )
    .get(
      "/session/:vmSessionID",
      describeRoute({
        summary: "Get VM remote session",
        description: "Get the current status and workspace metadata for a VM remote session.",
        operationId: "vm.sessionStatus",
        responses: {
          200: {
            description: "VM remote session",
            content: {
              "application/json": {
                schema: resolver(VM.RemoteSession),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", VMRemote.SessionStatusInput),
      async (c) => {
        return c.json(await VMRemote.session(c.req.valid("param")))
      },
    )
    .delete(
      "/session/:vmSessionID",
      describeRoute({
        summary: "Close VM remote session",
        description: "Shutdown the remote worker and close the VM session handle.",
        operationId: "vm.sessionClose",
        responses: {
          200: {
            description: "Closed VM remote session",
            content: {
              "application/json": {
                schema: resolver(VM.RemoteSession),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", VMRemote.SessionCloseInput),
      async (c) => {
        return c.json(await VMRemote.sessionClose(c.req.valid("param")))
      },
    )
    .post(
      "/session/:vmSessionID/sync",
      describeRoute({
        summary: "Sync local changes to VM session",
        description: "Upload changed local files into an active VM workspace session.",
        operationId: "vm.sync",
        responses: {
          200: {
            description: "Sync result",
            content: {
              "application/json": {
                schema: resolver(VM.SyncStatus),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", VMRemote.SessionStatusInput),
      validator("json", VMRemote.SyncInput.omit({ vmSessionID: true })),
      async (c) => {
        return c.json(await VMRemote.sync({ ...c.req.valid("json"), ...c.req.valid("param") }))
      },
    )
    .post(
      "/job",
      describeRoute({
        summary: "Start VM job",
        description: "Start a long-running command inside an active VM session.",
        operationId: "vm.jobStart",
        responses: {
          200: {
            description: "VM job",
            content: {
              "application/json": {
                schema: resolver(VM.Job),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", VMRemote.JobStartInput),
      async (c) => {
        return c.json(await VMRemote.jobStart(c.req.valid("json")))
      },
    )
    .get(
      "/job/:vmJobID/logs",
      describeRoute({
        summary: "Get VM job logs",
        description: "Read combined logs from a VM job.",
        operationId: "vm.jobLogs",
        responses: {
          200: {
            description: "VM job logs",
            content: {
              "application/json": {
                schema: resolver(VMRemote.JobLogs),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ vmJobID: VM.Job.shape.id })),
      validator("query", z.object({ tail: z.coerce.number().optional(), follow: z.coerce.boolean().optional() })),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await VMRemote.jobLogs({ ...c.req.valid("param"), tail: query.tail, follow: query.follow ?? false }))
      },
    )
    .post(
      "/job/:vmJobID/wait",
      describeRoute({
        summary: "Wait for VM job",
        description: "Wait for a VM job to finish or until the timeout elapses.",
        operationId: "vm.jobWait",
        responses: {
          200: {
            description: "VM job",
            content: {
              "application/json": {
                schema: resolver(VM.Job),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ vmJobID: VM.Job.shape.id })),
      validator("json", z.object({ timeoutMs: z.number().int().positive().optional() })),
      async (c) => {
        return c.json(await VMRemote.jobWait({ ...c.req.valid("param"), ...c.req.valid("json") }))
      },
    )
    .post(
      "/job/:vmJobID/cancel",
      describeRoute({
        summary: "Cancel VM job",
        description: "Cancel a running VM job.",
        operationId: "vm.jobCancel",
        responses: {
          200: {
            description: "VM job",
            content: {
              "application/json": {
                schema: resolver(VM.Job),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ vmJobID: VM.Job.shape.id })),
      async (c) => {
        return c.json(await VMRemote.jobCancel(c.req.valid("param")))
      },
    )
    .post(
      "/session/:vmSessionID/read",
      describeRoute({
        summary: "Read from VM session",
        description: "Read files or directories inside an active VM workspace session.",
        operationId: "vm.read",
        responses: {
          200: {
            description: "VM remote read",
            content: {
              "application/json": {
                schema: resolver(VMRemote.RemoteRead),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", VMRemote.SessionStatusInput),
      validator("json", VMRemote.RemoteReadInput.omit({ vmSessionID: true })),
      async (c) => {
        return c.json(await VMRemote.remoteRead({ ...c.req.valid("param"), ...c.req.valid("json") }))
      },
    )
    .post(
      "/session/:vmSessionID/grep",
      describeRoute({
        summary: "Grep VM session",
        description: "Search file contents inside an active VM workspace session.",
        operationId: "vm.grep",
        responses: {
          200: {
            description: "VM remote grep",
            content: {
              "application/json": {
                schema: resolver(VMRemote.RemoteGrep),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", VMRemote.SessionStatusInput),
      validator("json", VMRemote.RemoteGrepInput.omit({ vmSessionID: true })),
      async (c) => {
        return c.json(await VMRemote.remoteGrep({ ...c.req.valid("param"), ...c.req.valid("json") }))
      },
    )
    .post(
      "/session/:vmSessionID/glob",
      describeRoute({
        summary: "Glob VM session",
        description: "List matching files inside an active VM workspace session.",
        operationId: "vm.glob",
        responses: {
          200: {
            description: "VM remote glob",
            content: {
              "application/json": {
                schema: resolver(VMRemote.RemoteGlob),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", VMRemote.SessionStatusInput),
      validator("json", VMRemote.RemoteGlobInput.omit({ vmSessionID: true })),
      async (c) => {
        return c.json(await VMRemote.remoteGlob({ ...c.req.valid("param"), ...c.req.valid("json") }))
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
