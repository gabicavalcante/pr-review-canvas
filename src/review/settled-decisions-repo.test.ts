// @vitest-environment node
// Settled decisions against a real repository, through `prepare` and `publish` as a run meets
// them. The trailers are written by `git commit` and read back by the real adapter, so the parsing,
// the author filter, and the line carry all see what git actually produces.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { GenerationContextSchema } from '../contract/generation-context.js'
import { createGit, GitError } from '../git/git.js'
import { execGitAsRepoConfig, makeTempDir, makeTestContext, type TestContext } from '../testing/fakes.js'
import { fingerprint } from './normalize.js'
import { prepare } from './prepare.js'
import { ModelInvalidError, publish } from './publish.js'
import { withSettlement } from './self-review.js'

// Commits here are by the people the repository's config names, not by whoever commits outside it.
async function g(cwd: string, ...args: string[]): Promise<string> {
  const r = await execGitAsRepoConfig(cwd, args)
  if (r.code !== 0) {
    throw new GitError(args, r.stderr, r.code)
  }
  return r.stdout.toString('utf8').trim()
}

async function write(dir: string, file: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(dir, file)), { recursive: true })
  await writeFile(path.join(dir, file), content, 'utf8')
}

const BASE_APP = 'a\nb\nc\nd\ne\nf\ng\nh\n'
const DECIDED = 'a\nb\nc\nd\nE!\nf\ng\nh\n'
const REASON = 'keep E! uppercase; the callers compare it raw'
const DECISION_POINT_TITLE = 'E! stays uppercase'

describe('settled decisions against a real repository', () => {
  let dir: string
  // The author's commit with the decision, another person's commit with a trailer of their own,
  // the author's commit that adds lines above the decided one, and one that edits it.
  const heads = { decided: '', other: '', shifted: '', edited: '' }
  let t: TestContext

  beforeAll(async () => {
    dir = await makeTempDir('pr-review-decisions-')
    await g(dir, 'init', '-q', '-b', 'main')
    await g(dir, 'config', 'user.email', 'test@example.com')
    await g(dir, 'config', 'user.name', 'Test')
    await write(dir, 'src/app.ts', BASE_APP)
    await g(dir, 'add', '.')
    await g(dir, 'commit', '-q', '-m', 'base')
    await g(dir, 'checkout', '-q', '-b', 'feature')
    await write(dir, 'src/app.ts', DECIDED)
    await g(
      dir,
      'commit',
      '-q',
      '-am',
      'fix(app): keep E uppercase',
      '-m',
      'Why it stays.',
      '-m',
      `Settled-decision: src/app.ts:5 ${REASON}`
    )
    heads.decided = await g(dir, 'rev-parse', 'HEAD')
    await write(dir, 'src/app.ts', DECIDED.replace('b\n', 'B\n'))
    await g(
      dir,
      '-c',
      'user.email=other@example.com',
      '-c',
      'user.name=Other',
      'commit',
      '-q',
      '-am',
      'chore: rename b',
      '-m',
      'Settled-decision: src/app.ts:2 B is fine as it is'
    )
    heads.other = await g(dir, 'rev-parse', 'HEAD')
    await write(dir, 'src/app.ts', `// header\n// more\n${DECIDED.replace('b\n', 'B\n')}`)
    await g(dir, 'commit', '-q', '-am', 'docs: add a header')
    heads.shifted = await g(dir, 'rev-parse', 'HEAD')
    await write(dir, 'src/app.ts', `// header\n// more\n${DECIDED.replace('b\n', 'B\n').replace('E!', 'E?')}`)
    await g(dir, 'commit', '-q', '-am', 'fix(app): soften E')
    heads.edited = await g(dir, 'rev-parse', 'HEAD')
  })
  afterAll(async () => rm(dir, { recursive: true, force: true }))
  beforeEach(async () => {
    t = await makeTestContext({ git: createGit(dir, execGitAsRepoConfig) })
  })
  afterEach(() => t.cleanup())

  async function prepared(head: string) {
    const result = await prepare(
      t.ctx,
      { kind: 'refs', base: 'main', head },
      { force: false, log: () => undefined }
    )
    const context = GenerationContextSchema.parse(JSON.parse(await readFile(result.contextPath, 'utf8')))
    return { result, context, prompt: await readFile(result.promptPath, 'utf8') }
  }

  /** A model of the whole diff in one layer, with the given points. */
  async function writeModel(canvasDir: string, head: string, points: unknown[]): Promise<void> {
    const derived = await t.ctx.derived.ensure(head, await g(dir, 'merge-base', 'main', head))
    const model = {
      summary: 'Changes the app.',
      layers: [
        {
          key: 'app',
          title: 'App',
          rationale: 'The whole change.',
          kind: 'layer',
          tests: [],
          files: derived.files.map(f => ({ path: f.path, hunks: f.hunks.map(h => h.id), annotations: [] })),
        },
      ],
      points,
    }
    await writeFile(path.join(canvasDir, 'model.json'), JSON.stringify(model))
  }

  const decisionPoint = (id: string, line: number) => ({
    kind: 'decision',
    level: 'fyi',
    audience: 'author',
    title: DECISION_POINT_TITLE,
    path: 'src/app.ts',
    line,
    body: 'The author kept E! uppercase.',
    settledDecision: id,
  })

  const OPTS = { agent: 'claude', harness: 'claude-code', allowStale: false } as const

  it("reads the author's decision at the line it names, and lists it in the prompt", async () => {
    const { context, prompt } = await prepared(heads.decided)
    const id = `${heads.decided.slice(0, 7)}-1`
    expect(context.decisions).toEqual([
      {
        id,
        commit: heads.decided,
        date: expect.any(String),
        text: REASON,
        path: 'src/app.ts',
        side: 'new',
        line: 5,
      },
    ])
    expect(prompt).toContain(`\`${id}\` on \`src/app.ts\` new-side line 5`)
  })

  it("ignores a trailer from someone else's commit on the branch", async () => {
    const { context } = await prepared(heads.other)
    expect(context.decisions.map(d => d.text)).toEqual([REASON])
  })

  it('carries a decision past lines added above it, to its line at the head', async () => {
    const { context } = await prepared(heads.shifted)
    expect(context.decisions.map(d => [d.text, d.line])).toEqual([[REASON, 7]])
  })

  it('keeps a decision whose line changed after the commit as context, with no point to write', async () => {
    const { result, context, prompt } = await prepared(heads.edited)
    const id = `${heads.decided.slice(0, 7)}-1`
    expect(context.decisions.map(d => [d.id, d.line])).toEqual([[id, null]])
    expect(prompt).toMatch(new RegExp(`\\*\\*Not in this diff\\*\\*[^]*\`${id}\` on \`src/app.ts\` \\(`))
    // No point records it, and publish takes the canvas as it is.
    await writeModel(result.canvasDir, heads.edited, [])
    await expect(publish(t.ctx, result.canvasDir, OPTS)).resolves.toMatchObject({ status: 'published' })
  })

  it('resolves the point that records a decision, and again on the next canvas after lines moved', async () => {
    const id = `${heads.decided.slice(0, 7)}-1`
    const fp = fingerprint({ kind: 'decision', path: 'src/app.ts', title: DECISION_POINT_TITLE })
    const expected = { reason: REASON, at: expect.any(String), commit: heads.decided }

    const first = await prepared(heads.decided)
    await writeModel(first.result.canvasDir, heads.decided, [decisionPoint(id, 5)])
    await publish(t.ctx, first.result.canvasDir, OPTS)
    expect((await t.ctx.canvases.readArtifact(heads.decided))?.settled).toEqual({ [fp]: expected })

    // The next canvas builds on the first one, and the decision now sits two lines lower.
    const second = await prepared(heads.shifted)
    expect(second.context.basis?.canvasSha).toBe(heads.decided)
    await writeModel(second.result.canvasDir, heads.shifted, [decisionPoint(id, 7)])
    await publish(t.ctx, second.result.canvasDir, OPTS)
    expect((await t.ctx.canvases.readArtifact(heads.shifted))?.settled).toEqual({ [fp]: expected })
  })

  it("keeps the reason the author wrote on the canvas over the trailer's when the canvas is generated again", async () => {
    const id = `${heads.decided.slice(0, 7)}-1`
    const fp = fingerprint({ kind: 'decision', path: 'src/app.ts', title: DECISION_POINT_TITLE })
    const first = await prepared(heads.decided)
    await writeModel(first.result.canvasDir, heads.decided, [decisionPoint(id, 5)])
    await publish(t.ctx, first.result.canvasDir, OPTS)
    // The author rewords the resolution on the page, which revises the stored canvas.
    const stored = await t.ctx.canvases.readArtifact(heads.decided)
    if (stored === null) {
      throw new Error('canvas missing')
    }
    const reworded = { reason: 'Reworded on the canvas.', at: '2026-10-13T12:00:00.000Z' }
    await t.ctx.canvases.revise(heads.decided, withSettlement(stored, fp, reworded, reworded.at))

    const again = await prepare(
      t.ctx,
      { kind: 'refs', base: 'main', head: heads.decided },
      { force: true, log: () => undefined }
    )
    await writeModel(again.canvasDir, heads.decided, [decisionPoint(id, 5)])
    await publish(t.ctx, again.canvasDir, OPTS)
    expect((await t.ctx.canvases.readArtifact(heads.decided))?.settled).toEqual({ [fp]: reworded })
  })

  it('refuses a canvas that leaves a decision in the diff without its point', async () => {
    const { result } = await prepared(heads.decided)
    await writeModel(result.canvasDir, heads.decided, [])
    const failure = await publish(t.ctx, result.canvasDir, OPTS).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(ModelInvalidError)
    expect((failure as ModelInvalidError).report.errors.map(e => e.code)).toEqual(['DECISION_MISSING'])
  })
})
