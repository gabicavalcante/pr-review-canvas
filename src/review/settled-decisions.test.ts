import { SETTLEMENT_REASON_MAX } from '../contract/review-artifact.js'
import { toFileEntry } from '../git/diff-collector.js'
import type { CommitTrailers } from '../git/git.js'
import { createFakeGit } from '../testing/fakes.js'
import { BASE_SHA, HEAD_SHA, SYNTHETIC_FILES } from '../testing/synthetic.js'
import { lineInLaterVersion, parseSettledDecision, readSettledDecisions } from './settled-decisions.js'

const FILES = SYNTHETIC_FILES.map(toFileEntry)
const EARLIER = 'c'.repeat(40)

describe('parseSettledDecision', () => {
  it('reads a path, a line, an optional old side, and the text', () => {
    expect(parseSettledDecision('src/app.ts:2 keep the import')).toEqual({
      path: 'src/app.ts',
      line: 2,
      side: 'new',
      text: 'keep the import',
    })
    expect(parseSettledDecision('  src/gone.ts:1:old   dropped on purpose  ')).toEqual({
      path: 'src/gone.ts',
      line: 1,
      side: 'old',
      text: 'dropped on purpose',
    })
  })

  it.each(['no anchor here', 'src/app.ts:x keep it', 'src/app.ts:0 keep it', 'src/app.ts:2', ''])(
    'reads %j as no decision',
    value => {
      expect(parseSettledDecision(value)).toBeNull()
    }
  )
})

describe('lineInLaterVersion', () => {
  const before = ['a', 'b', 'c', 'd']

  it('follows a line that only moved, and keeps one nothing touched', () => {
    expect(lineInLaterVersion(before, ['x', 'y', ...before], 3)).toBe(5)
    expect(lineInLaterVersion(before, before, 2)).toBe(2)
  })

  it('loses a line that was edited, deleted, or never there', () => {
    expect(lineInLaterVersion(before, ['a', 'b', 'C', 'd'], 3)).toBeNull()
    expect(lineInLaterVersion(before, ['a', 'b', 'd'], 3)).toBeNull()
    expect(lineInLaterVersion(before, before, 9)).toBeNull()
  })
})

describe('readSettledDecisions', () => {
  const commit = (sha: string, values: string[], authorEmail = 'Author@Example.com'): CommitTrailers => ({
    sha,
    authorEmail,
    date: '2026-10-13T10:00:00-03:00',
    values,
  })

  function read(
    commits: CommitTrailers[],
    opts: { email?: string | null; blobs?: Record<string, string> } = {}
  ) {
    const git = createFakeGit({
      trailers: { [`${BASE_SHA}..${HEAD_SHA}`]: commits },
      ...(opts.blobs === undefined ? {} : { blobs: opts.blobs }),
    })
    const decisions = readSettledDecisions({
      git,
      mergeBaseSha: BASE_SHA,
      headSha: HEAD_SHA,
      files: FILES,
      authorEmail: opts.email === undefined ? 'author@example.com' : opts.email,
    })
    return { git, decisions }
  }

  it('reads nothing, and asks git nothing, when nobody is known to be the author', async () => {
    const { git, decisions } = read([commit(HEAD_SHA, ['src/app.ts:2 keep it'])], { email: null })
    expect(await decisions).toEqual([])
    expect(git.calls).toEqual([])
  })

  it("keeps the author's decisions, whatever the case of the address, and drops everyone else's", async () => {
    const { decisions } = read([
      commit(HEAD_SHA, ['src/app.ts:2 keep the import']),
      commit(HEAD_SHA, ['src/app.ts:5 another view'], 'someone@example.com'),
    ])
    expect(await decisions).toEqual([
      {
        id: `${HEAD_SHA.slice(0, 7)}-1`,
        commit: HEAD_SHA,
        date: '2026-10-13T10:00:00-03:00',
        text: 'keep the import',
        path: 'src/app.ts',
        side: 'new',
        line: 2,
      },
    ])
  })

  it('anchors a line inside a chunk, and keeps a decision outside one or outside the diff as context', async () => {
    const { git, decisions } = read([
      commit(HEAD_SHA, [
        'src/app.ts:2 in a chunk',
        'src/app.ts:8 between chunks',
        'README.md:1 not in the diff',
      ]),
      commit(HEAD_SHA, ['src/gone.ts:1:old an old-side line']),
    ])
    expect((await decisions).map(d => [d.text, d.side, d.line])).toEqual([
      ['in a chunk', 'new', 2],
      ['between chunks', 'new', null],
      ['not in the diff', 'new', null],
      ['an old-side line', 'old', 1],
    ])
    // The head's own lines and the merge base's never move, so no file was read to place them.
    expect(git.calls.filter(c => c[0] === 'show')).toEqual([])
  })

  it("carries an earlier commit's line to the head, and loses it when the file cannot be read", async () => {
    const atEarlier = "import { a } from './a'\nexport function run() {\n"
    const atHead = "import { a } from './a'\nimport { b } from './b'\nexport function run() {\n"
    const { decisions } = read(
      [commit(EARLIER, ['src/app.ts:2 run stays exported', 'src/new.ts:1 unreadable then'])],
      { blobs: { [`${EARLIER}:src/app.ts`]: atEarlier, [`${HEAD_SHA}:src/app.ts`]: atHead } }
    )
    expect((await decisions).map(d => [d.id, d.line])).toEqual([
      [`${EARLIER.slice(0, 7)}-1`, 3],
      [`${EARLIER.slice(0, 7)}-2`, null],
    ])
  })

  it('skips a value that is not a decision, and lets a later decision on the same line stand', async () => {
    const { decisions } = read([
      commit(HEAD_SHA, ['not a decision', 'src/app.ts:2 first answer']),
      commit(HEAD_SHA, ['src/app.ts:2 second answer']),
    ])
    expect((await decisions).map(d => [d.id, d.text])).toEqual([
      [`${HEAD_SHA.slice(0, 7)}-1`, 'second answer'],
    ])
  })

  it('cuts a reason longer than a settlement may be', async () => {
    const { decisions } = read([commit(HEAD_SHA, [`src/app.ts:2 ${'x'.repeat(SETTLEMENT_REASON_MAX + 50)}`])])
    const [only] = await decisions
    expect(only?.text).toHaveLength(SETTLEMENT_REASON_MAX)
    expect(only?.text.endsWith('…')).toBe(true)
  })
})
