import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { VM } from "../../src/vm"
import { VMOperate } from "../../src/vm/operate"
import { VMSSH } from "../../src/vm/ssh"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

beforeEach(async () => {
  await resetDatabase()
})

test("vm create, list, get, update, and delete stay project scoped", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const one = await VM.Create({
        name: "hana",
        hostname: "hana.local",
        username: "root",
        authType: "password",
        password: "secret",
      })
      const two = await VM.Create({
        name: "app",
        ip: "10.0.0.7",
        username: "ops",
        authType: "private_key",
        privateKey: "PRIVATE KEY",
      })

      const list = await VM.list()
      expect(list.map((item) => item.id)).toEqual([one.id, two.id])
      expect(list[0]?.authType).toBe("password")
      expect("password" in (list[0] ?? {})).toBe(false)

      const full = await VM.get(one.id)
      expect(full.password).toBe("secret")

      const next = await VM.Update({
        vmID: one.id,
        name: "hana-prod",
        hostname: "hana-prod.local",
        username: "admin",
        authType: "password",
        password: "secret-2",
        workspaceRoot: "/srv/opencode",
        repoUrl: "git@example.com:demo/repo.git",
      })
      expect(next.name).toBe("hana-prod")
      expect(next.username).toBe("admin")
      expect(next.workspaceRoot).toBe("/srv/opencode")
      expect(next.repoUrl).toBe("git@example.com:demo/repo.git")

      await VM.Delete(two.id)
      expect((await VM.list()).map((item) => item.id)).toEqual([one.id])
    },
  })
})

test("vm resolve supports exact, fuzzy, and ambiguous matches", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const tag = `hana-${Math.random().toString(36).slice(2, 8)}`
      const one = await VM.Create({
        name: `${tag}-primary`,
        hostname: "hana-a.local",
        username: "root",
        authType: "password",
        password: "secret",
      })
      const two = await VM.Create({
        name: `${tag}-replica`,
        ip: "10.10.10.2",
        username: "root",
        authType: "password",
        password: "secret",
      })

      const exact = await VM.resolve(one.id)
      expect(exact.items.map((item) => item.id)).toEqual([one.id])

      const fuzzy = await VM.resolve("10.10")
      expect(fuzzy.items.map((item) => item.id)).toEqual([two.id])

      const wide = await VM.resolve(tag)
      expect(wide.ambiguous).toBe(true)
      expect(wide.items.map((item) => item.id)).toEqual([one.id, two.id])
    },
  })
})

test("vm confirm asks a question for ambiguous matches and caches the selection", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const one = await VM.Create({
        name: "db-east",
        hostname: "db-east.local",
        username: "root",
        authType: "password",
        password: "secret",
      })
      await VM.Create({
        name: "db-west",
        hostname: "db-west.local",
        username: "root",
        authType: "password",
        password: "secret",
      })

      const task = VM.confirm({
        sessionID: "session_test_vm",
        targets: "db",
      })

      let ask = await Question.list()
      for (let i = 0; i < 20 && ask.length === 0; i++) {
        await Bun.sleep(10)
        ask = await Question.list()
      }
      expect(ask).toHaveLength(1)
      expect(ask[0]?.questions[0]?.question).toContain("Select the VM targets")
      expect(ask[0]?.questions[0]?.options).toHaveLength(2)

      await Question.reply({
        requestID: ask[0]!.id,
        answers: [[ask[0]!.questions[0]!.options[0]!.label]],
      })

      const picked = await task
      expect(picked.map((item) => item.id)).toEqual([one.id])

      const cached = await VM.confirm({
        sessionID: "session_test_vm",
        targets: one.id,
      })
      expect(cached.map((item) => item.id)).toEqual([one.id])
    },
  })
})

test("vm activity start and finish persist audit rows", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const vm = await VM.Create({
        name: "logs",
        ip: "10.0.0.8",
        username: "root",
        authType: "password",
        password: "secret",
      })

      const act = await VM.activityStart({
        vmID: vm.id,
        tool: "vm_exec",
        title: "Executing remote command",
        summary: "tailing logs",
      })

      await VM.activityFinish({
        activityID: act.id,
        status: "completed",
        summary: "exit=0 completed",
        exitCode: 0,
        transcript: "ok",
        transcriptPath: "/tmp/tool_output.txt",
      })

      const items = await VM.activity(vm.id)
      expect(items).toHaveLength(1)
      expect(items[0]?.tool).toBe("vm_exec")
      expect(items[0]?.status).toBe("completed")
      expect(items[0]?.exitCode).toBe(0)
      expect(items[0]?.transcript).toBe("ok")
      expect(items[0]?.transcriptPath).toBe("/tmp/tool_output.txt")
    },
  })
})

test("vm connection caches facts, shell probing, and sftp handles per session", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const vm = await VM.Create({
        name: "cache",
        hostname: "cache.local",
        username: "root",
        authType: "password",
        password: "secret",
      })

      const client = { end() {} } as any
      const connect = spyOn(VMSSH, "connect").mockResolvedValue({
        client,
        host: "cache.local",
      })
      const facts = spyOn(VMSSH, "facts").mockResolvedValue({
        osName: "Linux",
        kernel: "6.12",
      })
      const shell = spyOn(VMSSH, "shell").mockResolvedValue("bash")
      const sftp = spyOn(VMSSH, "sftp").mockResolvedValue({} as any)

      try {
        const conn = await VM.connect({
          sessionID: "ses_vm_cache",
          vm,
        })

        expect(await VM.facts({ conn, vmID: vm.id })).toEqual({
          osName: "Linux",
          kernel: "6.12",
        })
        expect(await VM.shell({ conn })).toBe("bash")
        expect(await VM.shell({ conn })).toBe("bash")
        expect(await VM.sftp({ conn })).toBe(await VM.sftp({ conn }))

        expect(connect).toHaveBeenCalledTimes(1)
        expect(facts).toHaveBeenCalledTimes(1)
        expect(shell).toHaveBeenCalledTimes(1)
        expect(sftp).toHaveBeenCalledTimes(1)
      } finally {
        connect.mockRestore()
        facts.mockRestore()
        shell.mockRestore()
        sftp.mockRestore()
      }
    },
  })
})

test("vm operate parallel mode respects concurrency and preserves input order", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const vms = await Promise.all(
        ["one", "two", "three", "four", "five"].map((name, idx) =>
          VM.Create({
            name,
            hostname: `${name}.local`,
            username: "root",
            authType: "password",
            password: "secret",
            port: 22 + idx,
          }),
        ),
      )

      let live = 0
      let peak = 0
      const result = await VMOperate.run({
        ctx: {
          sessionID: session.id,
          abort: new AbortController().signal,
        },
        tool: "vm_exec",
        vms,
        title: "Parallel work",
        mode: "parallel",
        concurrency: 2,
        async work(vm, push) {
          live += 1
          peak = Math.max(peak, live)
          push(`start ${vm.name}`)
          await Bun.sleep(vm.name.length * 5)
          live -= 1
          return vm.name
        },
        done(_vm, value) {
          return {
            summary: value,
            ran: true,
          }
        },
      })

      expect(peak).toBe(2)
      expect(result.results.map((item) => item.vm.id)).toEqual(vms.map((vm) => vm.id))
      expect(result.results.map((item) => item.summary)).toEqual(vms.map((vm) => vm.name))
    },
  })
})

test("vm operate persists large transcripts to disk and stores transcriptPath on activity rows", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const vm = await VM.Create({
        name: "logs",
        hostname: "logs.local",
        username: "root",
        authType: "password",
        password: "secret",
      })
      const body = Array.from({ length: 6000 }, (_, idx) => `line-${idx}`).join("\n")

      const result = await VMOperate.run({
        ctx: {
          sessionID: session.id,
          abort: new AbortController().signal,
        },
        tool: "vm_exec",
        vms: [vm],
        title: "Large output",
        async work() {
          return true
        },
        async done() {
          return {
            summary: "ok",
            ...(await VMOperate.capture(body)),
            ran: true,
          }
        },
      })

      expect(result.output).toContain("truncated")
      const items = await VM.activity(vm.id)
      expect(items[0]?.transcriptPath).toBeDefined()
      expect(items[0]?.transcript).toContain("truncated")
      expect(await Bun.file(items[0]!.transcriptPath!).text()).toBe(body)
    },
  })
})
