/**
 * Whether AI Chat may change code on a review right now. The reader turns the mode on per review;
 * these are the conditions it needs each time, and the reason the page shows when one fails. Each
 * turn checks them again, since the checkout can change between turns.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SandboxSupport } from '../acpx/sandbox.js'
import type { ChangesCodeStatus } from '../contract/chat.js'
import type { ReviewKey } from '../contract/review-key.js'

const execFileAsync = promisify(execFile)

/** Runs git in the checkout and answers its output, trimmed; rejects when git fails. */
export type CheckoutGitExec = (args: string[]) => Promise<string>

export function checkoutGitExec(checkout: string): CheckoutGitExec {
  return async args => (await execFileAsync('git', args, { cwd: checkout })).stdout.trim()
}

export interface WriteModeInput {
  key: ReviewKey
  /** The commit of the canvas on screen when it describes the head; null for an outdated canvas. */
  canvasSha: string | null
  git: CheckoutGitExec
  sandbox: () => Promise<SandboxSupport>
}

/**
 * A branch review only: a pull request's canvas is what reviewers read, and the uncommitted review
 * is work in progress the agent's edits would mix into. The checkout is on a branch at the canvas's
 * commit, so a change lands on top of what the canvas shows, and no tracked file has a pending
 * change, so a commit carries the agent's change and none of the reader's.
 */
export async function writeModeStatus(input: WriteModeInput): Promise<ChangesCodeStatus> {
  if (input.key !== 'branch') {
    return { offered: false, reason: 'AI Chat changes code on a branch review only' }
  }
  if (input.canvasSha === null) {
    return { offered: false, reason: 'the canvas is outdated; update it for the branch’s last commit first' }
  }
  const branchRef = await input.git(['symbolic-ref', '-q', 'HEAD']).catch(() => null)
  if (branchRef === null || branchRef === '') {
    return { offered: false, reason: 'the checkout is not on a branch' }
  }
  const head = await input.git(['rev-parse', 'HEAD']).catch(() => null)
  if (head !== input.canvasSha) {
    return {
      offered: false,
      reason: 'the checkout is at another commit than the canvas; update the canvas first',
    }
  }
  const pending = await input.git(['status', '--porcelain', '--untracked-files=no']).catch(() => null)
  if (pending === null) {
    return { offered: false, reason: 'git could not say whether the checkout has uncommitted changes' }
  }
  if (pending !== '') {
    return { offered: false, reason: 'tracked files have uncommitted changes; commit or stash them first' }
  }
  const sandbox = await input.sandbox()
  if (!sandbox.available) {
    return { offered: false, reason: sandbox.reason }
  }
  return { offered: true, branchRef }
}
