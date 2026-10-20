// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { SandboxSupport } from '../acpx/sandbox.js'
import { checkoutGitExec, type CheckoutGitExec, writeModeStatus } from './write-mode.js'

const execFileAsync = promisify(execFile)
const SHA = 'a'.repeat(40)

/** A git that answers each command from a table; a command missing from it fails. */
function gitAnswering(answers: Record<string, string>): CheckoutGitExec {
  return async args => {
    const answer = answers[args.join(' ')]
    if (answer === undefined) {
      throw new Error(`git ${args.join(' ')} failed`)
    }
    return answer
  }
}

const ready = {
  'symbolic-ref -q HEAD': 'refs/heads/feat',
  'rev-parse HEAD': SHA,
  'status --porcelain --untracked-files=no': '',
}
const boxed = async (): Promise<SandboxSupport> => ({ available: true })

describe('writeModeStatus', () => {
  it('offers the mode on a branch review whose checkout is clean and at the canvas’s commit', async () => {
    expect(
      await writeModeStatus({ key: 'branch', canvasSha: SHA, git: gitAnswering(ready), sandbox: boxed })
    ).toEqual({
      offered: true,
      branchRef: 'refs/heads/feat',
    })
  })

  it.each([
    ['a pull request', { key: 42 as const }, 'branch review only'],
    ['the uncommitted review', { key: 'uncommitted' as const }, 'branch review only'],
    ['an outdated canvas', { canvasSha: null }, 'canvas is outdated'],
    [
      'a detached checkout',
      { git: gitAnswering({ ...ready, 'symbolic-ref -q HEAD': '' }) },
      'not on a branch',
    ],
    [
      'a checkout ahead of the canvas',
      { git: gitAnswering({ ...ready, 'rev-parse HEAD': 'b'.repeat(40) }) },
      'another commit',
    ],
    [
      'a pending change to a tracked file',
      { git: gitAnswering({ ...ready, 'status --porcelain --untracked-files=no': ' M src/a.ts' }) },
      'commit or stash',
    ],
    [
      'a checkout git cannot read',
      { git: gitAnswering({ 'symbolic-ref -q HEAD': 'refs/heads/feat', 'rev-parse HEAD': SHA }) },
      'could not say',
    ],
    [
      'a machine without the box',
      {
        sandbox: async (): Promise<SandboxSupport> => ({
          available: false,
          reason: 'bubblewrap is not installed',
        }),
      },
      'bubblewrap',
    ],
  ])('refuses %s, and says why', async (_name, overrides, reason) => {
    const status = await writeModeStatus({
      key: 'branch',
      canvasSha: SHA,
      git: gitAnswering(ready),
      sandbox: boxed,
      ...overrides,
    })
    expect(status).toEqual({ offered: false, reason: expect.stringContaining(reason) })
  })
})

describe('checkoutGitExec', () => {
  let repo: string | null = null
  afterEach(async () => {
    if (repo !== null) {
      await rm(repo, { recursive: true, force: true })
      repo = null
    }
  })

  it('answers about a real checkout, untracked files not counting as pending', async () => {
    repo = await mkdtemp(path.join(os.tmpdir(), 'pr-review-write-mode-'))
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    }
    await execFileAsync('git', ['init', '-q', '-b', 'feat'], { cwd: repo })
    await execFileAsync('git', ['commit', '-q', '--allow-empty', '-m', 'a'], { cwd: repo, env })
    await writeFile(path.join(repo, 'new.txt'), 'untracked')
    const git = checkoutGitExec(repo)
    const head = await git(['rev-parse', 'HEAD'])
    expect(await writeModeStatus({ key: 'branch', canvasSha: head, git, sandbox: boxed })).toEqual({
      offered: true,
      branchRef: 'refs/heads/feat',
    })
  })
})
