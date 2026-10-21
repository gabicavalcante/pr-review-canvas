// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acpxSocketDir } from '../acpx/sandbox.js'
import {
  CLAUDE_PROJECT_NAME_MAX,
  claudeProjectDir,
  codexTurnConfig,
  prepareTurnSandbox,
  type TurnSandboxInput,
  TurnSandboxError,
  turnSandbox,
} from './turn-sandbox.js'

const runsLater = [
  '/work/my_repo/.git/config',
  '/work/my_repo/.git/config.worktree',
  '/work/my_repo/.git/hooks',
  '/home/u/.acpx/config.json',
]

const input = (overrides: Partial<TurnSandboxInput> = {}): TurnSandboxInput => ({
  agent: 'claude',
  checkout: '/work/my_repo',
  gitCommonDir: '/work/my_repo/.git',
  gitDir: '/work/my_repo/.git',
  hooksDir: '/work/my_repo/.git/hooks',
  dataDir: '/work/my_repo/.pr-review',
  codexHome: '/work/my_repo/.pr-review/repos/o__r/agent-homes/codex/branch',
  home: '/home/u',
  env: {},
  ...overrides,
})

describe('claudeProjectDir', () => {
  it('names the folder as Claude Code does: every character that is not a letter or a digit becomes -', () => {
    expect(claudeProjectDir('/work/my_repo.v2', '/home/u', {})).toBe(
      '/home/u/.claude/projects/-work-my-repo-v2'
    )
  })

  it('follows CLAUDE_CONFIG_DIR', () => {
    expect(claudeProjectDir('/work/r', '/home/u', { CLAUDE_CONFIG_DIR: '/cfg' })).toBe(
      '/cfg/projects/-work-r'
    )
  })

  it('refuses a path whose folder name Claude Code would shorten', () => {
    const long = `/${'a'.repeat(CLAUDE_PROJECT_NAME_MAX)}`
    expect(() => claudeProjectDir(long, '/home/u', {})).toThrow(TurnSandboxError)
  })
})

describe('turnSandbox', () => {
  it('lets Claude write the repository, acpx state and its sessions, but not its memory or the data dir', () => {
    expect(turnSandbox(input())).toEqual({
      writable: [
        '/work/my_repo',
        '/work/my_repo/.git',
        acpxSocketDir('/home/u'),
        '/home/u/.acpx',
        '/home/u/.npm',
        '/home/u/.claude/projects/-work-my-repo',
      ],
      readOnly: ['/work/my_repo/.pr-review', ...runsLater, '/home/u/.claude/projects/-work-my-repo/memory'],
    })
  })

  it('keeps a linked worktree’s pointers to its git directory read-only, and its hooks wherever core.hooksPath puts them', () => {
    const spec = turnSandbox(
      input({
        checkout: '/work/side',
        gitDir: '/work/my_repo/.git/worktrees/side',
        hooksDir: '/work/side/.githooks',
      })
    )
    expect(spec.writable).toContain('/work/my_repo/.git')
    expect(spec.readOnly).toEqual(
      expect.arrayContaining([
        '/work/my_repo/.git/config',
        '/work/my_repo/.git/worktrees/side/config.worktree',
        '/work/side/.githooks',
        '/work/side/.git',
        '/work/my_repo/.git/worktrees/side/commondir',
      ])
    )
  })

  it('leaves the checkout’s .git writable when it is the git directory itself', () => {
    expect(turnSandbox(input()).readOnly).not.toContain('/work/my_repo/.git')
  })

  it('takes npm’s cache from npm_config_cache when it is set', () => {
    expect(turnSandbox(input({ env: { npm_config_cache: '/cache/npm' } })).writable).toContain('/cache/npm')
  })

  it('gives Codex the review’s own home, with the reader’s login bound writable and the configuration read-only', () => {
    const codexHome = input().codexHome
    expect(turnSandbox(input({ agent: 'codex', env: { CODEX_HOME: '/codex' } }))).toEqual({
      writable: [
        '/work/my_repo',
        '/work/my_repo/.git',
        acpxSocketDir('/home/u'),
        '/home/u/.acpx',
        '/home/u/.npm',
        codexHome,
      ],
      readOnly: ['/work/my_repo/.pr-review', ...runsLater, `${codexHome}/config.toml`],
      binds: [{ source: '/codex/auth.json', target: `${codexHome}/auth.json`, writable: true }],
      env: { CODEX_HOME: codexHome },
    })
  })
})

describe('codexTurnConfig', () => {
  it('keeps the reader’s settings and opens Codex’s sandbox to the git directory', () => {
    const config = codexTurnConfig('model = "gpt-5"\n\n[tui]\ntheme = "dark"\n', '/work/r/.git')
    expect(config).toBe(
      [
        'sandbox_mode = "workspace-write"',
        'model = "gpt-5"',
        '',
        '[tui]',
        'theme = "dark"',
        '',
        '',
        '[sandbox_workspace_write]',
        'writable_roots = ["/work/r/.git"]',
        '',
      ].join('\n')
    )
  })

  it('replaces the reader’s own sandbox settings rather than setting them twice', () => {
    const config = codexTurnConfig(
      'sandbox_mode = "read-only"\nmodel = "gpt-5"\n[sandbox_workspace_write]\nnetwork_access = true\n[tui]\ntheme = "dark"\n',
      '/g'
    )
    expect(config.match(/sandbox_mode/g)).toHaveLength(1)
    expect(config.match(/\[sandbox_workspace_write\]/g)).toHaveLength(1)
    expect(config).not.toContain('network_access')
    expect(config).toContain('[tui]\ntheme = "dark"')
    expect(config).toContain('model = "gpt-5"')
  })
})

describe('prepareTurnSandbox', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  const scratch = async (): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pr-review-turn-sandbox-'))
    dirs.push(dir)
    return dir
  }

  const gitPaths = async (): Promise<Pick<TurnSandboxInput, 'gitCommonDir' | 'gitDir' | 'hooksDir'>> => {
    const gitDir = path.join(await scratch(), '.git')
    return { gitCommonDir: gitDir, gitDir, hooksDir: path.join(gitDir, 'hooks') }
  }

  it('creates the missing hooks folder, worktree configuration and acpx configuration it binds read-only', async () => {
    const home = await scratch()
    const git = await gitPaths()
    await prepareTurnSandbox(input({ home, ...git }))
    expect((await stat(git.hooksDir)).isDirectory()).toBe(true)
    expect(await readFile(path.join(git.gitDir, 'config.worktree'), 'utf8')).toBe('')
    expect(JSON.parse(await readFile(path.join(home, '.acpx', 'config.json'), 'utf8'))).toEqual({})
  })

  it('leaves an acpx configuration the reader already has as it is', async () => {
    const home = await scratch()
    await mkdir(path.join(home, '.acpx'))
    await writeFile(path.join(home, '.acpx', 'config.json'), '{"defaultAgent":"codex"}')
    await prepareTurnSandbox(input({ home, ...(await gitPaths()) }))
    expect(await readFile(path.join(home, '.acpx', 'config.json'), 'utf8')).toBe('{"defaultAgent":"codex"}')
  })

  it('creates Claude’s project and memory folders', async () => {
    const home = await scratch()
    await prepareTurnSandbox(input({ home, ...(await gitPaths()) }))
    expect((await stat(path.join(claudeProjectDir('/work/my_repo', home, {}), 'memory'))).isDirectory()).toBe(
      true
    )
  })

  it('writes the review’s Codex home from the reader’s configuration, with a file for the login to be bound over', async () => {
    const home = await scratch()
    await mkdir(path.join(home, '.codex'))
    await writeFile(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5"\n')
    await writeFile(path.join(home, '.codex', 'auth.json'), '{"token":"t"}')
    const codexHome = path.join(home, 'data', 'codex')
    await prepareTurnSandbox(input({ agent: 'codex', home, codexHome, ...(await gitPaths()) }))
    expect(await readFile(path.join(codexHome, 'config.toml'), 'utf8')).toContain('model = "gpt-5"')
    expect(await readFile(path.join(codexHome, 'auth.json'), 'utf8')).toBe('')
  })

  it('refuses Codex when the reader’s login is not in auth.json', async () => {
    const home = await scratch()
    await expect(
      prepareTurnSandbox(
        input({ agent: 'codex', home, codexHome: path.join(home, 'c'), ...(await gitPaths()) })
      )
    ).rejects.toThrow(TurnSandboxError)
  })
})
