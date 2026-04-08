export namespace VMSignal {
  export type Info = {
    tool: string
    category?: string
    target?: string
    failureClass?: string
    retryable?: boolean
    needsEscalation?: boolean
    hint?: string
  }

  function text(input: string | undefined) {
    return input?.trim()
  }

  function body(stdout?: string, stderr?: string) {
    return [text(stdout), text(stderr)].filter(Boolean).join("\n\n")
  }

  function target(input: unknown) {
    if (typeof input === "string") return input
    if (!Array.isArray(input)) return
    const out = input.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    if (out.length === 0) return
    return out.join(",")
  }

  function category(command: string) {
    const low = command.toLowerCase()
    if (/\b(wget|curl|file|head)\b/.test(low) && (/\.rpm\b/.test(low) || /rpmfind|rpm\.pbone|packages\//.test(low))) {
      return "package_manager"
    }
    if (/\b(dnf|yum|apt-get|apt|apk|zypper|pacman|rpm)\b/.test(low)) return "package_manager"
    if (/\b(systemctl|service)\b/.test(low)) return "service"
    if (/\bgit\b/.test(low)) return "git"
    return "shell"
  }

  function signal(base: Info, text: string) {
    const low = text.toLowerCase()
    if (/bad interpreter: .*python3/i.test(text) || /python3(\.\d+)?: .*no such file or directory/i.test(text)) {
      if (base.category === "package_manager") {
        return {
          ...base,
          failureClass: "pkgmgr_python_missing",
          retryable: false,
          needsEscalation: true,
          hint: "repair the VM's system python3 before retrying dnf or yum",
        } satisfies Info
      }
      return {
        ...base,
        failureClass: "python_missing",
        retryable: false,
        needsEscalation: true,
        hint: "repair the VM's system python3 before retrying this path",
      } satisfies Info
    }
    if (base.category === "package_manager" && /command not found/.test(low)) {
      return {
        ...base,
        failureClass: "package_manager_missing",
        retryable: false,
        needsEscalation: true,
        hint: "install or restore the VM package manager before retrying package operations",
      } satisfies Info
    }
    if (/could not resolve host|temporary failure in name resolution|name or service not known/i.test(text)) {
      return {
        ...base,
        failureClass: "network_dns",
        retryable: true,
        needsEscalation: false,
        hint: "check DNS or repository host reachability from the VM",
      } satisfies Info
    }
    if (/404 not found|status code 404/i.test(low)) {
      return {
        ...base,
        failureClass: "source_missing",
        retryable: false,
        needsEscalation: false,
        hint: "the selected package or document URL does not exist; resolve a real source before retrying",
      } satisfies Info
    }
    if (/html document|text\/html|<!doctype html>|<html/i.test(low)) {
      return {
        ...base,
        failureClass: "artifact_mismatch",
        retryable: false,
        needsEscalation: false,
        hint: "the downloaded artifact is HTML, not the package or binary you expected",
      } satisfies Info
    }
    if (/not an rpm package|package manifest/i.test(low)) {
      return {
        ...base,
        failureClass: "artifact_mismatch",
        retryable: false,
        needsEscalation: false,
        hint: "the downloaded artifact is not a valid rpm package",
      } satisfies Info
    }
    if (/: empty$/im.test(text) || /saved \[0\]/i.test(low)) {
      return {
        ...base,
        failureClass: "empty_artifact",
        retryable: false,
        needsEscalation: false,
        hint: "the downloaded artifact is empty; verify the source and authentication before retrying",
      } satisfies Info
    }
    if (/permission denied|operation not permitted/i.test(low)) {
      return {
        ...base,
        failureClass: "permission_denied",
        retryable: false,
        needsEscalation: true,
        hint: "use the correct privileges or sudo policy before retrying",
      } satisfies Info
    }
    return base
  }

  export function plan(input: {
    tool: string
    args?: Record<string, unknown>
  }): Info {
    if (input.tool === "vm_exec") {
      const command = typeof input.args?.command === "string" ? input.args.command : ""
      return {
        tool: input.tool,
        category: category(command),
        target: target(input.args?.targets),
      } satisfies Info
    }
    if (input.tool === "vm_preflight") {
      return {
        tool: input.tool,
        category: "preflight",
        target: target(input.args?.targets),
      } satisfies Info
    }
    return {
      tool: input.tool,
      target: target(input.args?.targets),
    } satisfies Info
  }

  export function exec(input: {
    command: string
    stdout?: string
    stderr?: string
    code?: number
    timedOut: boolean
    target?: string
  }): Info {
    const base = {
      tool: "vm_exec",
      category: category(input.command),
      target: input.target,
    } satisfies Info
    const next = signal(base, body(input.stdout, input.stderr))
    if (input.timedOut) {
      return {
        ...base,
        failureClass: "command_timeout",
        retryable: true,
        needsEscalation: false,
        hint: "increase the timeout or inspect live progress before retrying",
      } satisfies Info
    }
    if (input.code === 0) return next.failureClass ? next : base
    if (next.failureClass) return next
    if (base.category === "package_manager") {
      return {
        ...base,
        failureClass: "package_command_failed",
        retryable: false,
        needsEscalation: false,
        hint: "the package-related command failed without improving the environment",
      } satisfies Info
    }
    return {
      ...base,
      failureClass: "command_failed",
      retryable: false,
      needsEscalation: false,
      hint: "the command failed without a recognized recoverable condition",
    } satisfies Info
  }

  export function err(input: {
    tool: string
    args?: Record<string, unknown>
    error: string
  }): Info {
    return signal(plan({ tool: input.tool, args: input.args }), input.error)
  }

  export function preflight(input: {
    target?: string
    python3: { status: string }
    dnf: { status: string; detail?: string }
    yum: { status: string; detail?: string }
  }): Info {
    const base = {
      tool: "vm_preflight",
      category: "preflight",
      target: input.target,
    } satisfies Info
    if (input.python3.status === "broken" && (input.dnf.status === "broken" || input.yum.status === "broken")) {
      return {
        ...base,
        failureClass: "pkgmgr_python_missing",
        retryable: false,
        needsEscalation: true,
        hint: "repair the VM's system python3 before retrying dnf or yum",
      } satisfies Info
    }
    if (input.dnf.status === "missing" && input.yum.status === "missing") {
      return {
        ...base,
        failureClass: "package_manager_missing",
        retryable: false,
        needsEscalation: true,
        hint: "install or restore a supported package manager before package operations",
      } satisfies Info
    }
    return base
  }

  export function lines(input: Info) {
    return [
      input.category ? `plan_category=${input.category}` : "",
      input.target ? `target=${input.target}` : "",
      input.failureClass ? `failure_class=${input.failureClass}` : "",
      typeof input.retryable === "boolean" ? `retryable=${input.retryable}` : "",
      typeof input.needsEscalation === "boolean" ? `needs_escalation=${input.needsEscalation}` : "",
      input.hint ? `hint=${input.hint}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  }

  export function common(input: Info[]) {
    if (input.length === 0) return
    const take = <T extends keyof Info>(key: T) => {
      const one = input[0]?.[key]
      if (one === undefined) return
      if (input.every((item) => item[key] === one)) return one
    }
    return {
      tool: take("tool") ?? input[0]!.tool,
      category: take("category"),
      target: take("target"),
      failureClass: take("failureClass"),
      retryable: take("retryable"),
      needsEscalation: take("needsEscalation"),
      hint: take("hint"),
    } satisfies Info
  }
}
