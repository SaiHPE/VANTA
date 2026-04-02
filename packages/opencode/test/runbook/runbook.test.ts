import { $ } from "bun"
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { mkdir } from "fs/promises"
import { Question } from "../../src/question"
import { Runbook } from "../../src/runbook"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { VM, VMRemote } from "../../src/vm"
import { VMSSH } from "../../src/vm/ssh"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function waitQuestion(sessionID: string) {
  for (let i = 0; i < 50; i++) {
    const items = await Question.list()
    const found = items.find((item) => item.sessionID === sessionID)
    if (found) return found
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for question in ${sessionID}`)
}

async function git(dir: string) {
  await $`git init`.cwd(dir).quiet()
  await $`git config user.email test@example.com`.cwd(dir).quiet()
  await $`git config user.name opencode-test`.cwd(dir).quiet()
  await $`git config core.fsmonitor false`.cwd(dir).quiet()
  await $`git commit --allow-empty -m root`.cwd(dir).quiet()
  await $`git branch -M dev`.cwd(dir).quiet().nothrow()
  await $`git remote add origin git@example.com:demo/repo.git`.cwd(dir).quiet().nothrow()
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

test("runbook execute completes a question-only plan and saves answers as facts", async () => {
  await using tmp = await tmpdir()
  await git(tmp.path)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const plan = Session.plan(session)
      await mkdir(plan.replace(/[\\/][^\\/]+$/, ""), { recursive: true })
      await Bun.write(
        plan,
        Runbook.Schema.stringify({
          schema: "newton.runbook/v1",
          title: "Question flow",
          steps: [
            {
              id: "q1",
              kind: "question",
              title: "Ask cluster name",
              question: "What cluster name should be used?",
              save_as: "cluster_name",
            },
          ],
          body: "Collect the cluster name before execution.",
        }),
      )

      const task = Runbook.execute({
        sessionID: session.id,
        abort: new AbortController().signal,
      })

      const q = await waitQuestion(session.id)
      await Question.reply({
        requestID: q.id,
        answers: [["demo-cluster"]],
      })

      const state = await task
      expect(state.run?.status).toBe("completed")
      expect(state.run?.facts.cluster_name).toBe("demo-cluster")
      expect(state.steps[0]?.status).toBe("completed")
    },
  })
})

test("runbook execute pauses when a step needs an unresolved fact", async () => {
  await using tmp = await tmpdir()
  await git(tmp.path)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const plan = Session.plan(session)
      await mkdir(plan.replace(/[\\/][^\\/]+$/, ""), { recursive: true })
      await Bun.write(
        plan,
        Runbook.Schema.stringify({
          schema: "newton.runbook/v1",
          title: "Missing facts",
          steps: [
            {
              id: "e1",
              kind: "exec",
              title: "Inspect host",
              intent: "read",
              targets: { type: "all" },
              needs: ["inventory_path"],
              command: "cat {{inventory_path}}",
              retries: 0,
            },
          ],
          body: "Pause until the inventory path is known.",
        }),
      )

      const state = await Runbook.execute({
        sessionID: session.id,
        abort: new AbortController().signal,
      })

      expect(state.run?.status).toBe("paused")
      expect(state.run?.pauseReason).toBe("missing_fact")
      expect(state.steps[0]?.status).toBe("paused")
      expect(state.run?.error).toContain("inventory_path")
    },
  })
})

test("runbook workspace_prepare saves shared workspace facts", async () => {
  await using tmp = await tmpdir()
  await git(tmp.path)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const vm = await VM.Create({
        name: "runner-a",
        hostname: "runner-a.local",
        username: "root",
        authType: "password",
        password: "secret",
        workspaceRoot: "/srv/opencode",
      })
      const session = await Session.create({})
      const plan = Session.plan(session)
      await mkdir(plan.replace(/[\\/][^\\/]+$/, ""), { recursive: true })
      await Bun.write(
        plan,
        Runbook.Schema.stringify({
          schema: "newton.runbook/v1",
          title: "Workspace flow",
          roles: {
            runners: {
              match: ["runner-a"],
            },
          },
          steps: [
            {
              id: "w1",
              kind: "workspace_prepare",
              title: "Prepare repo",
              targets: { type: "roles", roles: ["runners"] },
            },
          ],
          body: "Prepare a remote repo checkout before later steps run.",
        }),
      )

      const connect = spyOn(VM, "connect").mockResolvedValue({
        client: {} as any,
        host: "runner-a.local",
        time: Date.now(),
      })
      const workspace = spyOn(VMSSH, "workspace").mockResolvedValue({
        workspaceDir: "/srv/opencode/project/wt/dev-abc",
        workspaceRef: "abc123",
        workspaceRepo: "/srv/opencode/project/repo",
        repoUrl: "git@example.com:demo/repo.git",
      })

      try {
        const task = Runbook.execute({
          sessionID: session.id,
          abort: new AbortController().signal,
        })

        const q = await waitQuestion(session.id)
        await Question.reply({
          requestID: q.id,
          answers: [[q.questions[0]!.options[0]!.label]],
        })

        const state = await task
        expect(state.run?.status).toBe("completed")
        expect(state.run?.facts.workspace_dir).toBe("/srv/opencode/project/wt/dev-abc")
        expect(state.run?.facts.workspace_ref).toBe("abc123")
        expect(state.run?.facts.workspace_repo).toBe("/srv/opencode/project/repo")
        expect(state.steps[0]?.status).toBe("completed")
        expect(workspace).toHaveBeenCalledWith(
          expect.objectContaining({
            baseDir: "/srv/opencode",
            projectID: expect.any(String),
            repoUrl: "git@example.com:demo/repo.git",
            ref: "dev",
          }),
        )
      } finally {
        connect.mockRestore()
        workspace.mockRestore()
      }

      expect(vm.name).toBe("runner-a")
    },
  })
})

test("runbook session_start, sync, and jobs persist handles and cleanup remote sessions", async () => {
  await using tmp = await tmpdir()
  await git(tmp.path)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const vm = await VM.Create({
        name: "runner-a",
        hostname: "runner-a.local",
        username: "root",
        authType: "password",
        password: "secret",
        workspaceRoot: "/srv/opencode",
      })
      const session = await Session.create({})
      const plan = Session.plan(session)
      await mkdir(plan.replace(/[\\/][^\\/]+$/, ""), { recursive: true })
      await Bun.write(
        plan,
        Runbook.Schema.stringify({
          schema: "newton.runbook/v1",
          title: "Remote worker flow",
          roles: {
            runners: {
              match: ["runner-a"],
            },
          },
          steps: [
            {
              id: "s1",
              kind: "session_start",
              title: "Start remote session",
              targets: { type: "roles", roles: ["runners"] },
            },
            {
              id: "s2",
              kind: "sync",
              title: "Sync changes",
              targets: { type: "roles", roles: ["runners"] },
            },
            {
              id: "s3",
              kind: "job_start",
              title: "Start job",
              targets: { type: "roles", roles: ["runners"] },
              command: "echo hi",
            },
            {
              id: "s4",
              kind: "job_wait",
              title: "Wait job",
              targets: { type: "roles", roles: ["runners"] },
            },
          ],
          body: "Exercise remote handles through the runbook runtime.",
        }),
      )

      const open = spyOn(VMRemote, "sessionOpen").mockResolvedValue({
        id: "vms_test",
        vmID: vm.id,
        sessionID: session.id,
        status: "open",
        workspaceDir: "/srv/opencode/project/wt/dev",
        workspaceRef: "abc123",
        workspaceRepo: "/srv/opencode/project/mirror/repo.git",
        baseRef: "abc123",
        runtime: "node",
        workerVersion: "1.2.20",
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      })
      const sync = spyOn(VMRemote, "sync").mockResolvedValue({
        vmSessionID: "vms_test",
        vmID: vm.id,
        hash: "sync123",
        uploaded: 1,
        deleted: 0,
        skipped: 0,
        files: ["tracked.txt"],
        time: Date.now(),
      })
      const start = spyOn(VMRemote, "jobStart").mockResolvedValue({
        id: "vmj_test",
        vmSessionID: "vms_test",
        vmID: vm.id,
        status: "running",
        command: "echo hi",
        cwd: "/srv/opencode/project/wt/dev",
        pid: 123,
        startedAt: Date.now(),
        logDir: "/tmp/jobs/vmj_test",
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      })
      const wait = spyOn(VMRemote, "jobWait").mockResolvedValue({
        id: "vmj_test",
        vmSessionID: "vms_test",
        vmID: vm.id,
        status: "completed",
        command: "echo hi",
        cwd: "/srv/opencode/project/wt/dev",
        pid: 123,
        startedAt: Date.now() - 100,
        endedAt: Date.now(),
        exitCode: 0,
        logDir: "/tmp/jobs/vmj_test",
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      })
      const close = spyOn(VMRemote, "sessionClose").mockResolvedValue({
        id: "vms_test",
        vmID: vm.id,
        sessionID: session.id,
        status: "closed",
        workspaceDir: "/srv/opencode/project/wt/dev",
        workspaceRef: "abc123",
        workspaceRepo: "/srv/opencode/project/mirror/repo.git",
        baseRef: "abc123",
        runtime: "node",
        workerVersion: "1.2.20",
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      })

      try {
        const task = Runbook.execute({
          sessionID: session.id,
          abort: new AbortController().signal,
        })

        const q = await waitQuestion(session.id)
        await Question.reply({
          requestID: q.id,
          answers: [[q.questions[0]!.options[0]!.label]],
        })

        const state = await task
        expect(state.run?.status).toBe("completed")
        expect(state.run?.facts.workspace_dir).toBe("/srv/opencode/project/wt/dev")
        expect(state.run?.handles.vm_sessions[vm.id]).toBe("vms_test")
        expect(state.run?.handles.syncs[vm.id]?.hash).toBe("sync123")
        expect(state.run?.handles.vm_jobs[vm.id]).toBe("vmj_test")
        expect(state.steps.every((step) => step.status === "completed")).toBe(true)
        expect(close).toHaveBeenCalledWith({
          vmSessionID: "vms_test",
        })
      } finally {
        open.mockRestore()
        sync.mockRestore()
        start.mockRestore()
        wait.mockRestore()
        close.mockRestore()
      }
    },
  })
})
