import z from "zod"

export namespace PermissionNext {
  export const Request = z.any()
  export type Request = any

  export const Rule = z.any()
  export type Rule = any

  export const Ruleset = z.any()
  export type Ruleset = any

  export const Action = z.any()
  export type Action = any

  export function fromConfig(permission: any): any[] { return [] }
  export function merge(...rulesets: any[]): any[] { return [] }
  export function evaluate(...args: any[]): any { return "allow" }
  export class DeniedError extends Error {
    constructor(...args: any[]) { super("Denied") }
  }
}
