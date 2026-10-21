/**
 * What a turn that changes code may write, per agent, as the box of `../acpx/sandbox.ts` takes it.
 * The repository and its git directory, acpx's own state, and the agent's sessions are writable;
 * the agent's memory and settings, pr-review's data dir, and whatever git or acpx later runs commands
 * from outside the box stay read-only. The paths come from
 * running each agent inside the box (the spike log of the RFC
 * `2026-10-20-author-chat-changes-code-on-branch-canvas`).
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { acpxSocketDir, type SandboxSpec } from '../acpx/sandbox.js'
import type { ChatAgent } from '../contract/settings.js'

/**
 * Claude Code names a project's folder by its path with every character that is not a letter or a
 * digit made `-`. It shortens longer names in a way of its own, so past this length the folder is
 * not known, and the turn is not boxed with a guess.
 */
export const CLAUDE_PROJECT_NAME_MAX = 200

export class TurnSandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TurnSandboxError'
  }
}

export interface TurnSandboxInput {
  agent: ChatAgent
  /** The reader's checkout the turn changes. */
  checkout: string
  /** `git rev-parse --git-common-dir` of the checkout: a linked worktree's objects and refs live there. */
  gitCommonDir: string
  /** `git rev-parse --absolute-git-dir`: the common dir, or a linked worktree's own folder in it. */
  gitDir: string
  /** `git rev-parse --git-path hooks`, which follows `core.hooksPath`. */
  hooksDir: string
  /** pr-review's data dir, which may sit inside the checkout and stays read-only. */
  dataDir: string
  /** Where this review keeps a Codex home of its own (see `prepareTurnSandbox`). */
  codexHome: string
  home: string
  env: NodeJS.ProcessEnv
}

/** The folder Claude Code keeps a project's sessions in, and its memory folder inside it. */
export function claudeProjectDir(checkout: string, home: string, env: NodeJS.ProcessEnv): string {
  const name = path.resolve(checkout).replace(/[^a-zA-Z0-9]/g, '-')
  if (name.length > CLAUDE_PROJECT_NAME_MAX) {
    throw new TurnSandboxError(
      `the checkout's path is too long for Claude Code's session folder to be known (${name.length} characters)`
    )
  }
  return path.join(env['CLAUDE_CONFIG_DIR'] ?? path.join(home, '.claude'), 'projects', name)
}

/** The Codex home the reader logged in with, whose `auth.json` and `config.toml` the turn uses. */
export function readerCodexHome(home: string, env: NodeJS.ProcessEnv): string {
  return env['CODEX_HOME'] ?? path.join(home, '.codex')
}

/** What every agent needs: the repository, and acpx with the adapter `npx` starts. */
function commonWritable(input: TurnSandboxInput): string[] {
  return [
    input.checkout,
    input.gitCommonDir,
    acpxSocketDir(input.home),
    path.join(input.home, '.acpx'),
    input.env['npm_config_cache'] ?? path.join(input.home, '.npm'),
  ]
}

function acpxConfig(home: string): string {
  return path.join(home, '.acpx', 'config.json')
}

/**
 * What git and acpx read commands from when they run later outside the box, by the reader, the
 * server, or a turn that only reads: git's hooks and configuration (`core.fsmonitor`, an alias), a
 * linked worktree's pointers to its git directory, which could point git at a configuration the
 * turn wrote, and acpx's configuration, which names the command each agent starts. A commit needs
 * none of them written. Each has to exist for the box to bind it, so `prepareTurnSandbox` creates
 * the missing ones: skipping one would leave it to be created inside the writable folder it sits in.
 */
function runsLater(input: TurnSandboxInput): string[] {
  const paths = [
    path.join(input.gitCommonDir, 'config'),
    path.join(input.gitDir, 'config.worktree'),
    input.hooksDir,
    acpxConfig(input.home),
  ]
  if (path.resolve(input.gitDir) !== path.resolve(input.gitCommonDir)) {
    paths.push(path.join(input.checkout, '.git'), path.join(input.gitDir, 'commondir'))
  }
  return paths
}

export function turnSandbox(input: TurnSandboxInput): SandboxSpec {
  const common = commonWritable(input)
  if (input.agent === 'claude') {
    const project = claudeProjectDir(input.checkout, input.home, input.env)
    return {
      writable: [...common, project],
      readOnly: [input.dataDir, ...runsLater(input), path.join(project, 'memory')],
    }
  }
  return {
    writable: [...common, input.codexHome],
    readOnly: [input.dataDir, ...runsLater(input), path.join(input.codexHome, 'config.toml')],
    binds: [
      {
        // A refreshed login has to reach the reader's own file, or their session keeps a token the
        // refresh revoked.
        source: path.join(readerCodexHome(input.home, input.env), 'auth.json'),
        target: path.join(input.codexHome, 'auth.json'),
        writable: true,
      },
    ],
    env: { CODEX_HOME: input.codexHome },
  }
}

/**
 * The reader's Codex configuration with its sandbox opened to the repository's git directory. Codex
 * keeps `.git` read-only in its own `workspace-write` sandbox, which would refuse every commit; the
 * box around it already keeps the turn inside the repository. Any sandbox settings of the reader's
 * are replaced, since TOML refuses a key set twice.
 */
export function codexTurnConfig(readerConfig: string, gitCommonDir: string): string {
  const kept: string[] = []
  let table: string | null = null
  for (const line of readerConfig.split('\n')) {
    const header = /^\s*\[([^\]]+)\]/.exec(line)
    if (header !== null) {
      table = header[1]?.trim() ?? null
    }
    if (table === 'sandbox_workspace_write') {
      continue
    }
    if (table === null && /^\s*sandbox_mode\s*=/.test(line)) {
      continue
    }
    kept.push(line)
  }
  return [
    'sandbox_mode = "workspace-write"',
    ...kept,
    '',
    '[sandbox_workspace_write]',
    `writable_roots = [${JSON.stringify(gitCommonDir)}]`,
    '',
  ].join('\n')
}

/** Writes `content` to a file that does not exist yet, and leaves one that does as it is. */
async function createFile(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, content, { flag: 'wx' }).catch((err: unknown) => {
    if (!(typeof err === 'object' && err !== null && 'code' in err && err.code === 'EEXIST')) {
      throw err
    }
  })
}

/**
 * Creates what the box binds and the agent expects to find: the read-only paths of `runsLater`,
 * then Claude's project and memory folders, or the review's Codex home with its generated
 * configuration and a file `auth.json` is bound over.
 */
export async function prepareTurnSandbox(input: TurnSandboxInput): Promise<void> {
  await mkdir(acpxSocketDir(input.home), { recursive: true, mode: 0o700 })
  await mkdir(input.hooksDir, { recursive: true })
  // Git reads an empty configuration file as no settings, and acpx an empty object as no config.
  await createFile(path.join(input.gitDir, 'config.worktree'), '')
  await createFile(acpxConfig(input.home), '{}\n')
  if (input.agent === 'claude') {
    await mkdir(path.join(claudeProjectDir(input.checkout, input.home, input.env), 'memory'), {
      recursive: true,
    })
    return
  }
  const reader = readerCodexHome(input.home, input.env)
  try {
    await access(path.join(reader, 'auth.json'))
  } catch {
    throw new TurnSandboxError(
      `Codex keeps no login in ${path.join(reader, 'auth.json')}, which a turn that changes code needs`
    )
  }
  const readerConfig = await readFile(path.join(reader, 'config.toml'), 'utf8').catch(() => '')
  await mkdir(input.codexHome, { recursive: true, mode: 0o700 })
  await writeFile(
    path.join(input.codexHome, 'config.toml'),
    codexTurnConfig(readerConfig, input.gitCommonDir)
  )
  await writeFile(path.join(input.codexHome, 'auth.json'), '', { flag: 'a', mode: 0o600 })
}
