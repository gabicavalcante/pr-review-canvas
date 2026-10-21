// @vitest-environment node
import { execFile } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createWriteTurnPreparer, shellTimeoutEnv } from './write-turn.js'

const execFileAsync = promisify(execFile)

describe('createWriteTurnPreparer', () => {
  let root: string | null = null
  afterEach(async () => {
    if (root !== null) {
      await rm(root, { recursive: true, force: true })
      root = null
    }
  })

  it('boxes a Claude turn to the checkout and its git directory, with the guard on for the branch', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pr-review-write-turn-'))
    const checkout = path.join(root, 'repo')
    const home = path.join(root, 'home')
    await execFileAsync('git', ['init', '-q', '-b', 'feat', checkout])
    const dataDir = path.join(checkout, '.pr-review')
    const guardHooksDir = path.join(dataDir, 'git-guard')
    const prepare = createWriteTurnPreparer({
      checkout,
      dataDir,
      reviewDir: key => path.join(dataDir, 'repos', 'o__r', String(key)),
      guardHooksDir,
      home,
      env: {},
    })

    const turn = await prepare({ key: 'branch', agent: 'claude', branchRef: 'refs/heads/feat' })

    const bound = (flag: string, target: string): boolean =>
      turn.box.some((arg, index) => arg === flag && turn.box[index + 2] === target)
    expect(bound('--bind', checkout)).toBe(true)
    expect(bound('--bind', path.join(checkout, '.git'))).toBe(true)
    expect(bound('--ro-bind', dataDir)).toBe(true)
    expect(bound('--ro-bind', path.join(checkout, '.git', 'config'))).toBe(true)
    expect(bound('--ro-bind', path.join(checkout, '.git', 'hooks'))).toBe(true)
    expect(bound('--ro-bind', path.join(home, '.acpx', 'config.json'))).toBe(true)
    expect(turn.box.at(-1)).toBe('--')
    expect(turn.env).toMatchObject({
      GIT_CONFIG_KEY_0: `includeIf.gitdir:${path.join(checkout, '.git')}.path`,
      GIT_CONFIG_VALUE_0: path.join(guardHooksDir, 'config'),
      PR_REVIEW_BRANCH: 'refs/heads/feat',
      PR_REVIEW_ORIG_HOOKS: path.join(checkout, '.git', 'hooks'),
      BASH_DEFAULT_TIMEOUT_MS: '600000',
      BASH_MAX_TIMEOUT_MS: '600000',
    })
    await access(path.join(guardHooksDir, 'reference-transaction'))
  })
})

describe('shellTimeoutEnv', () => {
  it('lets a shell command run ten minutes, or longer when the reader set longer', () => {
    expect(shellTimeoutEnv({})).toEqual({ BASH_DEFAULT_TIMEOUT_MS: '600000', BASH_MAX_TIMEOUT_MS: '600000' })
    expect(shellTimeoutEnv({ BASH_DEFAULT_TIMEOUT_MS: '60000', BASH_MAX_TIMEOUT_MS: '900000' })).toEqual({
      BASH_DEFAULT_TIMEOUT_MS: '600000',
      BASH_MAX_TIMEOUT_MS: '900000',
    })
    expect(shellTimeoutEnv({ BASH_DEFAULT_TIMEOUT_MS: 'soon' })['BASH_DEFAULT_TIMEOUT_MS']).toBe('600000')
  })
})
