// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { acpxSocketDir, BWRAP_BIN, bwrapArgs, sandboxSupport } from './sandbox.js'

const execFileAsync = promisify(execFile)

describe('acpxSocketDir', () => {
  it('names the directory acpx 0.19 derives from the home directory', () => {
    // sha256('/home/someone') starts with 9a5c216cbf.
    expect(acpxSocketDir('/home/someone')).toBe('/tmp/acpx-9a5c216cbf')
  })
})

describe('bwrapArgs', () => {
  it('shows the filesystem read-only, gives the box its own /tmp, and ends before the command', () => {
    const args = bwrapArgs({ writable: [] })
    expect(args.slice(0, 9)).toEqual([
      '--ro-bind',
      '/',
      '/',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--tmpfs',
      '/tmp',
    ])
    expect(args.slice(-2)).toEqual(['--die-with-parent', '--'])
  })

  it('binds a folder before what sits inside it, so a read-only path wins over its writable parent', () => {
    const args = bwrapArgs({
      writable: ['/home/u/.claude/projects/repo', '/repo'],
      readOnly: ['/home/u/.claude/projects/repo/memory'],
      binds: [{ source: '/home/u/.codex/auth.json', target: '/data/codex/auth.json', writable: true }],
    })
    expect(args.slice(9, -2)).toEqual([
      ...['--bind', '/repo', '/repo'],
      ...['--bind', '/home/u/.codex/auth.json', '/data/codex/auth.json'],
      ...['--bind', '/home/u/.claude/projects/repo', '/home/u/.claude/projects/repo'],
      ...['--ro-bind', '/home/u/.claude/projects/repo/memory', '/home/u/.claude/projects/repo/memory'],
    ])
  })

  it('sets the variables the spec names inside the box', () => {
    const args = bwrapArgs({ writable: [], env: { CODEX_HOME: '/data/codex' } })
    expect(args.slice(9, -2)).toEqual(['--setenv', 'CODEX_HOME', '/data/codex'])
  })
})

describe('sandboxSupport', () => {
  it('is unavailable off Linux, with the platform in the reason', async () => {
    const support = await sandboxSupport('darwin', async () => undefined)
    expect(support).toEqual({ available: false, reason: expect.stringContaining('darwin') })
  })

  it('is available when bubblewrap starts', async () => {
    const calls: string[][] = []
    const support = await sandboxSupport('linux', async (file, args) => {
      calls.push([file, ...args])
    })
    expect(support).toEqual({ available: true })
    expect(calls[0]?.[0]).toBe(BWRAP_BIN)
  })

  it('says to install bubblewrap when it is missing', async () => {
    const support = await sandboxSupport('linux', async () => {
      throw Object.assign(new Error('spawn bwrap ENOENT'), { code: 'ENOENT' })
    })
    expect(support).toEqual({
      available: false,
      reason: expect.stringContaining('install the `bubblewrap` package'),
    })
  })

  it('says bubblewrap could not start when it fails for another reason', async () => {
    const support = await sandboxSupport('linux', async () => {
      throw Object.assign(new Error('bwrap: No permissions to create new namespace'), { code: 1 })
    })
    expect(support).toEqual({ available: false, reason: expect.stringContaining('could not start') })
  })
})

describe('the box on this machine', async () => {
  const support = await sandboxSupport()
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it.skipIf(!support.available)('lets a command write where the spec allows, and nowhere else', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'pr-review-sandbox-'))
    // Outside /tmp, which the box replaces with an empty one: the box must refuse a folder that is
    // there and writable on the host, not one it does not show at all.
    const cache = path.join(process.cwd(), 'node_modules', '.cache')
    await mkdir(cache, { recursive: true })
    const outside = await mkdtemp(path.join(cache, 'pr-review-sandbox-'))
    dirs.push(repo, outside)
    const memory = path.join(repo, 'memory')
    await mkdir(memory)
    const script = [
      `echo in > ${repo}/in.txt`,
      `(echo note > ${memory}/note.md) 2>/dev/null || echo memory-refused`,
      `(echo out > ${outside}/out.txt) 2>/dev/null || echo outside-refused`,
    ].join('; ')
    const { stdout } = await execFileAsync(BWRAP_BIN, [
      ...bwrapArgs({ writable: [repo], readOnly: [memory] }),
      'sh',
      '-c',
      script,
    ])
    expect(stdout.split('\n').filter(Boolean)).toEqual(['memory-refused', 'outside-refused'])
    expect(await readFile(path.join(repo, 'in.txt'), 'utf8')).toBe('in\n')
    await expect(readFile(path.join(outside, 'out.txt'), 'utf8')).rejects.toThrow()
  })
})
