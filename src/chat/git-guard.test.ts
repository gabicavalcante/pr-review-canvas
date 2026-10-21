// @vitest-environment node
import { execFile } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gitConfigEnv, gitGuardConfig, repositoryHooksDir, writeGuardHooks } from './git-guard.js'

const execFileAsync = promisify(execFile)

describe('gitConfigEnv', () => {
  it('numbers the pairs from zero', () => {
    expect(gitConfigEnv({}, [['core.hooksPath', '/h']])).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: '/h',
    })
  })

  it('numbers them after the pairs the environment already has, which stay', () => {
    expect(gitConfigEnv({ GIT_CONFIG_COUNT: '2' }, [['a.b', 'c']])).toEqual({
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_2: 'a.b',
      GIT_CONFIG_VALUE_2: 'c',
    })
  })
})

describe('the guard in a real repository', () => {
  let root: string
  let hooksDir: string
  const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env) =>
    execFileAsync('git', args, {
      cwd,
      env: {
        ...env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    })

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pr-review-git-guard-'))
    hooksDir = path.join(root, 'guard-hooks')
    await writeGuardHooks(hooksDir)
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** A repository on `feat` with two commits, a branch `other`, and a pre-commit hook that logs each run. */
  const repository = async (): Promise<string> => {
    const repo = await mkdtemp(path.join(root, 'repo-'))
    await git(repo, ['init', '-q', '-b', 'feat'])
    await writeFile(path.join(repo, 'f'), 'a\n')
    await git(repo, ['add', 'f'])
    await git(repo, ['commit', '-q', '-m', 'a'])
    await writeFile(path.join(repo, 'f'), 'b\n')
    await git(repo, ['commit', '-q', '-am', 'b'])
    await git(repo, ['branch', 'other'])
    const hook = path.join(repo, '.git', 'hooks', 'pre-commit')
    await writeFile(hook, `#!/bin/sh\necho ran >> "${path.join(repo, 'precommit.log')}"\n`)
    await chmod(hook, 0o755)
    return repo
  }

  const refs = async (repo: string): Promise<string> => {
    const { stdout } = await git(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])
    const head = await git(repo, ['symbolic-ref', '-q', 'HEAD']).then(
      result => result.stdout,
      () => 'detached'
    )
    return `${stdout}${head}`
  }

  /** The environment of a turn on `repo`'s `feat`. */
  const guardEnv = async (repo: string): Promise<NodeJS.ProcessEnv> => {
    const guard = gitGuardConfig({
      hooksDir,
      gitCommonDir: path.join(repo, '.git'),
      branchRef: 'refs/heads/feat',
      originalHooksDir: await repositoryHooksDir(repo),
    })
    return { ...process.env, ...gitConfigEnv(process.env, guard.pairs), ...guard.env }
  }

  /**
   * Runs `args` in `cwd`, `repo` itself unless given, with the guard on for `repo`, and says
   * whether git refused it and whether any ref of `cwd` moved.
   */
  const guarded = async (
    repo: string,
    args: string[],
    cwd: string = repo
  ): Promise<{ refused: boolean; moved: boolean; message: string }> => {
    const env = await guardEnv(repo)
    const before = await refs(cwd)
    const outcome = await git(cwd, args, env).then(
      () => ({ refused: false, message: '' }),
      (err: { stderr?: string }) => ({ refused: true, message: err.stderr ?? '' })
    )
    return { ...outcome, moved: (await refs(cwd)) !== before }
  }

  it('lets a commit through and still runs the repository’s own pre-commit', async () => {
    const repo = await repository()
    await writeFile(path.join(repo, 'f'), 'c\n')
    expect(await guarded(repo, ['commit', '-q', '-am', 'c'])).toMatchObject({ refused: false, moved: true })
    expect(await readFile(path.join(repo, 'precommit.log'), 'utf8')).toBe('ran\n')
  })

  it('lets a revert through, which moves the branch forward', async () => {
    const repo = await repository()
    expect(await guarded(repo, ['revert', '--no-edit', 'HEAD'])).toMatchObject({
      refused: false,
      moved: true,
    })
  })

  it.each([
    ['an amend', ['commit', '-q', '--amend', '-m', 'b2'], 'forward only'],
    ['a reset backwards', ['reset', '-q', '--hard', 'HEAD~1'], 'forward only'],
    ['a switch to another branch', ['checkout', '-q', 'other'], 'HEAD stays on'],
    ['a detached HEAD', ['checkout', '-q', '--detach'], 'HEAD stays on'],
    ['a new branch', ['branch', 'newb'], 'not refs/heads/newb'],
    ['moving another branch', ['branch', '-f', 'other', 'HEAD~1'], 'not refs/heads/other'],
    ['a tag', ['tag', 'v1'], 'not refs/tags/v1'],
  ])('refuses %s, and no ref moves', async (_name, args, message) => {
    const repo = await repository()
    const result = await guarded(repo, args)
    expect(result).toMatchObject({ refused: true, moved: false })
    expect(result.message).toContain(message)
  })

  it('refuses a stash, which would take the turn’s changes off the branch', async () => {
    const repo = await repository()
    await writeFile(path.join(repo, 'f'), 'c\n')
    expect(await guarded(repo, ['stash', '-q'])).toMatchObject({ refused: true, moved: false })
  })

  it('refuses a rebase, which leaves the branch where it was', async () => {
    const repo = await repository()
    const result = await guarded(repo, [
      '-c',
      'sequence.editor=true',
      'rebase',
      '-q',
      '--root',
      '--force-rebase',
    ])
    expect(result).toMatchObject({ refused: true, moved: false })
  })

  it('lets a fetch update remote-tracking refs', async () => {
    const repo = await repository()
    expect(await guarded(repo, ['update-ref', 'refs/remotes/origin/feat', 'HEAD'])).toMatchObject({
      refused: false,
    })
  })

  it('finds the repository’s hooks where its own core.hooksPath points', async () => {
    const repo = await repository()
    await mkdir(path.join(repo, '.githooks'))
    await git(repo, ['config', 'core.hooksPath', '.githooks'])
    expect(await repositoryHooksDir(repo)).toBe(path.join(repo, '.githooks'))
  })

  /** A repository with a bare remote `origin` at `url`, which the remote's path is turned into. */
  const withRemote = async (url: (bare: string) => string): Promise<{ repo: string; bare: string }> => {
    const repo = await repository()
    const bare = await mkdtemp(path.join(root, 'remote-'))
    await git(bare, ['init', '-q', '--bare'])
    await git(repo, ['remote', 'add', 'origin', url(bare)])
    await git(repo, ['push', '-q', 'origin', 'feat'])
    await writeFile(path.join(repo, 'f'), 'c\n')
    await git(repo, ['commit', '-q', '-am', 'c'])
    return { repo, bare }
  }

  const remoteHead = async (bare: string): Promise<string> =>
    (await git(bare, ['rev-parse', 'refs/heads/feat'])).stdout.trim()

  it('refuses a push to a URL, even past the pre-push hook', async () => {
    const { repo, bare } = await withRemote(dir => `file://${dir}`)
    const before = await remoteHead(bare)
    expect(await guarded(repo, ['push', '-q', 'origin', 'feat'])).toMatchObject({ refused: true })
    expect(await guarded(repo, ['push', '-q', '--no-verify', 'origin', 'feat'])).toMatchObject({
      refused: true,
    })
    expect(await remoteHead(bare)).toBe(before)
  })

  it('refuses a push to a remote given as a plain path, which no URL rewrite covers', async () => {
    const { repo, bare } = await withRemote(dir => dir)
    const before = await remoteHead(bare)
    const result = await guarded(repo, ['push', '-q', 'origin', 'feat'])
    expect(result).toMatchObject({ refused: true })
    expect(result.message).toContain('does not push')
    expect(await remoteHead(bare)).toBe(before)
  })

  it('guards a worktree of the reader’s clone, which shares its refs', async () => {
    const repo = await repository()
    const worktree = path.join(await mkdtemp(path.join(root, 'worktree-')), 'wt')
    await git(repo, ['worktree', 'add', '-q', worktree, 'other'])
    await writeFile(path.join(worktree, 'f'), 'c\n')
    const result = await guarded(repo, ['commit', '-q', '-am', 'c'], worktree)
    expect(result).toMatchObject({ refused: true, moved: false })
    expect(result.message).toContain('not refs/heads/other')
  })

  it('leaves a repository the turn makes to itself, with its own HEAD and its own hooks', async () => {
    const repo = await repository()
    const scratch = path.join(await mkdtemp(path.join(root, 'scratch-')), 'repo')
    // A test's fixture repository, made and committed to while the turn runs.
    const env = await guardEnv(repo)
    await git(root, ['init', '-q', '-b', 'main', scratch], env)
    const hook = path.join(scratch, '.git', 'hooks', 'pre-commit')
    await writeFile(hook, `#!/bin/sh\necho own >> "${path.join(scratch, 'precommit.log')}"\n`)
    await chmod(hook, 0o755)
    await writeFile(path.join(scratch, 'f'), 'a\n')
    await git(scratch, ['add', 'f'], env)
    expect(await guarded(repo, ['commit', '-q', '-m', 'a'], scratch)).toMatchObject({
      refused: false,
      moved: true,
    })
    expect(await guarded(repo, ['checkout', '-q', '-b', 'side'], scratch)).toMatchObject({ refused: false })
    expect(await readFile(path.join(scratch, 'precommit.log'), 'utf8')).toBe('own\n')
    await expect(access(path.join(repo, 'precommit.log'))).rejects.toThrow()
  })

  it('lets a repository the turn makes push to a local one, and to the network from none', async () => {
    const repo = await repository()
    const scratch = path.join(await mkdtemp(path.join(root, 'scratch-')), 'repo')
    const bare = await mkdtemp(path.join(root, 'remote-'))
    await git(bare, ['init', '-q', '--bare'])
    await git(root, ['clone', '-q', repo, scratch])
    await git(scratch, ['remote', 'add', 'local', `file://${bare}`])
    await git(scratch, ['remote', 'add', 'network', 'https://example.invalid/r.git'])
    expect(await guarded(repo, ['push', '-q', 'local', 'feat'], scratch)).toMatchObject({ refused: false })
    expect(await remoteHead(bare)).toBe((await git(repo, ['rev-parse', 'feat'])).stdout.trim())
    const network = await guarded(repo, ['push', '-q', 'network', 'feat'], scratch)
    expect(network).toMatchObject({ refused: true })
    expect(network.message).toContain('pr-review-push-blocked')
  })

  it('still fetches', async () => {
    const { repo } = await withRemote(dir => `file://${dir}`)
    expect(await guarded(repo, ['fetch', '-q', 'origin'])).toMatchObject({ refused: false })
  })
})
