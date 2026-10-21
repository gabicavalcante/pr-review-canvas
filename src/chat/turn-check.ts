/**
 * What a turn that changes code did to the checkout, read from git before and after it: the
 * commits it added to the branch, and anything else that moved, each with how to put it back.
 * The ref guard refuses most of it, but not all (`-c core.hooksPath=`, `git clean`), and a refused
 * `git reset --hard` has already rewritten the files. Nothing here is undone for the reader: a
 * file that changed may be their own edit, made in a terminal while the turn ran.
 */
import { access } from 'node:fs/promises'
import path from 'node:path'
import type { ChangesReport, TurnFinding } from '../contract/chat.js'
import type { CheckoutGitExec } from './write-mode.js'

/** What git keeps in the git directory while an operation waits to be finished or aborted. */
const OPERATIONS: readonly { file: string; name: string; abort: string }[] = [
  { file: 'rebase-merge', name: 'a rebase', abort: 'git rebase --abort' },
  { file: 'rebase-apply', name: 'a rebase', abort: 'git rebase --abort' },
  { file: 'MERGE_HEAD', name: 'a merge', abort: 'git merge --abort' },
  { file: 'CHERRY_PICK_HEAD', name: 'a cherry-pick', abort: 'git cherry-pick --abort' },
  { file: 'REVERT_HEAD', name: 'a revert', abort: 'git revert --abort' },
]

export interface CheckoutSnapshot {
  head: string | null
  /** `refs/heads/<name>` HEAD is on, or null when it is detached. */
  branchRef: string | null
  /** Local refs, branches, tags and the stash, to their commits. Remote-tracking refs are a fetch's. */
  refs: Record<string, string>
  /** Tracked files with a change not committed, as `git status` names them. */
  pending: string[]
  /** The operation left in progress, as OPERATIONS names it, or null. */
  operation: (typeof OPERATIONS)[number] | null
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false
  )
}

/**
 * The path one line of `git status --porcelain=v2` names, the new one for a rename. The fields
 * before it are as many as the line's kind has: `1` a change, `2` a rename with its score, `u` a
 * conflict. Version 2 writes `.` for no change, so the line keeps its fields when git's output is
 * trimmed, where version 1's leading space was lost along with the path's first letter.
 */
function statusPath(line: string): string {
  const fields = line.split(' ')
  const kind = fields[0]
  const rest = fields.slice(kind === '2' ? 9 : kind === 'u' ? 10 : 8).join(' ')
  return kind === '2' ? (rest.split('\t')[0] ?? rest) : rest
}

export async function snapshotCheckout(git: CheckoutGitExec): Promise<CheckoutSnapshot> {
  const [head, branchRef, refLines, status, gitDir] = await Promise.all([
    git(['rev-parse', 'HEAD']).catch(() => null),
    git(['symbolic-ref', '-q', 'HEAD']).catch(() => null),
    git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags', 'refs/stash']),
    git(['status', '--porcelain=v2', '--untracked-files=no']),
    git(['rev-parse', '--absolute-git-dir']),
  ])
  const refs = Object.fromEntries(
    refLines
      .split('\n')
      .filter(line => line !== '')
      .map(line => line.split(' ') as [string, string])
  )
  const pending = status
    .split('\n')
    .filter(line => line !== '')
    .map(statusPath)
  let operation: CheckoutSnapshot['operation'] = null
  for (const candidate of OPERATIONS) {
    if (await exists(path.join(gitDir, candidate.file))) {
      operation = candidate
      break
    }
  }
  return { head, branchRef: branchRef === '' ? null : branchRef, refs, pending, operation }
}

function shortRef(ref: string): string {
  return ref.replace(/^refs\/(heads|tags)\//, '')
}

function removal(ref: string): string {
  if (ref.startsWith('refs/heads/')) {
    return `git branch -D ${shortRef(ref)}`
  }
  if (ref.startsWith('refs/tags/')) {
    return `git tag -d ${shortRef(ref)}`
  }
  return 'git stash list, then git stash drop the entry the turn added'
}

/**
 * Compares the checkout after a turn with the snapshot before it. `branchRef` is the branch the turn
 * started on; its commits that descend from where it was are the turn's, and anything else is a
 * finding.
 */
export async function checkTurn(
  git: CheckoutGitExec,
  before: CheckoutSnapshot,
  branchRef: string
): Promise<ChangesReport> {
  const after = await snapshotCheckout(git)
  const findings: TurnFinding[] = []
  const branch = shortRef(branchRef)

  if (after.branchRef !== branchRef) {
    findings.push({
      message:
        after.branchRef === null
          ? `HEAD left ${branch} and is detached at ${after.head?.slice(0, 7) ?? 'no commit'}`
          : `HEAD left ${branch} for ${shortRef(after.branchRef)}`,
      fix: `git switch ${branch}`,
    })
  }

  const was = before.refs[branchRef]
  const now = after.refs[branchRef]
  let commits: string[] = []
  if (was !== undefined && now !== undefined && now !== was) {
    const forward = await git(['merge-base', '--is-ancestor', was, now]).then(
      () => true,
      () => false
    )
    if (forward) {
      commits = (await git(['rev-list', '--reverse', `${was}..${now}`]))
        .split('\n')
        .filter(line => line !== '')
    } else {
      findings.push({
        message: `${branch} moved from ${was.slice(0, 7)} to ${now.slice(0, 7)}, which is not ahead of it`,
        fix: `git branch -f ${branch} ${was} (or git reset --keep ${was} while on it)`,
      })
    }
  }

  for (const ref of new Set([...Object.keys(before.refs), ...Object.keys(after.refs)])) {
    if (ref === branchRef || before.refs[ref] === after.refs[ref]) {
      continue
    }
    const old = before.refs[ref]
    const moved = after.refs[ref]
    if (old === undefined) {
      findings.push({ message: `the turn added ${shortRef(ref)}`, fix: removal(ref) })
    } else if (moved === undefined) {
      findings.push({ message: `the turn removed ${shortRef(ref)}`, fix: `git update-ref ${ref} ${old}` })
    } else {
      findings.push({ message: `the turn moved ${shortRef(ref)}`, fix: `git update-ref ${ref} ${old}` })
    }
  }

  if (after.operation !== null && after.operation.file !== before.operation?.file) {
    findings.push({ message: `${after.operation.name} was left in progress`, fix: after.operation.abort })
  }

  if (after.pending.length > 0) {
    findings.push({
      message: `tracked files changed outside a commit: ${after.pending.join(', ')}`,
      fix: `if these changes are not yours: git restore --staged --worktree --source=HEAD -- ${after.pending.join(' ')}`,
    })
  }

  return { commits, findings }
}

/** The before and after of a turn that changes code, over one checkout. */
export interface TurnCheck {
  snapshot(): Promise<CheckoutSnapshot>
  check(before: CheckoutSnapshot, branchRef: string): Promise<ChangesReport>
}

export function createTurnCheck(git: CheckoutGitExec): TurnCheck {
  return {
    snapshot: () => snapshotCheckout(git),
    check: (before, branchRef) => checkTurn(git, before, branchRef),
  }
}
