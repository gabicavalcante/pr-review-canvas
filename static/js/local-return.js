// @ts-check
// A local review follows the work while the reader is away: the page reads the bundle again each
// time the reader comes back to it, since a commit or an edit made meanwhile moves the head the
// canvas describes. A branch review whose canvas that leaves outdated is updated by the page itself.
/** @typedef {import('./contract-types.js').PrBundle} PrBundle */

/**
 * Coming back to a tab fires both `visibilitychange` and `focus`, and focus can flicker between
 * windows; a return within this long of the last read is the same return.
 */
export const RETURN_GAP_MS = 2000

/**
 * Calls `onReturn` when the page is shown again or its window regains focus, once per return: not
 * while the last call is still running, nor within `gapMs` of its end.
 * @param {() => unknown} onReturn
 * @param {{ win?: Window, doc?: Document, now?: () => number, gapMs?: number }} [opts]
 * @returns {{ stop: () => void }}
 */
export function watchReturns(onReturn, opts = {}) {
  const win = opts.win ?? window
  const doc = opts.doc ?? document
  const now = opts.now ?? (() => Date.now())
  const gapMs = opts.gapMs ?? RETURN_GAP_MS
  let running = false
  let endedAt = -Infinity
  const returned = () => {
    if (doc.visibilityState === 'hidden' || running || now() - endedAt < gapMs) {
      return
    }
    running = true
    void Promise.resolve()
      .then(onReturn)
      .catch(() => undefined)
      .finally(() => {
        running = false
        endedAt = now()
      })
  }
  doc.addEventListener('visibilitychange', returned)
  win.addEventListener('focus', returned)
  return {
    stop: () => {
      doc.removeEventListener('visibilitychange', returned)
      win.removeEventListener('focus', returned)
    },
  }
}

/**
 * Whether a bundle read again shows something other than the screen does: another status, head,
 * merge base, or canvas.
 * @param {PrBundle} shown
 * @param {PrBundle} next
 */
export function screenMoved(shown, next) {
  return (
    next.status !== shown.status ||
    next.pr.headSha !== shown.pr.headSha ||
    next.pr.mergeBaseSha !== shown.pr.mergeBaseSha ||
    next.canvas?.headSha !== shown.canvas?.headSha ||
    next.artifact?.generatedAt !== shown.artifact?.generatedAt
  )
}

/**
 * Whether the page starts an incremental update by itself: on a branch review whose canvas is of
 * an earlier commit, when the setting allows it, the page can run the agent, no job runs for the
 * review, and the page has not started one for this head already. A run that ends, or fails to
 * start, is not started again for its head; the next commit gets its own.
 * @param {PrBundle} bundle the bundle read on the reader's return
 * @param {{ enabled: boolean, running: boolean, lastHead: string | null }} page `enabled` the
 *   reader's `autoUpdateCanvas`; `running` whether a job runs for this review; `lastHead` the head
 *   the page last started an update for by itself
 */
export function shouldAutoUpdate(bundle, page) {
  return (
    bundle.local === 'branch' &&
    bundle.status === 'stale' &&
    bundle.chat.enabled &&
    page.enabled &&
    !page.running &&
    page.lastHead !== bundle.pr.headSha
  )
}
