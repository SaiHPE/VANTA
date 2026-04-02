const pkg = new URL("../../package.json", import.meta.url)

export namespace VMWorker {
  let build: Promise<string> | undefined

  export function version() {
    if (!build) {
      build = Bun.file(pkg)
        .json()
        .then((item) => (item && typeof item === "object" && "version" in item && typeof item.version === "string" ? item.version : "dev"))
    }
    return build
  }

  export function script(input: { version: string }) {
    return `const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const readline = require('readline')
const { spawn } = require('child_process')

const VERSION = ${JSON.stringify(input.version)}
const args = process.argv.slice(2)
const root = (() => {
  const idx = args.indexOf('--workspace')
  if (idx === -1 || !args[idx + 1]) throw new Error('missing --workspace')
  return path.resolve(args[idx + 1])
})()
const jobs = new Map()
const jobroot = path.join(root, '.opencode', 'jobs')
const methods = [
  'capabilities',
  'read',
  'glob',
  'grep',
  'write',
  'delete',
  'job.start',
  'job.logs',
  'job.wait',
  'job.cancel',
]

fs.mkdirSync(jobroot, { recursive: true })

function emit(msg) {
  process.stdout.write(JSON.stringify(msg) + '\\n')
}

function fail(id, err) {
  emit({
    type: 'error',
    id,
    error: err instanceof Error ? (err.stack || err.message) : String(err),
  })
}

function safe(input) {
  const target = path.resolve(path.isAbsolute(input || '.') ? input || '.' : path.join(root, input || '.'))
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('path escapes workspace')
  return target
}

function rel(input) {
  return path.relative(root, input).split(path.sep).join('/')
}

function text(input) {
  const stat = fs.statSync(input)
  if (!stat.isFile()) return false
  const size = Math.min(stat.size, 8192)
  const fd = fs.openSync(input, 'r')
  const buf = Buffer.alloc(size)
  fs.readSync(fd, buf, 0, size, 0)
  fs.closeSync(fd)
  return !buf.includes(0)
}

function globre(input) {
  const raw = input.split('/').join(path.sep)
  const esc = raw
    .replace(/[|\\\\{}()[\\]^$+?.]/g, '\\\\$&')
    .replace(/\\*\\*/g, '::all::')
    .replace(/\\*/g, '[^\\\\/]*')
    .replace(/::all::/g, '.*')
  return new RegExp('^' + esc + '$')
}

function walk(dir, out, base) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = path.join(dir, item.name)
    const name = rel(next)
    if (name.startsWith('.opencode/jobs/')) continue
    if (base && !name.startsWith(base)) continue
    out.push({
      path: next,
      rel: name,
      dir: item.isDirectory(),
    })
    if (item.isDirectory() && !item.isSymbolicLink()) {
      walk(next, out, base)
    }
  }
}

function meta(job) {
  return {
    id: job.id,
    status: job.status,
    command: job.command,
    cwd: job.cwd,
    pid: job.pid,
    started_at: job.startedAt,
    ended_at: job.endedAt,
    exit_code: job.exitCode,
    log_dir: job.dir,
  }
}

async function save(job) {
  await fsp.mkdir(job.dir, { recursive: true })
  await fsp.writeFile(path.join(job.dir, 'meta.json'), JSON.stringify(meta(job), null, 2))
}

async function read(input) {
  const file = safe(input.path || '.')
  const stat = await fsp.stat(file)
  if (stat.isDirectory()) {
    const entries = (await fsp.readdir(file, { withFileTypes: true }))
      .map((item) => item.name + (item.isDirectory() ? '/' : ''))
      .sort((a, b) => a.localeCompare(b))
    const offset = Math.max(1, Number(input.offset || 1))
    const limit = Math.max(1, Number(input.limit || 2000))
    const start = offset - 1
    const items = entries.slice(start, start + limit)
    return {
      kind: 'directory',
      path: file,
      entries: items,
      total: entries.length,
      truncated: start + items.length < entries.length,
      next_offset: start + items.length < entries.length ? offset + items.length : undefined,
    }
  }
  if (!text(file)) throw new Error('cannot read binary file')
  const body = await fsp.readFile(file, 'utf8')
  const lines = body.split(/\\r?\\n/)
  const offset = Math.max(1, Number(input.offset || 1))
  const limit = Math.max(1, Number(input.limit || 2000))
  const start = offset - 1
  const slice = lines.slice(start, start + limit)
  return {
    kind: 'file',
    path: file,
    lines: slice,
    total: lines.length,
    truncated: start + slice.length < lines.length,
    next_offset: start + slice.length < lines.length ? offset + slice.length : undefined,
  }
}

async function glob(input) {
  const file = safe(input.path || '.')
  const stat = await fsp.stat(file)
  const base = rel(file)
  const out = stat.isDirectory() ? [] : [{ path: file, rel: base, dir: false }]
  if (stat.isDirectory()) walk(file, out, base)
  const re = globre(String(input.pattern || '**'))
  return out
    .filter((item) => re.test(item.rel))
    .map((item) => item.path)
    .sort((a, b) => a.localeCompare(b))
}

async function grep(input) {
  const file = safe(input.path || '.')
  const out = []
  const stat = await fsp.stat(file)
  const base = rel(file)
  const all = stat.isDirectory() ? [] : [{ path: file, rel: base, dir: false }]
  if (stat.isDirectory()) walk(file, all, base)
  const re = new RegExp(String(input.pattern || ''), 'm')
  const include = input.include ? globre(String(input.include)) : undefined
  for (const item of all) {
    if (item.dir) continue
    if (include && !include.test(item.rel)) continue
    if (!text(item.path)) continue
    const body = await fsp.readFile(item.path, 'utf8').catch(() => '')
    const lines = body.split(/\\r?\\n/)
    for (let idx = 0; idx < lines.length; idx++) {
      if (!re.test(lines[idx])) continue
      out.push({
        path: item.path,
        line: idx + 1,
        text: lines[idx],
      })
      if (out.length >= 200) return out
    }
  }
  return out
}

async function write(input) {
  const file = safe(input.path)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  if (input.kind === 'symlink') {
    await fsp.rm(file, { recursive: true, force: true })
    await fsp.symlink(String(input.target || ''), file)
    return { path: file, kind: 'symlink' }
  }
  const buf = Buffer.from(String(input.data || ''), input.encoding || 'base64')
  await fsp.writeFile(file, buf)
  if (input.mode) {
    await fsp.chmod(file, Number.parseInt(String(input.mode), 8)).catch(() => undefined)
  }
  return { path: file, kind: 'file', bytes: buf.length }
}

async function remove(input) {
  const file = safe(input.path)
  await fsp.rm(file, { recursive: true, force: true })
  return { path: file }
}

async function start(input) {
  const id = String(input.id || ('job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)))
  const dir = path.join(jobroot, id)
  const log = path.join(dir, 'combined.log')
  await fsp.mkdir(dir, { recursive: true })
  const out = fs.createWriteStream(log, { flags: 'a' })
  const cwd = safe(input.cwd || '.')
  const proc = spawn('/bin/sh', ['-lc', String(input.command || '')], { cwd })
  const job = {
    id,
    dir,
    log,
    command: String(input.command || ''),
    cwd,
    pid: proc.pid,
    proc,
    out,
    status: 'running',
    startedAt: Date.now(),
    endedAt: undefined,
    exitCode: undefined,
    cancelled: false,
    done: undefined,
  }
  jobs.set(id, job)
  await save(job)
  proc.stdout.on('data', (chunk) => out.write(chunk))
  proc.stderr.on('data', (chunk) => out.write(chunk))
  job.done = new Promise((resolve) => {
    proc.on('exit', async (code) => {
      job.endedAt = Date.now()
      job.exitCode = typeof code === 'number' ? code : undefined
      job.status = job.cancelled ? 'cancelled' : code === 0 ? 'completed' : 'failed'
      out.end()
      await save(job)
      resolve(meta(job))
    })
    proc.on('error', async (err) => {
      out.write(String(err && err.stack ? err.stack : err) + '\\n')
      job.endedAt = Date.now()
      job.status = 'failed'
      out.end()
      await save(job)
      resolve(meta(job))
    })
  })
  return meta(job)
}

async function logs(input) {
  const job = jobs.get(String(input.id || ''))
  if (!job) throw new Error('job not found')
  const body = await fsp.readFile(job.log, 'utf8').catch(() => '')
  const tail = Math.max(0, Number(input.tail || 0))
  if (!tail) return { id: job.id, log: body, status: job.status }
  const lines = body.split(/\\r?\\n/)
  return {
    id: job.id,
    log: lines.slice(-tail).join('\\n'),
    status: job.status,
  }
}

async function wait(input) {
  const job = jobs.get(String(input.id || ''))
  if (!job) throw new Error('job not found')
  if (job.status !== 'running') return meta(job)
  const timeout = Math.max(0, Number(input.timeout_ms || 0))
  if (!timeout) return job.done
  return Promise.race([
    job.done,
    new Promise((resolve) =>
      setTimeout(() => resolve({ ...meta(job), status: job.status, timed_out: true }), timeout),
    ),
  ])
}

async function cancel(input) {
  const job = jobs.get(String(input.id || ''))
  if (!job) throw new Error('job not found')
  if (job.status !== 'running') return meta(job)
  job.cancelled = true
  job.proc.kill('SIGTERM')
  setTimeout(() => {
    if (job.status === 'running') job.proc.kill('SIGKILL')
  }, 2000)
  return { ...meta(job), status: 'running' }
}

async function call(method, input) {
  if (method === 'capabilities') return { version: VERSION, methods }
  if (method === 'read') return read(input || {})
  if (method === 'glob') return glob(input || {})
  if (method === 'grep') return grep(input || {})
  if (method === 'write') return write(input || {})
  if (method === 'delete') return remove(input || {})
  if (method === 'job.start') return start(input || {})
  if (method === 'job.logs') return logs(input || {})
  if (method === 'job.wait') return wait(input || {})
  if (method === 'job.cancel') return cancel(input || {})
  throw new Error('unknown method: ' + method)
}

async function close() {
  await Promise.all(
    Array.from(jobs.values()).map(async (job) => {
      if (job.status === 'running') {
        job.cancelled = true
        job.proc.kill('SIGTERM')
      }
    }),
  )
}

process.on('SIGTERM', () => {
  void close().finally(() => process.exit(0))
})

process.on('SIGINT', () => {
  void close().finally(() => process.exit(0))
})

emit({
  type: 'hello',
  version: VERSION,
  pid: process.pid,
})
emit({
  type: 'capabilities',
  capabilities: methods,
})

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

rl.on('line', (line) => {
  void (async () => {
    if (!line.trim()) return
    const msg = JSON.parse(line)
    if (msg.type === 'heartbeat') {
      emit({ type: 'heartbeat', time: Date.now() })
      return
    }
    if (msg.type === 'shutdown') {
      await close()
      emit({ type: 'shutdown', ok: true })
      process.exit(0)
    }
    if (msg.type !== 'call') return
    try {
      const result = await call(msg.method, msg.args)
      emit({ type: 'result', id: msg.id, result })
    } catch (err) {
      fail(msg.id, err)
    }
  })()
})`
  }
}
