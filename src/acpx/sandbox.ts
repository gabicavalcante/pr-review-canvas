/**
 * The box a turn that may change code runs in. On Linux it is bubblewrap: the whole filesystem
 * read-only, with the paths the turn needs bound writable on top. The box goes in front of acpx, so
 * acpx, the agent it starts, and the process acpx keeps alive between turns all run inside it.
 * Other platforms have no box yet, and a turn that writes is not offered there.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const BWRAP_BIN = 'bwrap'

/** One path the box shows: `source` on the host, at `target` inside, writable or not. */
export interface SandboxBind {
  source: string
  target: string
  writable: boolean
}

export interface SandboxSpec {
  /** Paths the turn may write, each at the same place inside the box. */
  writable: readonly string[]
  /** Paths inside a writable one that stay read-only, such as an agent's memory folder. */
  readOnly?: readonly string[]
  /** Paths shown somewhere other than where they are on the host. */
  binds?: readonly SandboxBind[]
  /** Variables set inside the box, over the environment acpx is started with. */
  env?: Readonly<Record<string, string>>
}

/**
 * Where acpx keeps the sockets of the processes it leaves running between turns:
 * `/tmp/acpx-<the first 10 hex digits of sha256(home)>`, as `queueSocketBaseDir` in acpx 0.19
 * computes it. The box has a `/tmp` of its own, so this one directory is shared into it, or the next
 * turn cannot reach the process the last one left.
 */
export function acpxSocketDir(home: string): string {
  return path.join('/tmp', `acpx-${createHash('sha256').update(home).digest('hex').slice(0, 10)}`)
}

/**
 * The bubblewrap arguments up to and including `--`, for the command that follows. A parent is
 * bound before anything inside it, so a read-only path wins over the writable folder it sits in.
 */
export function bwrapArgs(spec: SandboxSpec): string[] {
  const binds: SandboxBind[] = [
    ...spec.writable.map(p => ({ source: p, target: p, writable: true })),
    ...(spec.binds ?? []),
    ...(spec.readOnly ?? []).map(p => ({ source: p, target: p, writable: false })),
  ]
  const depth = (bind: SandboxBind): number => path.resolve(bind.target).split(path.sep).length
  // Array.prototype.sort is stable, so binds of the same depth keep the order above.
  const ordered = [...binds].sort((first, second) => depth(first) - depth(second))
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp']
  for (const bind of ordered) {
    args.push(bind.writable ? '--bind' : '--ro-bind', bind.source, bind.target)
  }
  for (const [name, value] of Object.entries(spec.env ?? {})) {
    args.push('--setenv', name, value)
  }
  args.push('--die-with-parent', '--')
  return args
}

export type SandboxSupport = { available: true } | { available: false; reason: string }

export type SandboxExec = (file: string, args: string[]) => Promise<unknown>

/**
 * Whether this machine can start the box: Linux, with bubblewrap installed and allowed to create
 * the namespaces it needs, which a hardened kernel or a container can forbid.
 */
export async function sandboxSupport(
  platform: NodeJS.Platform = process.platform,
  exec: SandboxExec = (file, args) => execFileAsync(file, args, { timeout: 10_000 })
): Promise<SandboxSupport> {
  if (platform !== 'linux') {
    return { available: false, reason: `changing code from AI Chat needs Linux; this is ${platform}` }
  }
  try {
    await exec(BWRAP_BIN, ['--ro-bind', '/', '/', '--dev', '/dev', '--', 'true'])
    return { available: true }
  } catch (err) {
    const missing = typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
    return {
      available: false,
      reason: missing
        ? 'bubblewrap is not installed; install the `bubblewrap` package to let AI Chat change code'
        : 'bubblewrap is installed but could not start a sandbox here',
    }
  }
}
