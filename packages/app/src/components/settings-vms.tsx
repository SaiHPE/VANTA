import { type VmActivity, type VmAuthType, type VmDetail, type VmSummary } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { A, useParams } from "@solidjs/router"
import { createMemo, createEffect, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"

type Form = {
  name: string
  hostname: string
  ip: string
  port: string
  username: string
  authType: VmAuthType
  password: string
  privateKey: string
  passphrase: string
  notes: string
  workspaceRoot: string
  repoUrl: string
  cacheRoot: string
  maxConcurrency: string
  weight: string
  retryCount: string
  retryBackoffSecs: string
}

const auth = [
  { value: "password" as const, label: "Password" },
  { value: "private_key" as const, label: "Private Key" },
]

function blank(): Form {
  return {
    name: "",
    hostname: "",
    ip: "",
    port: "22",
    username: "",
    authType: "password",
    password: "",
    privateKey: "",
    passphrase: "",
    notes: "",
    workspaceRoot: "",
    repoUrl: "",
    cacheRoot: "",
    maxConcurrency: "1",
    weight: "1",
    retryCount: "0",
    retryBackoffSecs: "2",
  }
}

function fill(vm: Partial<VmDetail>): Form {
  return {
    name: vm.name ?? "",
    hostname: vm.hostname ?? "",
    ip: vm.ip ?? "",
    port: vm.port ? String(vm.port) : "22",
    username: vm.username ?? "",
    authType: vm.authType ?? "password",
    password: vm.password ?? "",
    privateKey: vm.privateKey ?? "",
    passphrase: vm.passphrase ?? "",
    notes: vm.notes ?? "",
    workspaceRoot: vm.workspaceRoot ?? "",
    repoUrl: vm.repoUrl ?? "",
    cacheRoot: vm.cacheRoot ?? "",
    maxConcurrency: vm.maxConcurrency ? String(vm.maxConcurrency) : "1",
    weight: vm.weight ? String(vm.weight) : "1",
    retryCount: vm.retryCount ? String(vm.retryCount) : "0",
    retryBackoffSecs: vm.retryBackoffSecs ? String(vm.retryBackoffSecs) : "2",
  }
}

function trim(value: string) {
  const next = value.trim()
  return next ? next : undefined
}

function data(form: Form) {
  const raw = form.port.trim()
  const port = raw ? Number(raw) : undefined
  const maxConcurrency = Number(form.maxConcurrency.trim())
  const weight = Number(form.weight.trim())
  const retryCount = Number(form.retryCount.trim())
  const retryBackoffSecs = Number(form.retryBackoffSecs.trim())
  return {
    name: form.name.trim(),
    hostname: trim(form.hostname),
    ip: trim(form.ip),
    port: port && Number.isFinite(port) ? port : undefined,
    username: form.username.trim(),
    authType: form.authType,
    password: form.authType === "password" ? trim(form.password) : undefined,
    privateKey: form.authType === "private_key" ? trim(form.privateKey) : undefined,
    passphrase: form.authType === "private_key" ? trim(form.passphrase) : undefined,
    notes: trim(form.notes),
    workspaceRoot: trim(form.workspaceRoot),
    repoUrl: trim(form.repoUrl),
    cacheRoot: trim(form.cacheRoot),
    maxConcurrency: Number.isFinite(maxConcurrency) && maxConcurrency > 0 ? maxConcurrency : undefined,
    weight: Number.isFinite(weight) && weight > 0 ? weight : undefined,
    retryCount: Number.isFinite(retryCount) && retryCount >= 0 ? retryCount : undefined,
    retryBackoffSecs: Number.isFinite(retryBackoffSecs) && retryBackoffSecs > 0 ? retryBackoffSecs : undefined,
  }
}

function same(a: VmDetail, b: Form) {
  const left = data(fill(a))
  const right = data(b)
  return JSON.stringify(left) === JSON.stringify(right)
}

function has(form: Form) {
  return JSON.stringify(form) !== JSON.stringify(blank())
}

function stamp(value?: number) {
  if (!value) return "Never"
  return new Date(value).toLocaleString()
}

function tone(value?: VmSummary["lastStatus"] | VmActivity["status"]) {
  if (value === "ok" || value === "completed") return "bg-surface-success-strong"
  if (value === "error") return "bg-surface-critical-strong"
  if (value === "running") return "bg-surface-warning-strong"
  return "bg-border-strong"
}

function msg(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: unknown } }).data
    if (typeof data?.message === "string" && data.message) return data.message
  }
  if (err && typeof err === "object" && "error" in err) {
    return msg((err as { error?: unknown }).error, fallback)
  }
  if (err && typeof err === "object" && "message" in err) {
    const text = (err as { message?: unknown }).message
    if (typeof text === "string" && text) return text
  }
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "string" && err) return err
  return fallback
}

function Item(props: { label: string; value?: string }) {
  return (
    <div class="flex flex-col gap-0.5 min-w-0">
      <span class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{props.label}</span>
      <span class="text-13-regular text-text-strong break-words">{props.value || "Not set"}</span>
    </div>
  )
}

function Input(props: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  type?: string
}) {
  return (
    <div class="flex flex-col gap-1.5 min-w-0">
      <span class="text-12-medium text-text-strong">{props.label}</span>
      <TextField
        label={props.label}
        hideLabel
        value={props.value}
        type={props.type}
        multiline={props.multiline}
        onChange={props.onChange}
        placeholder={props.placeholder}
        autocorrect="off"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
      />
    </div>
  )
}

export function SettingsVMs() {
  const params = useParams()
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const [form, setForm] = createStore(blank())
  const [state, setState] = createStore({
    selected: undefined as string | undefined,
    fresh: false,
    loading: false,
    saving: false,
    testing: false,
    removing: false,
    detail: undefined as VmDetail | undefined,
    probe: undefined as VmDetail | undefined,
  })
  let seq = 0

  const dir = createMemo(() => decode64(params.dir) ?? "")
  const ctx = createMemo(() => {
    const root = dir()
    if (!root) return
    const child = sync.child(root)
    return {
      dir: root,
      client: sdk.createClient({
        directory: root,
        throwOnError: true,
      }),
      store: child[0],
      set: child[1],
    }
  })
  const list = createMemo(() => ctx()?.store.vm ?? [])
  const current = createMemo(() => list().find((item) => item.id === state.selected))
  const view = createMemo(() => state.probe ?? state.detail ?? current())
  const acts = createMemo(() => {
    const vmID = state.selected
    if (!vmID) return []
    return ctx()?.store.vm_activity[vmID] ?? []
  })
  const dirty = createMemo(() => {
    if (state.detail) return !same(state.detail, form)
    return has(form)
  })

  const vm = async () => {
    const cur = ctx()
    if (!cur) return
    const res = await cur.client.vm.list()
    cur.set("vm", res.data ?? [])
  }

  const activity = async (vmID: string) => {
    const cur = ctx()
    if (!cur) return
    const res = await cur.client.vm.activity({ vmID })
    cur.set("vm_activity", vmID, res.data ?? [])
  }

  const patch = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm(key, value)
    if (state.probe) setState("probe", undefined)
  }

  const fresh = () => {
    seq += 1
    setState({
      selected: undefined,
      fresh: true,
      loading: false,
      detail: undefined,
      probe: undefined,
    })
    setForm(blank())
  }

  const load = async (vmID: string) => {
    const id = ++seq
    setState({
      selected: vmID,
      fresh: false,
      loading: true,
      probe: undefined,
    })
    try {
      const cur = ctx()
      if (!cur) return
      const res = await cur.client.vm.get({ vmID })
      if (id !== seq) return
      if (res.data) {
        setState("detail", res.data)
        setForm(fill(res.data))
      }
      await activity(vmID)
    } catch (err) {
      if (id !== seq) return
      showToast({ title: "Failed to load VM", description: msg(err, "Request failed") })
    } finally {
      if (id !== seq) return
      setState("loading", false)
    }
  }

  const save = async () => {
    setState("saving", true)
    try {
      const cur = ctx()
      if (!cur) return
      const body = data(form)
      const res = state.selected
        ? await cur.client.vm.update({ vmID: state.selected, ...body })
        : await cur.client.vm.create({ vmDraft: body })
      await vm()
      const next = res.data
      if (next) {
        setState({
          selected: next.id,
          fresh: false,
          detail: next,
          probe: undefined,
        })
        setForm(fill(next))
        await activity(next.id)
      }
      showToast({ icon: "circle-check", title: state.selected ? "VM updated" : "VM created" })
    } catch (err) {
      showToast({ title: "Failed to save VM", description: msg(err, "Request failed") })
    } finally {
      setState("saving", false)
    }
  }

  const test = async () => {
    setState("testing", true)
    try {
      const cur = ctx()
      if (!cur) return
      const saved = !!state.selected && !!state.detail && !dirty()
      const res = saved
        ? await cur.client.vm.test({ vmID: state.selected! })
        : await cur.client.vm.testDraft({ vmDraft: data(form) })
      if (res.data) {
        setState("probe", res.data)
        if (saved) {
          setState("detail", res.data)
          await vm()
        }
      }
      showToast({ icon: "circle-check", title: "VM connection succeeded" })
    } catch (err) {
      showToast({ title: "VM connection failed", description: msg(err, "Request failed") })
    } finally {
      setState("testing", false)
    }
  }

  const remove = async () => {
    if (!state.selected) return
    setState("removing", true)
    try {
      const cur = ctx()
      if (!cur) return
      const vmID = state.selected
      await cur.client.vm.delete({ vmID })
      await vm()
      const next = list().find((item) => item.id !== vmID)
      if (next) await load(next.id)
      else fresh()
      showToast({ icon: "circle-check", title: "VM deleted" })
    } catch (err) {
      showToast({ title: "Failed to delete VM", description: msg(err, "Request failed") })
    } finally {
      setState("removing", false)
    }
  }

  onMount(() => {
    void vm()
  })

  createEffect(() => {
    if (!dir()) return
    const items = list()
    if (items.length === 0) {
      if (state.selected) fresh()
      return
    }
    if (state.selected && items.some((item) => item.id === state.selected)) return
    if (state.fresh) return
    void load(items[0]!.id)
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <Show
        when={dir()}
        fallback={
          <div class="pt-10 text-13-regular text-text-weak">
            Open a project first. VM inventory is stored per workspace.
          </div>
        }
      >
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex items-center justify-between gap-3 pt-6 pb-8">
          <div class="flex flex-col gap-1">
            <h2 class="text-16-medium text-text-strong">VMs</h2>
            <span class="text-13-regular text-text-weak">
              Registered Linux targets are stored locally in this project and are available to the execute agent.
            </span>
          </div>
          <Show when={state.selected || list().length > 0}>
            <Button size="small" variant="secondary" icon="plus-small" onClick={fresh}>
              New VM
            </Button>
          </Show>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr)]">
        <div class="flex flex-col gap-3">
          <div class="bg-surface-raised-base rounded-lg p-2">
            <Show
              when={list().length > 0}
              fallback={
                <div class="px-3 py-8 text-center text-13-regular text-text-weak">
                  No VMs have been added to this project yet.
                </div>
              }
            >
              <div class="flex flex-col gap-1">
                <For each={list()}>
                  {(vm) => (
                    <button
                      type="button"
                      class="w-full text-left rounded-md border px-3 py-3 transition-colors"
                      classList={{
                        "border-text-interactive-base bg-surface-info-base/20": state.selected === vm.id,
                        "border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
                          state.selected !== vm.id,
                      }}
                      onClick={() => void load(vm.id)}
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-14-medium text-text-strong truncate">{vm.name}</div>
                          <div class="text-12-regular text-text-weak truncate">{vm.hostname ?? vm.ip ?? "No host"}</div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                          <span class={`size-2 rounded-full ${tone(vm.lastStatus)}`} />
                          <span class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{vm.lastStatus}</span>
                        </div>
                      </div>
                      <div class="pt-2 text-12-regular text-text-weak truncate">{vm.username}</div>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-6 min-w-0">
          <div class="bg-surface-raised-base rounded-lg p-5">
            <div class="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-border-weak-base">
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="text-16-medium text-text-strong">{state.selected ? "Edit VM" : "New VM"}</span>
                  <Show when={dirty()}>
                    <span class="rounded-full bg-surface-warning-strong/15 px-2 py-0.5 text-11-medium text-text-weak">
                      Unsaved
                    </span>
                  </Show>
                </div>
                <span class="text-13-regular text-text-weak">
                  Configure the SSH details the execute agent should use for this machine.
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Button size="small" variant="secondary" onClick={() => void test()} disabled={state.testing}>
                  {state.testing ? "Testing..." : "Test connection"}
                </Button>
                <Button size="small" variant="secondary" onClick={() => void save()} disabled={state.saving}>
                  {state.saving ? "Saving..." : state.selected ? "Save changes" : "Create VM"}
                </Button>
                <Show when={state.selected}>
                  <Button size="small" variant="ghost" onClick={() => void remove()} disabled={state.removing}>
                    {state.removing ? "Deleting..." : "Delete"}
                  </Button>
                </Show>
              </div>
            </div>

            <div class="grid gap-4 pt-5 lg:grid-cols-2">
              <Input
                label="VM name"
                value={form.name}
                onChange={(value) => patch("name", value)}
                placeholder="hana-demo-01"
              />
              <Input
                label="Hostname"
                value={form.hostname}
                onChange={(value) => patch("hostname", value)}
                placeholder="vm.internal.example"
              />
              <Input
                label="IP address"
                value={form.ip}
                onChange={(value) => patch("ip", value)}
                placeholder="10.25.158.120"
              />
              <Input label="Port" value={form.port} onChange={(value) => patch("port", value)} placeholder="22" />
              <Input
                label="Username"
                value={form.username}
                onChange={(value) => patch("username", value)}
                placeholder="root"
              />
              <label class="flex flex-col gap-1.5 min-w-0">
                <span class="text-12-medium text-text-strong">Authentication</span>
                <Select
                  options={auth}
                  current={auth.find((item) => item.value === form.authType)}
                  value={(item) => item.value}
                  label={(item) => item.label}
                  onSelect={(item) => item && patch("authType", item.value)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </label>
            </div>

            <div class="grid gap-4 pt-4">
              <div class="grid gap-4 lg:grid-cols-2">
                <Input
                  label="Workspace root"
                  value={form.workspaceRoot}
                  onChange={(value) => patch("workspaceRoot", value)}
                  placeholder="/var/tmp/opencode"
                />
                <Input
                  label="Repo URL"
                  value={form.repoUrl}
                  onChange={(value) => patch("repoUrl", value)}
                  placeholder="git@github.com:org/repo.git"
                />
                <Input
                  label="Cache root"
                  value={form.cacheRoot}
                  onChange={(value) => patch("cacheRoot", value)}
                  placeholder="/var/tmp/opencode-cache"
                />
                <Input
                  label="Max concurrency"
                  value={form.maxConcurrency}
                  onChange={(value) => patch("maxConcurrency", value)}
                  placeholder="1"
                />
                <Input
                  label="Weight"
                  value={form.weight}
                  onChange={(value) => patch("weight", value)}
                  placeholder="1"
                />
                <Input
                  label="Retry count"
                  value={form.retryCount}
                  onChange={(value) => patch("retryCount", value)}
                  placeholder="0"
                />
                <Input
                  label="Retry backoff secs"
                  value={form.retryBackoffSecs}
                  onChange={(value) => patch("retryBackoffSecs", value)}
                  placeholder="2"
                />
              </div>
              <Show when={form.authType === "password"}>
                <Input
                  label="Password"
                  value={form.password}
                  onChange={(value) => patch("password", value)}
                  type="password"
                />
              </Show>
              <Show when={form.authType === "private_key"}>
                <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr),220px]">
                  <Input
                    label="Private key"
                    value={form.privateKey}
                    onChange={(value) => patch("privateKey", value)}
                    multiline={true}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  />
                  <Input
                    label="Passphrase"
                    value={form.passphrase}
                    onChange={(value) => patch("passphrase", value)}
                    type="password"
                  />
                </div>
              </Show>
              <Input
                label="Notes"
                value={form.notes}
                onChange={(value) => patch("notes", value)}
                multiline={true}
                placeholder="Purpose, workload, or operator notes"
              />
            </div>
          </div>

          <div class="grid gap-6 lg:grid-cols-2">
            <div class="bg-surface-raised-base rounded-lg p-5">
              <div class="pb-4">
                <h3 class="text-14-medium text-text-strong">Connection details</h3>
                <p class="pt-1 text-12-regular text-text-weak">Latest saved or tested facts for this VM.</p>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <Item label="Status" value={view()?.lastStatus} />
                <Item label="Last seen" value={stamp(view()?.lastSeenAt)} />
                <Item label="Hostname" value={view()?.hostname} />
                <Item label="IP address" value={view()?.ip} />
                <Item label="Port" value={view()?.port ? String(view()?.port) : undefined} />
                <Item label="Username" value={view()?.username} />
                <Item label="OS" value={view()?.facts?.osName} />
                <Item label="Version" value={view()?.facts?.osVersion} />
                <Item label="Kernel" value={view()?.facts?.kernel} />
                <Item label="Architecture" value={view()?.facts?.arch} />
                <Item label="Shell" value={view()?.facts?.shell} />
                <Item label="Home" value={view()?.facts?.homeDir} />
                <Item label="Workspace root" value={view()?.workspaceRoot} />
                <Item label="Repo URL" value={view()?.repoUrl} />
                <Item label="Cache root" value={view()?.cacheRoot} />
                <Item
                  label="Max concurrency"
                  value={view()?.maxConcurrency !== undefined ? String(view()?.maxConcurrency) : undefined}
                />
                <Item label="Weight" value={view()?.weight !== undefined ? String(view()?.weight) : undefined} />
                <Item
                  label="Retry count"
                  value={view()?.retryCount !== undefined ? String(view()?.retryCount) : undefined}
                />
                <Item
                  label="Retry backoff secs"
                  value={view()?.retryBackoffSecs !== undefined ? String(view()?.retryBackoffSecs) : undefined}
                />
              </div>
            </div>

            <div class="bg-surface-raised-base rounded-lg p-5">
              <div class="pb-4">
                <h3 class="text-14-medium text-text-strong">Recent activity</h3>
                <p class="pt-1 text-12-regular text-text-weak">
                  Remote actions recorded from execute sessions appear here after the agent runs them.
                </p>
              </div>

              <Show
                when={state.selected}
                fallback={<div class="text-13-regular text-text-weak">Create or select a VM to view its activity.</div>}
              >
                <Show
                  when={acts().length > 0}
                  fallback={
                    <div class="text-13-regular text-text-weak">
                      No remote activity has been recorded for this VM yet.
                    </div>
                  }
                >
                  <div class="flex flex-col gap-2">
                    <For each={acts().slice(0, 12)}>
                      {(act) => (
                        <div class="rounded-md border border-border-weak-base px-3 py-3">
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <div class="text-13-medium text-text-strong truncate">{act.title}</div>
                              <div class="pt-1 text-12-regular text-text-weak break-words">
                                {act.summary || act.tool}
                              </div>
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                              <span class={`size-2 rounded-full ${tone(act.status)}`} />
                              <span class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{act.status}</span>
                            </div>
                          </div>
                          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-11-regular text-text-weak">
                            <span>{stamp(act.startedAt)}</span>
                            <Show when={typeof act.exitCode === "number"}>
                              <span>exit {act.exitCode}</span>
                            </Show>
                            <Show when={act.sessionID}>
                              <A
                                href={`/${base64Encode(dir())}/session/${act.sessionID}`}
                                class="text-text-interactive-base underline"
                              >
                                Open session
                              </A>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </div>

          <Show when={state.loading}>
            <div class="text-12-regular text-text-weak">Loading VM details...</div>
          </Show>
        </div>
      </div>
      </Show>
    </div>
  )
}
