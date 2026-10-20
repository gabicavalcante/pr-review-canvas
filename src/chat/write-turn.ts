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
    const input = {
      agent: request.agent,
      checkout: opts.checkout,
      gitCommonDir: path.resolve(opts.checkout, commonDir.stdout.trim()),
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
      branchRef: request.branchRef,
      originalHooksDir,
    })
    return { box: bwrapArgs(turnSandbox(input)), env: { ...gitConfigEnv(env, guard.pairs), ...guard.env } }
  }
}
