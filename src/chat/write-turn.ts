/**
 * Everything a turn that changes code runs with: the box, made from what the agent may write
 * (`./turn-sandbox.ts`), and the git guard's variables (`./git-guard.ts`). The chat manager asks for
 * it once per such turn, after the conditions of `./write-mode.ts` hold.
 */
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { WriteTurn } from '../acpx/acpx.js'
import { bwrapArgs } from '../acpx/sandbox.js'
import type { ChatAgent } from '../contract/settings.js'
import type { ReviewKey } from '../contract/review-key.js'
import { gitConfigEnv, gitGuardConfig, repositoryHooksDir, writeGuardHooks } from './git-guard.js'
import { prepareTurnSandbox, turnSandbox } from './turn-sandbox.js'

const execFileAsync = promisify(execFile)

export interface WriteTurnRequest {
  key: ReviewKey
  agent: ChatAgent
  /** The branch the turn may move forward, as `refs/heads/<name>`. */
  branchRef: string
}

export type PrepareWriteTurn = (request: WriteTurnRequest) => Promise<WriteTurn>

/** Ten minutes, the longest Claude Code lets a shell command run in the foreground. */
const SHELL_TIMEOUT_MS = 600_000

/**
 * How long Claude Code runs a shell command before it moves it to the background: ten minutes, in
 * place of its two. A commit runs the project's hooks, often its whole test suite, and a command
 * moved to the background is stopped when the turn ends, with the commit unmade. A longer time the
 * reader set is kept. Codex reads neither variable.
 * @param env the reader's environment
 */
export function shellTimeoutEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const atLeast = (name: string): string => {
    const set = Number.parseInt(env[name] ?? '', 10)
    return String(Number.isFinite(set) && set > SHELL_TIMEOUT_MS ? set : SHELL_TIMEOUT_MS)
  }
  return {
    BASH_DEFAULT_TIMEOUT_MS: atLeast('BASH_DEFAULT_TIMEOUT_MS'),
    BASH_MAX_TIMEOUT_MS: atLeast('BASH_MAX_TIMEOUT_MS'),
  }
}

export interface WriteTurnPreparerOptions {
  /** The reader's checkout, which the turn changes. */
  checkout: string
  /** pr-review's data dir, read-only inside the box. */
  dataDir: string
  /** A review's own folder in the data dir, where its Codex home is kept. */
  reviewDir: (key: ReviewKey) => string
  /** Where the guard's hooks are written, once per server. */
  guardHooksDir: string
  home?: string
  env?: NodeJS.ProcessEnv
}

export function createWriteTurnPreparer(opts: WriteTurnPreparerOptions): PrepareWriteTurn {
  const home = opts.home ?? os.homedir()
  const env = opts.env ?? process.env
  let hooksWritten: Promise<void> | null = null
  return async request => {
    hooksWritten ??= writeGuardHooks(opts.guardHooksDir)
    const commonDir = await execFileAsync('git', ['rev-parse', '--git-common-dir'], { cwd: opts.checkout })
    const gitCommonDir = path.resolve(opts.checkout, commonDir.stdout.trim())
    const input = {
      agent: request.agent,
      checkout: opts.checkout,
      gitCommonDir,
      dataDir: opts.dataDir,
      codexHome: path.join(opts.reviewDir(request.key), 'codex-home'),
      home,
      env,
    }
    const [, originalHooksDir] = await Promise.all([
      prepareTurnSandbox(input),
      repositoryHooksDir(opts.checkout),
      hooksWritten,
    ])
    const guard = gitGuardConfig({
      hooksDir: opts.guardHooksDir,
      gitCommonDir,
      branchRef: request.branchRef,
      originalHooksDir,
    })
    return {
      box: bwrapArgs(turnSandbox(input)),
      env: { ...shellTimeoutEnv(env), ...gitConfigEnv(env, guard.pairs), ...guard.env },
    }
  }
}
