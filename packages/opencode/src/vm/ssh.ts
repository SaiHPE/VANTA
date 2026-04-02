import { Filesystem } from "@/util/filesystem"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from "ssh2"
import { VMWorkspace } from "./workspace"

export namespace VMSSH {
  export type Auth = {
    hostname?: string
    ip?: string
    port: number
    username: string
    authType: "password" | "private_key"
    password?: string
    privateKey?: string
    passphrase?: string
  }

  export type Facts = {
    osName?: string
    osVersion?: string
    kernel?: string
    arch?: string
    shell?: string
    homeDir?: string
  }

  export type Result = {
    stdout: string
    stderr: string
    code?: number
    signal?: string
    timedOut: boolean
  }

  export type Workspace = {
    workspaceDir: string
    workspaceRef: string
    workspaceRepo: string
    repoUrl: string
  }

  function cfg(input: Auth, host: string): ConnectConfig {
    return {
      host,
      port: input.port,
      username: input.username,
      password: input.authType === "password" ? input.password : undefined,
      privateKey: input.authType === "private_key" ? input.privateKey : undefined,
      passphrase: input.authType === "private_key" ? input.passphrase : undefined,
      tryKeyboard: input.authType === "password",
      readyTimeout: 15_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
    }
  }

  function once<T>(fn: (done: (err?: Error, value?: T) => void) => void) {
    return new Promise<T>((resolve, reject) => {
      fn((err, value) => {
        if (err) {
          reject(err)
          return
        }
        resolve(value as T)
      })
    })
  }

  function quote(input: string) {
    return `'${input.replaceAll(`'`, `'\\''`)}'`
  }

  function script(cmd: string, cwd?: string, shell = "/bin/sh") {
    const base = cwd ? `cd ${quote(cwd)} && ${cmd}` : cmd
    return `${shell} -lc ${quote(base)}`
  }

  function parseRelease(text: string) {
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const idx = line.indexOf("=")
          if (idx === -1) return ["", ""]
          const key = line.slice(0, idx)
          const value = line.slice(idx + 1).replace(/^"/, "").replace(/"$/, "")
          return [key, value]
        })
        .filter(([key]) => key),
    )
  }

  export async function connect(input: {
    auth: Auth
    abort?: AbortSignal
  }): Promise<{ client: Client; host: string }> {
    const hosts = [input.auth.hostname, input.auth.ip].filter((item, idx, all): item is string => {
      if (!item) return false
      return all.indexOf(item) === idx
    })
    if (hosts.length === 0) throw new Error("VM is missing hostname and ip address")

    let err: Error | undefined
    for (const host of hosts) {
      const client = new Client()
      const abort = () => client.end()
      input.abort?.addEventListener("abort", abort, { once: true })
      if (input.auth.authType === "password" && input.auth.password) {
        client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, done) => {
          done(prompts.map(() => input.auth.password!))
        })
      }
      try {
        await once<void>((done) => {
          client.once("ready", () => done(undefined, undefined))
          client.once("error", (cause) => done(cause as Error))
          client.connect(cfg(input.auth, host))
        })
        input.abort?.removeEventListener("abort", abort)
        return { client, host }
      } catch (cause) {
        input.abort?.removeEventListener("abort", abort)
        client.end()
        err = cause as Error
      }
    }

    throw err ?? new Error("Failed to connect to VM")
  }

  export async function end(client: Client) {
    await once<void>((done) => {
      client.once("close", () => done(undefined, undefined))
      client.end()
    }).catch(() => undefined)
  }

  export async function shell(client: Client): Promise<"bash" | "sh"> {
    const probe = await exec({
      client,
      command: "command -v bash >/dev/null 2>&1",
      shell: "sh",
      timeout: 10_000,
    })
    return probe.code === 0 ? "bash" : "sh"
  }

  export async function runtime(client: Client): Promise<"bun" | "node"> {
    const probe = await exec({
      client,
      command: [
        "if command -v bun >/dev/null 2>&1; then",
        "  printf 'bun'",
        "elif command -v node >/dev/null 2>&1; then",
        "  printf 'node'",
        "else",
        "  exit 1",
        "fi",
      ].join("\n"),
      shell: "sh",
      timeout: 10_000,
    })
    const value = probe.stdout.trim()
    if (value === "bun" || value === "node") return value
    throw new Error("Neither bun nor node is available on the VM")
  }

  export async function start(input: {
    client: Client
    command: string
    cwd?: string
    shell?: "bash" | "sh"
    abort?: AbortSignal
  }) {
    const cmd = script(input.command, input.cwd, input.shell === "bash" ? "/bin/bash" : "/bin/sh")
    return once<ClientChannel>((done) => {
      input.client.exec(cmd, (err, stream) => {
        if (err) {
          done(err)
          return
        }
        const abort = () => stream.close()
        input.abort?.addEventListener("abort", abort, { once: true })
        stream.once("close", () => input.abort?.removeEventListener("abort", abort))
        stream.once("error", () => input.abort?.removeEventListener("abort", abort))
        done(undefined, stream)
      })
    })
  }

  export async function exec(input: {
    client: Client
    command: string
    cwd?: string
    timeout?: number
    shell?: "auto" | "bash" | "sh"
    abort?: AbortSignal
    onData?: (chunk: { text: string; stream: "stdout" | "stderr" }) => void
  }): Promise<Result> {
    const run = async (shell: "bash" | "sh", command = input.command) => {
      const stdout: string[] = []
      const stderr: string[] = []
      const timer = input.timeout
      const cmd = script(command, input.cwd, shell === "bash" ? "/bin/bash" : "/bin/sh")

      return once<Result>((done) => {
        let finished = false
        let timedOut = false
        let code: number | undefined
        let signal: string | undefined
        let timeout: ReturnType<typeof setTimeout> | undefined

        const finish = (err?: Error) => {
          if (finished) return
          finished = true
          if (timeout) clearTimeout(timeout)
          if (err) {
            done(err)
            return
          }
          done(undefined, {
            stdout: stdout.join(""),
            stderr: stderr.join(""),
            code,
            signal,
            timedOut,
          })
        }

        input.client.exec(cmd, (err, stream) => {
          if (err) {
            finish(err)
            return
          }

          timeout =
            timer && timer > 0
              ? setTimeout(() => {
                  timedOut = true
                  stream.close()
                }, timer)
              : undefined

          const abort = () => stream.close()
          input.abort?.addEventListener("abort", abort, { once: true })

          stream.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8")
            stdout.push(text)
            input.onData?.({ text, stream: "stdout" })
          })
          stream.stderr.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8")
            stderr.push(text)
            input.onData?.({ text, stream: "stderr" })
          })
          stream.on("exit", (nextCode: number | null, nextSignal: string | null) => {
            code = typeof nextCode === "number" ? nextCode : undefined
            signal = nextSignal ?? undefined
          })
          stream.on("close", () => {
            input.abort?.removeEventListener("abort", abort)
            finish()
          })
          stream.on("error", (cause: Error) => {
            input.abort?.removeEventListener("abort", abort)
            finish(cause)
          })
        })
      })
    }

    const mode = input.shell ?? "auto"
    if (mode === "bash") return run("bash")
    if (mode === "sh") return run("sh")
    return run(await shell(input.client))
  }

  export async function facts(client: Client): Promise<Facts> {
    const marker = "__OPENCODE_VM__"
    const result = await exec({
      client,
      command: [
        "cat /etc/os-release 2>/dev/null || true",
        `printf '\\n${marker}\\n'`,
        "uname -sr 2>/dev/null || true",
        `printf '\\n${marker}\\n'`,
        "uname -m 2>/dev/null || true",
        `printf '\\n${marker}\\n'`,
        "printf '%s' \"${SHELL:-}\"",
        `printf '\\n${marker}\\n'`,
        "printf '%s' \"${HOME:-}\"",
      ].join("; "),
      shell: "sh",
      timeout: 10_000,
    })
    const [release = "", kernel = "", arch = "", shell = "", homeDir = ""] = result.stdout.split(marker)
    const data = parseRelease(release)
    return {
      osName: data.PRETTY_NAME ?? data.NAME,
      osVersion: data.VERSION_ID ?? data.VERSION,
      kernel: kernel.trim() || undefined,
      arch: arch.trim() || undefined,
      shell: shell.trim() || undefined,
      homeDir: homeDir.trim() || undefined,
    }
  }

  export async function sftp(client: Client) {
    return once<SFTPWrapper>((done) => {
      client.sftp((err, value) => {
        if (err) {
          done(err)
          return
        }
        done(undefined, value)
      })
    })
  }

  export async function mkdir(client: Client, dir: string) {
    await exec({
      client,
      command: `mkdir -p ${quote(dir)}`,
      shell: "sh",
      timeout: 30_000,
    })
  }

  export async function upload(input: {
    client: Client
    dest: string
    srcPath?: string
    content?: string
    mode?: string
    createDirs?: boolean
    sftp?: Promise<SFTPWrapper> | SFTPWrapper
  }) {
    if (!!input.srcPath === !!input.content) {
      throw new Error("Provide exactly one of srcPath or content")
    }

    const file = input.srcPath
      ? path.resolve(input.srcPath)
      : path.join(os.tmpdir(), "opencode-vm-upload-" + Math.random().toString(36).slice(2))

    if (!input.srcPath) {
      await Bun.write(file, input.content ?? "")
    }

    try {
      if (input.createDirs !== false) {
        await mkdir(input.client, path.posix.dirname(input.dest))
      }
      const sftpClient = await (input.sftp ?? sftp(input.client))
      await once<void>((done) => {
        sftpClient.fastPut(file, input.dest, (err) => done(err as Error | undefined, undefined))
      })
      if (input.mode) {
        await exec({
          client: input.client,
          command: `chmod ${quote(input.mode)} ${quote(input.dest)}`,
          shell: "sh",
          timeout: 30_000,
        })
      }
    } finally {
      if (!input.srcPath) {
        await fs.rm(file, { force: true }).catch(() => undefined)
      }
    }
  }

  export async function download(input: {
    client: Client
    remote: string
    localName?: string
    sftp?: Promise<SFTPWrapper> | SFTPWrapper
  }) {
    const name = input.localName ?? path.posix.basename(input.remote)
    const file = path.join(os.tmpdir(), "opencode-vm-download-" + Math.random().toString(36).slice(2))
    const sftpClient = await (input.sftp ?? sftp(input.client))
    try {
      await once<void>((done) => {
        sftpClient.fastGet(input.remote, file, (err) => done(err as Error | undefined, undefined))
      })
      const bytes = await Bun.file(file).bytes()
      const mime = Filesystem.mimeType(name)
      return {
        name,
        mime,
        url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
      }
    } finally {
      await fs.rm(file, { force: true }).catch(() => undefined)
    }
  }

  export async function workspace(input: {
    client: Client
    baseDir: string
    projectID: string
    repoUrl: string
    ref: string
    sparsePaths?: string[]
    cacheRoot?: string
    cacheDirs?: string[]
  }): Promise<Workspace> {
    const paths = VMWorkspace.paths({
      root: input.baseDir,
      projectID: input.projectID,
      repoUrl: input.repoUrl,
      ref: input.ref,
    })
    const sparse = (input.sparsePaths ?? []).map(VMWorkspace.relative)
    const cache = (input.cacheDirs ?? []).map(VMWorkspace.relative)
    const lines = [
      "set -eu",
      "command -v git >/dev/null 2>&1 || { echo 'git is required on the VM' >&2; exit 1; }",
      `mirror=${quote(paths.mirror)}`,
      `wt=${quote(paths.wt)}`,
      `url=${quote(input.repoUrl)}`,
      `ref=${quote(input.ref)}`,
      "dir=$(dirname \"$mirror\")",
      "mkdir -p \"$dir\"",
      "if [ -e \"$mirror\" ] && [ ! -d \"$mirror\" ]; then",
      "  echo \"workspace mirror path is not a directory: $mirror\" >&2",
      "  exit 1",
      "fi",
      "if [ ! -d \"$mirror\" ]; then",
      "  git clone --mirror \"$url\" \"$mirror\"",
      "fi",
      "current=$(git -C \"$mirror\" remote get-url origin 2>/dev/null || true)",
      "if [ -n \"$current\" ] && [ \"$current\" != \"$url\" ]; then",
      "  echo \"workspace mirror origin mismatch: expected $url got $current\" >&2",
      "  exit 1",
      "fi",
      "if [ -z \"$current\" ]; then",
      "  git -C \"$mirror\" remote add origin \"$url\"",
      "fi",
      "git -C \"$mirror\" fetch --prune origin \"$ref\"",
      "rev=$(git -C \"$mirror\" rev-parse FETCH_HEAD)",
      "parent=$(dirname \"$wt\")",
      "mkdir -p \"$parent\"",
      "if [ -e \"$wt\" ] && [ ! -d \"$wt\" ]; then",
      "  echo \"workspace path is not a directory: $wt\" >&2",
      "  exit 1",
      "fi",
      "if [ -d \"$wt\" ]; then",
      "  git -C \"$wt\" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo \"workspace path is not a git worktree: $wt\" >&2; exit 1; }",
      "else",
      "  git -C \"$mirror\" worktree add --force --detach \"$wt\" \"$rev\"",
      "fi",
    ]
    if (sparse.length > 0) {
      lines.push("tmp=$(mktemp)")
      lines.push(`printf '%s\\n' ${sparse.map((item) => quote(item)).join(" ")} > \"$tmp\"`)
      lines.push("git -C \"$wt\" sparse-checkout init --no-cone >/dev/null 2>&1 || true")
      lines.push("git -C \"$wt\" sparse-checkout set --stdin < \"$tmp\"")
      lines.push("rm -f \"$tmp\"")
    } else {
      lines.push("git -C \"$wt\" sparse-checkout disable >/dev/null 2>&1 || true")
    }
    lines.push("git -C \"$wt\" reset --hard \"$rev\"")
    if (input.cacheRoot && cache.length > 0) {
      cache.forEach((dir) => {
        lines.push(`shared=${quote(VMWorkspace.cache({ root: input.cacheRoot!, projectID: input.projectID, dir }))}`)
        lines.push(`link=${quote(path.posix.join(paths.wt, dir))}`)
        lines.push("mkdir -p \"$shared\"")
        lines.push("mkdir -p \"$(dirname \"$link\")\"")
        lines.push("if [ -e \"$link\" ] && [ ! -L \"$link\" ]; then")
        lines.push("  echo \"cache link target already exists: $link\" >&2")
        lines.push("  exit 1")
        lines.push("fi")
        lines.push("rm -f \"$link\"")
        lines.push("ln -s \"$shared\" \"$link\"")
      })
    }
    lines.push(`printf '%s\\n' \"$wt\" \"$rev\" \"$mirror\" \"$url\"`)
    const result = await exec({
      client: input.client,
      shell: "sh",
      timeout: 120_000,
      command: lines.join("\n"),
    })
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `Failed to prepare workspace for ${input.ref}`)
    }
    const [workspaceDir = "", workspaceRef = "", workspaceRepo = "", repoUrl = ""] = result.stdout
      .trim()
      .split(/\r?\n/)
    if (!workspaceDir || !workspaceRef || !workspaceRepo) {
      throw new Error("Workspace preparation did not return the expected metadata")
    }
    return {
      workspaceDir,
      workspaceRef,
      workspaceRepo,
      repoUrl: repoUrl || input.repoUrl,
    }
  }
}
