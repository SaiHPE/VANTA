import { expect, test } from "bun:test"
import * as Schema from "../../src/runbook/schema"

test("runbook schema parses and stringifies a valid document", () => {
  const raw = Schema.stringify({
    schema: "newton.runbook/v1",
    title: "Install cluster",
    source_policy: "user_source_first",
    approval: "once_with_exceptions",
    vm_scope: { read: "all", write: "declared_roles" },
    sources: [{ kind: "url", role: "primary", url: "https://example.com/install" }],
    roles: {
      installer: {
        match: ["installer", "10.0.0.10"],
        min: 1,
        max: 1,
      },
    },
    inputs: [
      {
        name: "domain",
        prompt: "Cluster domain",
        required: true,
      },
    ],
    steps: [
      {
        id: "q1",
        kind: "question",
        title: "Ask domain",
        save_as: "domain",
        question: "What domain should be used?",
      },
      {
        id: "e1",
        kind: "exec",
        title: "Inspect installer",
        intent: "read",
        targets: { type: "all" },
        needs: ["domain"],
        command: "echo {{domain}}",
        capture: "none",
        retries: 0,
      },
    ],
    body: "Phase 1: gather inputs.\n\nPhase 2: inspect the installer host.",
  })

  const doc = Schema.parse({ content: raw })
  expect(doc.schema).toBe("newton.runbook/v1")
  expect(doc.roles.installer?.match).toEqual(["installer", "10.0.0.10"])
  expect(doc.steps).toHaveLength(2)
  expect(doc.body).toContain("Phase 1")
})

test("runbook schema rejects invalid role bounds", () => {
  expect(() =>
    Schema.parse({
      content: Schema.stringify({
        schema: "newton.runbook/v1",
        title: "Broken roles",
        roles: {
          installer: {
            match: ["installer"],
            min: 2,
            max: 1,
          },
        },
        steps: [
          {
            id: "q1",
            kind: "question",
            title: "Ask",
            save_as: "x",
            question: "x?",
          },
        ],
        body: "",
      }),
    }),
  ).toThrow("max must be >= min")
})

test("runbook schema rejects mutating uploads that do not target roles", () => {
  expect(() =>
    Schema.parse({
      content: Schema.stringify({
        schema: "newton.runbook/v1",
        title: "Broken upload",
        steps: [
          {
            id: "u1",
            kind: "upload",
            title: "Push file",
            targets: { type: "match", match: ["db"] },
            content: "hello",
            dest_path: "/tmp/hello.txt",
          },
        ],
        body: "",
      }),
    }),
  ).toThrow("upload steps must target declared roles")
})
