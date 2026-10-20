/**
 * The git side of a turn that changes code: the turn may move the branch it started on forward,
 * and no other ref. A `reference-transaction` hook refuses the rest (amend, reset, rebase, a branch
 * switch, a new branch, tag or stash) before git applies it. git 2.53 runs no such hook declared in
 * configuration, so `core.hooksPath` points at a folder of pr-review's whose every hook runs the
 * repository's own afterwards. It is set through `GIT_CONFIG_*` in the turn's environment, so
 * nothing is written to the repository, and git run anywhere else is untouched. A push is refused
 * twice over: push URLs are rewritten to none that works, and the pre-push hook refuses.
 *
 * It guards against the agent's mistakes, not against an agent set on getting around it: one
 * `git -c core.hooksPath=` skips it. The check after the turn reports what got past.
 */
import { execFile } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** The hooks git runs on the client side; each shim passes its call on to the repository's own. */
export const CLIENT_HOOKS = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'post-rewrite',
  'reference-transaction',
  'push-to-checkout',
  'pre-auto-gc',
  'post-index-change',
] as const

/**
 * Reads the transaction git is about to apply, one `<old> <new> <ref>` per line, and exits non-zero
 * to refuse it. Pseudo-refs (`AUTO_MERGE`, `ORIG_HEAD`, `CHERRY_PICK_HEAD`, …) are git's own
 * bookkeeping and pass, as do remote-tracking refs a fetch updates.
 */
export const GUARD_SCRIPT = `#!/bin/sh
[ "$1" = prepared ] || exit 0
zero=0000000000000000000000000000000000000000
while read -r old new ref; do
  case "$ref" in
    refs/remotes/*) continue ;;
    HEAD)
      [ "$new" = "ref:$PR_REVIEW_BRANCH" ] && continue
      echo "pr-review: HEAD stays on $PR_REVIEW_BRANCH during an AI Chat turn" >&2
      exit 1 ;;
    refs/*)
      if [ "$ref" != "$PR_REVIEW_BRANCH" ]; then
        echo "pr-review: an AI Chat turn may change $PR_REVIEW_BRANCH only, not $ref" >&2
        exit 1
      fi
      if [ "$old" != "$zero" ] && ! git merge-base --is-ancestor "$old" "$new"; then
        echo "pr-review: an AI Chat turn moves $ref forward only" >&2
        exit 1
      fi ;;
  esac
done
exit 0
`

function shim(hook: (typeof CLIENT_HOOKS)[number]): string {
  const original = `orig="$PR_REVIEW_ORIG_HOOKS/${hook}"`
  if (hook === 'reference-transaction') {
    // The transaction arrives on stdin, and both the guard and the repository's hook read it.
    return [
      '#!/bin/sh',
      'input=$(cat)',
      'printf "%s\\n" "$input" | "$(dirname "$0")/pr-review-guard" "$@" || exit 1',
      original,
      '[ -x "$orig" ] || exit 0',
      'printf "%s\\n" "$input" | "$orig" "$@"',
      '',
    ].join('\n')
  }
  if (hook === 'pre-push') {
    // Pushing is the reader's to do, after reading the change: the turn's commits stay local.
    return ['#!/bin/sh', 'echo "pr-review: an AI Chat turn does not push" >&2', 'exit 1', ''].join('\n')
  }
  return ['#!/bin/sh', original, '[ -x "$orig" ] || exit 0', 'exec "$orig" "$@"', ''].join('\n')
}

/**
 * Every push URL a remote can have rewritten to one no transport serves, so a push fails before it
 * connects while fetches keep their URLs. A remote given as a plain path is not rewritten; the
 * pre-push hook refuses that one. Each needs its own way around: `-c` here, `--no-verify` there.
 */
const PUSH_URL_PREFIXES = ['https://', 'http://', 'git@', 'ssh://', 'git://', 'file://']
export const PUSH_GUARD_PAIRS: readonly [string, string][] = PUSH_URL_PREFIXES.map(prefix => [
  'url.pr-review-push-blocked:///.pushInsteadOf',
  prefix,
])

/** Writes the guard and a shim per client hook into `dir`. Writing again leaves the same files. */
export async function writeGuardHooks(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const files: [string, string][] = [
    ['pr-review-guard', GUARD_SCRIPT],
    ...CLIENT_HOOKS.map((hook): [string, string] => [hook, shim(hook)]),
  ]
  await Promise.all(
    files.map(async ([name, content]) => {
      const file = path.join(dir, name)
      await writeFile(file, content)
      await chmod(file, 0o755)
    })
  )
}

/**
 * `GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` for each pair, after any the
 * environment sets already, so a variable of the reader's is kept.
 */
export function gitConfigEnv(
  env: NodeJS.ProcessEnv,
  pairs: readonly [string, string][]
): Record<string, string> {
  const start = Number.parseInt(env['GIT_CONFIG_COUNT'] ?? '0', 10) || 0
  const vars: Record<string, string> = { GIT_CONFIG_COUNT: String(start + pairs.length) }
  pairs.forEach(([key, value], offset) => {
    vars[`GIT_CONFIG_KEY_${start + offset}`] = key
    vars[`GIT_CONFIG_VALUE_${start + offset}`] = value
  })
  return vars
}

export interface GitGuard {
  /** The guard's hooks folder, from `writeGuardHooks`. */
  hooksDir: string
  /** The branch the turn started on, as `refs/heads/<name>`. */
  branchRef: string
  /** The repository's own hooks folder: `git rev-parse --git-path hooks`, made absolute. */
  originalHooksDir: string
}

/**
 * The folder the repository's hooks are in, as git resolves it: its own `core.hooksPath` when it
 * sets one, else `hooks` in the git directory.
 */
export async function repositoryHooksDir(checkout: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: checkout })
  return path.resolve(checkout, stdout.trim())
}

/** The git configuration pair that turns the guard on, and the variables its hooks read. */
export function gitGuardConfig(guard: GitGuard): { pairs: [string, string][]; env: Record<string, string> } {
  return {
    pairs: [['core.hooksPath', guard.hooksDir], ...PUSH_GUARD_PAIRS],
    env: { PR_REVIEW_BRANCH: guard.branchRef, PR_REVIEW_ORIG_HOOKS: guard.originalHooksDir },
  }
}
