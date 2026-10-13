// The author's settled decisions, read from the commits under review. A decision the author already
// took, in the review loop or by hand, is a `Settled-decision` trailer of the commit that carries
// it: `<path>:<line>[:old] <the decision and its reason>`. `prepare` reads them so the generator
// writes each one as a point that publish resolves, instead of raising the question again.
import { diffArrays } from 'diff'
import type { SettledDecision } from '../contract/generation-context.js'
import { type FileEntry, SETTLEMENT_REASON_MAX, type Side } from '../contract/review-artifact.js'
import type { Git } from '../git/git.js'
import { hunkForLine } from '../git/patch-lines.js'
import { MAX_LINE_EDITS } from './point-carry.js'

export const SETTLED_DECISION_TRAILER = 'Settled-decision'

export interface ParsedDecision {
  path: string
  line: number
  side: Side
  text: string
}

const TRAILER_VALUE = /^(\S+):(\d+)(:old)?\s+(\S.*)$/

/** One trailer value, or null when it does not read as `<path>:<line>[:old] <text>`. */
export function parseSettledDecision(value: string): ParsedDecision | null {
  const m = TRAILER_VALUE.exec(value.trim())
  if (m === null) {
    return null
  }
  const [, path = '', lineText = '', old, text = ''] = m
  const line = Number(lineText)
  if (line < 1) {
    return null
  }
  return { path, line, side: old === undefined ? 'new' : 'old', text: text.trim() }
}

/**
 * Where `line` of one version of a file sits in a later version: the shortest edit script between
 * the two leaves it in place. Null when the line itself changed, or the versions differ by more
 * than `MAX_LINE_EDITS` lines.
 */
export function lineInLaterVersion(
  from: readonly string[],
  to: readonly string[],
  line: number
): number | null {
  const changes = diffArrays([...from], [...to], { maxEditLength: MAX_LINE_EDITS })
  if (changes === undefined) {
    return null
  }
  let a = 1
  let b = 1
  for (const change of changes) {
    if (!change.added && !change.removed && line >= a && line < a + change.count) {
      return b + (line - a)
    }
    a += change.added ? 0 : change.count
    b += change.removed ? 0 : change.count
  }
  return null
}

export interface DecisionSources {
  git: Pick<Git, 'commitTrailers' | 'show'>
  mergeBaseSha: string
  headSha: string
  files: readonly FileEntry[]
  /**
   * The email of whoever prepares the canvas, as they commit. Only their own commits' decisions
   * count, so a commit someone else pushed to the branch cannot answer the author's questions;
   * with no address, none count.
   */
  authorEmail: string | null
}

function textLines(content: Buffer): string[] {
  return content.toString('utf8').split('\n')
}

/**
 * The decision's line at the head, inside a chunk of this diff, or null. An old-side line is a
 * line of the merge base, which no commit of the change moves. A new-side line is a line of the
 * commit that wrote the trailer, carried to the head while later commits leave it as it was.
 */
async function lineAtHead(
  src: DecisionSources,
  commit: string,
  decision: ParsedDecision
): Promise<number | null> {
  const entry = src.files.find(f => f.path === decision.path)
  if (entry === undefined) {
    return null
  }
  let line: number | null = decision.line
  if (decision.side === 'new' && commit !== src.headSha) {
    const [atCommit, atHead] = await Promise.all([
      src.git.show(commit, decision.path),
      src.git.show(src.headSha, decision.path),
    ])
    line =
      atCommit === null || atHead === null
        ? null
        : lineInLaterVersion(textLines(atCommit), textLines(atHead), decision.line)
  }
  return line !== null && hunkForLine(entry.hunks, decision.side, line) !== null ? line : null
}

function capReason(text: string): string {
  return text.length <= SETTLEMENT_REASON_MAX ? text : `${text.slice(0, SETTLEMENT_REASON_MAX - 1)}…`
}

/**
 * The author's decisions on `mergeBase..head`, oldest first. A value that does not parse is not a
 * decision and is skipped. When two decisions land on the same line, the later commit's stands.
 */
export async function readSettledDecisions(src: DecisionSources): Promise<SettledDecision[]> {
  if (src.authorEmail === null) {
    return []
  }
  const email = src.authorEmail.toLowerCase()
  const commits = await src.git.commitTrailers(src.mergeBaseSha, src.headSha, SETTLED_DECISION_TRAILER)
  const decisions: SettledDecision[] = []
  for (const commit of commits.filter(c => c.authorEmail.toLowerCase() === email)) {
    for (const [i, value] of commit.values.entries()) {
      const parsed = parseSettledDecision(value)
      if (parsed !== null) {
        decisions.push({
          id: `${commit.sha.slice(0, 7)}-${i + 1}`,
          commit: commit.sha,
          date: commit.date,
          text: capReason(parsed.text),
          path: parsed.path,
          side: parsed.side,
          line: await lineAtHead(src, commit.sha, parsed),
        })
      }
    }
  }
  const anchor = (d: SettledDecision) => `${d.path}\n${d.side}\n${d.line}`
  return decisions.filter(
    (d, i) => d.line === null || !decisions.slice(i + 1).some(later => anchor(later) === anchor(d))
  )
}
