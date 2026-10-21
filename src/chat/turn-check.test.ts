// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkTurn, snapshotCheckout } from './turn-check.js'
import { checkoutGitExec } from './write-mode.js'

const execFileAsync = promisify(execFile)
const BRANCH = 'refs/heads/feat'

let repo: string
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
}
const git = async (...args: string[]): Promise<string> =>
  (await execFileAsync('git', args, { cwd: repo, env })).stdout.trim()

beforeEach(async () => {
  repo = await mkdtemp(path.join(os.tmpdir(), 'pr-review-turn-check-'))
  await git('init', '-q', '-b', 'feat')
  await writeFile(path.join(repo, 'a.txt'), 'one\n')
  await git('add', 'a.txt')
  await git('commit', '-q', '-m', 'one')
  await writeFile(path.join(repo, 'a.txt'), 'two\n')
  await git('commit', '-q', '-am', 'two')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

/** Snapshots the checkout, runs what the turn did, and checks the turn. */
async function turn(did: () => Promise<unknown>) {
  const exec = checkoutGitExec(repo)
  const before = await snapshotCheckout(exec)
  await did()
  return checkTurn(exec, before, BRANCH)
}

describe('checkTurn', () => {
  it('reports the commits the turn added to the branch, and nothing else', async () => {
    const report = await turn(async () => {
      await writeFile(path.join(repo, 'a.txt'), 'three\n')
      await git('commit', '-q', '-am', 'three')
      await writeFile(path.join(repo, 'a.txt'), 'four\n')
      await git('commit', '-q', '-am', 'four')
    })
    expect(report.findings).toEqual([])
    expect(report.commits).toEqual((await git('rev-list', '--reverse', 'HEAD~2..HEAD')).split('\n'))
  })

  it('reports a tracked file changed outside a commit, with how to restore it', async () => {
    const report = await turn(() => writeFile(path.join(repo, 'a.txt'), 'one\n'))
    expect(report.findings).toEqual([
      {
        message: 'tracked files changed outside a commit: a.txt',
        fix: 'if these changes are not yours: git restore --staged --worktree --source=HEAD -- a.txt',
      },
    ])
  })

  it('reports files staged and not committed, as a commit stopped in its hooks or a refused reset leaves them', async () => {
    const report = await turn(async () => {
      await writeFile(path.join(repo, 'a.txt'), 'three\n')
      await git('add', 'a.txt')
    })
    expect(report.findings).toEqual([
      {
        message:
          'tracked files staged but not committed: a.txt. A commit stopped while its hooks ran leaves this, as does a refused reset',
        fix: 'check them with git diff --cached, then git commit; if these changes are not yours: git restore --staged --worktree --source=HEAD -- a.txt',
      },
    ])
  })

  it('names a renamed file by its new path, and a path with spaces whole', async () => {
    const report = await turn(async () => {
      await git('mv', 'a.txt', 'b c.txt')
    })
    expect(report.findings[0]?.message).toContain('not committed: b c.txt.')
  })

  it('reports files staged with more changes on top as changed outside a commit', async () => {
    const report = await turn(async () => {
      await writeFile(path.join(repo, 'a.txt'), 'three\n')
      await git('add', 'a.txt')
      await writeFile(path.join(repo, 'a.txt'), 'four\n')
    })
    expect(report.findings[0]?.message).toBe('tracked files changed outside a commit: a.txt')
  })

  it('leaves an untracked file alone', async () => {
    const report = await turn(() => writeFile(path.join(repo, 'new.txt'), 'x'))
    expect(report).toEqual({ commits: [], findings: [] })
  })

  it('reports a branch and a tag the turn added, with how to remove them', async () => {
    const report = await turn(async () => {
      await git('branch', 'side')
      await git('tag', 'v1')
    })
    expect(report.findings).toEqual([
      { message: 'the turn added side', fix: 'git branch -D side' },
      { message: 'the turn added v1', fix: 'git tag -d v1' },
    ])
  })

  it('reports HEAD leaving the branch', async () => {
    await git('branch', 'other')
    const report = await turn(() => git('switch', '-q', 'other'))
    expect(report.findings).toEqual([{ message: 'HEAD left feat for other', fix: 'git switch feat' }])
  })

  it('reports the branch moving back, with where it was', async () => {
    const was = await git('rev-parse', 'HEAD')
    const report = await turn(() => git('reset', '-q', '--hard', 'HEAD~1'))
    expect(report.commits).toEqual([])
    expect(report.findings[0]).toEqual({
      message: `feat moved from ${was.slice(0, 7)} to ${(await git('rev-parse', 'HEAD')).slice(0, 7)}, which is not ahead of it`,
      fix: `git branch -f feat ${was} (or git reset --keep ${was} while on it)`,
    })
  })

  it('reports an operation left in progress, with how to abort it', async () => {
    const report = await turn(() => mkdir(path.join(repo, '.git', 'rebase-merge')))
    expect(report.findings).toEqual([{ message: 'a rebase was left in progress', fix: 'git rebase --abort' }])
  })
})
