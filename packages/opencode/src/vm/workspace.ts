import { Instance } from "@/project/instance"
import { git } from "@/util/git"
import path from "path"

export namespace VMWorkspace {
  export const DEFAULT_CONCURRENCY = 4

  function clean(value?: string | null) {
    const next = value?.trim()
    return next ? next : undefined
  }

  function hash(value: string) {
    return Bun.hash(value).toString(36)
  }

  export function slug(value: string) {
    const next = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
    return next || "ref"
  }

  export function repo(input: {
    repoUrl?: string
    fallback?: string
    vm?: {
      repoUrl?: string
    }
  }) {
    const value = clean(input.repoUrl) ?? clean(input.vm?.repoUrl) ?? clean(input.fallback)
    if (!value) {
      throw new Error("repo_url is required. Set it explicitly, configure repoUrl on the VM, or set a local origin remote.")
    }
    return value
  }

  export function root(input: {
    baseDir?: string
    vm?: {
      workspaceRoot?: string
    }
  }) {
    const value = clean(input.baseDir) ?? clean(input.vm?.workspaceRoot)
    if (!value) {
      throw new Error("base_dir is required. Set it explicitly or configure workspaceRoot on the VM.")
    }
    return value
  }

  export function paths(input: {
    root: string
    projectID: string
    ref: string
  }) {
    const repo = path.posix.join(input.root, input.projectID, "repo")
    const wt = path.posix.join(input.root, input.projectID, "wt", `${slug(input.ref)}-${hash(input.ref)}`)
    return { repo, wt }
  }

  export async function local(input: {
    repoUrl?: boolean
    ref?: boolean
  }) {
    const value = {} as {
      repoUrl?: string
      ref?: string
    }

    if (input.repoUrl) {
      const repo = await git(["remote", "get-url", "origin"], {
        cwd: Instance.worktree,
      })
      const text = clean(repo.text())
      if (!text || repo.exitCode !== 0) {
        throw new Error("Failed to resolve repo_url from local git origin. Set repo_url explicitly or configure repoUrl on the VM.")
      }
      value.repoUrl = text
    }

    if (input.ref) {
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: Instance.worktree,
      })
      const text = clean(branch.text())
      if (branch.exitCode === 0 && text && text !== "HEAD") {
        value.ref = text
        return value
      }

      const head = await git(["rev-parse", "HEAD"], {
        cwd: Instance.worktree,
      })
      const sha = clean(head.text())
      if (!sha || head.exitCode !== 0) {
        throw new Error("Failed to resolve ref from the local git checkout. Set ref explicitly.")
      }
      value.ref = sha
    }

    return value
  }
}
