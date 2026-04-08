import { describe, expect, spyOn, test } from "bun:test"
import { VMSSH } from "../../src/vm/ssh"
import { VMSignal } from "../../src/vm/signal"

describe("vm.signal", () => {
  test("classifies broken package manager python paths as non-retryable", () => {
    expect(
      VMSignal.exec({
        command: "dnf install -y gcc",
        stderr: "/bin/bash: /usr/bin/dnf: /usr/bin/python3: bad interpreter: No such file or directory",
        code: 126,
        timedOut: false,
        target: "test server",
      }),
    ).toMatchObject({
      tool: "vm_exec",
      category: "package_manager",
      target: "test server",
      failureClass: "pkgmgr_python_missing",
      retryable: false,
      needsEscalation: true,
    })
  })

  test("parses vm preflight command checks", async () => {
    const exec = spyOn(VMSSH, "exec").mockResolvedValue({
      stdout: [
        "DATA|shell|bash",
        "DATA|disk_kb|2048",
        "CHECK|python3|broken|/usr/bin/python3|/bin/sh: /usr/bin/python3: No such file or directory",
        "CHECK|dnf|broken|/usr/bin/dnf|/bin/bash: /usr/bin/dnf: /usr/bin/python3: bad interpreter: No such file or directory",
        "CHECK|yum|broken|/usr/bin/yum|/bin/bash: /usr/bin/yum: /usr/bin/python3: bad interpreter: No such file or directory",
        "CHECK|git|ok|/usr/bin/git|git version 2.43.5",
        "CHECK|bun|missing||",
        "CHECK|node|ok|/usr/bin/node|v22.15.0",
      ].join("\n"),
      stderr: "",
      code: 0,
      timedOut: false,
    })
    try {
      const result = await VMSSH.preflight({} as any)
      expect(result.shell).toBe("bash")
      expect(result.diskKb).toBe(2048)
      expect(result.packageManager).toBe("dnf")
      expect(result.packageManagerReady).toBe(false)
      expect(result.python3.status).toBe("broken")
      expect(result.dnf.status).toBe("broken")
      expect(result.yum.status).toBe("broken")
      expect(result.git.status).toBe("ok")
      expect(result.bun.status).toBe("missing")
      expect(result.node.status).toBe("ok")
    } finally {
      exec.mockRestore()
    }
  })

  test("classifies html rpm downloads as package artifact mismatch even on exit 0", () => {
    expect(
      VMSignal.exec({
        command: "wget -O /tmp/python3.rpm https://rpmfind.net/linux/.../python3.rpm && file /tmp/python3.rpm",
        stdout: "/tmp/python3.rpm: HTML document, ASCII text",
        stderr: "",
        code: 0,
        timedOut: false,
        target: "test server",
      }),
    ).toMatchObject({
      category: "package_manager",
      failureClass: "artifact_mismatch",
      retryable: false,
    })
  })
})
