// @ts-check
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyState } from '../../src/contract/state.js'
import { UNKNOWN_CAPABILITIES } from '../../src/host/capabilities.js'
import { syntheticArtifact } from '../../src/testing/synthetic.js'
import { PrAppElement } from './app.js'
import { changesMoveCanvas, screenMoved, shouldAutoUpdate, watchReturns } from './local-return.js'

/** @typedef {import('./contract-types.js').PrBundle} PrBundle */
/** @typedef {import('./contract-types.js').GenerationJob} GenerationJob */

const HEAD = 'a'.repeat(40)
const NEXT_HEAD = 'b'.repeat(40)
const LATER_HEAD = 'c'.repeat(40)

/**
 * A branch review whose canvas is of HEAD, read when the head is `head`.
 * @param {{ head?: string, status?: PrBundle['status'], local?: PrBundle['local'], chat?: boolean }} [over]
 * @returns {PrBundle}
 */
function bundle(over = {}) {
  const artifact = syntheticArtifact()
  const head = over.head ?? HEAD
  const status = over.status ?? (head === HEAD ? 'ready' : 'stale')
  return {
    status,
    pr: { ...artifact.pr, headSha: head },
    files: artifact.files,
    derivable: true,
    skillCommand: '/pr-review-canvas branch',
    artifact,
    canvas: { headSha: HEAD, source: 'local', manifest: null },
    ...(status === 'stale'
      ? {
          stale: {
            canvasHeadSha: HEAD,
            currentHeadSha: head,
            relation: /** @type {const} */ ('ancestor'),
            commitsBehind: 1,
          },
        }
      : {}),
    comments: { fetchedAt: 'x', headSha: head, reviewComments: [], issueComments: [] },
    state: emptyState('x'),
    capabilities: UNKNOWN_CAPABILITIES,
    chat: { enabled: over.chat ?? true, acpx: true, agent: 'claude', model: null },
    largePr: false,
    selfReview: false,
    readerIsAuthor: false,
    mentionCanvas: true,
    canvasComment: false,
    warnings: [],
    local: over.local ?? 'branch',
  }
}

/**
 * @param {Partial<GenerationJob>} [over]
 * @returns {GenerationJob}
 */
function job(over = {}) {
  return {
    key: 'branch',
    force: false,
    agent: 'claude',
    model: 'opus',
    skill: { source: 'default', version: '1.4.0' },
    phase: 'generating',
    round: 1,
    maxRounds: 4,
    startedAt: '2026-10-05T12:00:00.000Z',
    activity: [],
    ...over,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('watchReturns', () => {
  it('reads once per return: a focus right after the tab shows again is the same return', async () => {
    let now = 0
    /** @type {Array<() => void>} */
    const ends = []
    const onReturn = vi.fn(() => new Promise(resolve => ends.push(() => resolve(undefined))))
    const watch = watchReturns(onReturn, { now: () => now, gapMs: 1000 })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    expect(onReturn).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(onReturn).toHaveBeenCalledTimes(1)
    // Still reading: another focus is the same return.
    window.dispatchEvent(new Event('focus'))
    ends.shift()?.()
    await vi.waitFor(() => expect(ends).toHaveLength(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    // Within the gap of the last read's end, it is still the same return.
    now = 500
    window.dispatchEvent(new Event('focus'))
    await Promise.resolve()
    expect(onReturn).toHaveBeenCalledTimes(1)
    // A later return reads again.
    now = 5000
    window.dispatchEvent(new Event('focus'))
    await Promise.resolve()
    expect(onReturn).toHaveBeenCalledTimes(2)
    ends.shift()?.()
    watch.stop()
  })

  it('ignores a page that went hidden, keeps going after a failed read, and stops listening', async () => {
    let now = 0
    let visibility = 'hidden'
    const doc = /** @type {Document} */ (
      /** @type {unknown} */ ({
        get visibilityState() {
          return visibility
        },
        addEventListener: document.addEventListener.bind(document),
        removeEventListener: document.removeEventListener.bind(document),
      })
    )
    const onReturn = vi.fn(() => {
      throw new Error('offline')
    })
    const watch = watchReturns(onReturn, { doc, now: () => now })
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(onReturn).not.toHaveBeenCalled()
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(onReturn).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    now = 10_000
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(onReturn).toHaveBeenCalledTimes(2))
    watch.stop()
    await new Promise(resolve => setTimeout(resolve, 0))
    now = 20_000
    window.dispatchEvent(new Event('focus'))
    await Promise.resolve()
    expect(onReturn).toHaveBeenCalledTimes(2)
  })
})

describe('screenMoved', () => {
  it('tells a moved head, status, or canvas from the same screen', () => {
    const shown = bundle()
    expect(screenMoved(shown, bundle())).toBe(false)
    expect(screenMoved(shown, bundle({ head: NEXT_HEAD }))).toBe(true)
    expect(screenMoved(shown, bundle({ status: 'missing' }))).toBe(true)
    const regenerated = bundle()
    if (regenerated.artifact) {
      regenerated.artifact = { ...regenerated.artifact, generatedAt: '2027-01-01T00:00:00.000Z' }
    }
    expect(screenMoved(shown, regenerated)).toBe(true)
    expect(screenMoved(shown, { ...bundle(), pr: { ...shown.pr, mergeBaseSha: 'd'.repeat(40) } })).toBe(true)
  })
})

describe('shouldAutoUpdate', () => {
  const page = { enabled: true, running: false, lastHead: null }

  it('updates an outdated branch canvas once per head', () => {
    expect(shouldAutoUpdate(bundle({ head: NEXT_HEAD }), page)).toBe(true)
    expect(shouldAutoUpdate(bundle({ head: NEXT_HEAD }), { ...page, lastHead: NEXT_HEAD })).toBe(false)
    expect(shouldAutoUpdate(bundle({ head: LATER_HEAD }), { ...page, lastHead: NEXT_HEAD })).toBe(true)
  })

  it.each(
    /** @type {Array<[string, PrBundle, typeof page]>} */ ([
      ['a current canvas', bundle(), page],
      ['no canvas yet', bundle({ head: NEXT_HEAD, status: 'missing' }), page],
      ['the setting off', bundle({ head: NEXT_HEAD }), { ...page, enabled: false }],
      ['a job running', bundle({ head: NEXT_HEAD }), { ...page, running: true }],
      ['no agent to run', bundle({ head: NEXT_HEAD, chat: false }), page],
      ['the uncommitted review', bundle({ head: NEXT_HEAD, local: 'uncommitted' }), page],
    ])
  )('does not update with %s', (_what, next, state) => {
    expect(shouldAutoUpdate(next, state)).toBe(false)
  })

  it('does not update a pull request review', () => {
    const { local: _local, ...pr } = bundle({ head: NEXT_HEAD })
    expect(shouldAutoUpdate(pr, page)).toBe(false)
  })
})

/**
 * A review page that has drawn `shown`, with its rendering and generation stood in for: the
 * return logic is what is under test, not the screens it draws.
 * @param {{ shown?: PrBundle, local?: 'branch' | 'uncommitted', enabled?: boolean, job?: GenerationJob | null, agent?: boolean }} [opts]
 */
function reviewPage(opts = {}) {
  const el = new PrAppElement()
  el.bootstrap = {
    prNumber: opts.local ?? 'branch',
    owner: 'acme',
    repo: 'widgets',
    project: 'acme/widgets',
    base: '/',
    version: '0.0.0-test',
    host: { kind: 'github', label: 'GitHub', webBase: 'https://github.com' },
    foldLevel: 'light',
    layerView: 'all',
    pointColors: 'classic',
    autoUpdateCanvas: true,
  }
  el.autoUpdate = opts.enabled ?? true
  el.shown = opts.shown ?? bundle()
  const render = vi.fn(async (/** @type {PrBundle} */ next) => {
    el.shown = next
  })
  el.render = render
  const autoUpdate = vi.fn(async () => true)
  const showLast = vi.fn()
  el.generation =
    opts.agent === false
      ? null
      : /** @type {PrAppElement['generation']} */ (
          /** @type {unknown} */ ({ job: opts.job ?? null, autoUpdate, showLast })
        )
  return { el, render, autoUpdate, showLast }
}

/** @param {() => PrBundle} read the bundle each request answers */
function serveBundle(read) {
  const fetchImpl = vi.fn(
    async (/** @type {RequestInfo | URL} */ _url) => new Response(JSON.stringify(read()), { status: 200 })
  )
  vi.stubGlobal('fetch', fetchImpl)
  return fetchImpl
}

describe('a local review page coming back into view', () => {
  it('reads the work afresh, keeps the canvas on screen, and updates once per head', async () => {
    let next = bundle({ head: NEXT_HEAD })
    const fetchImpl = serveBundle(() => next)
    const { el, render, autoUpdate } = reviewPage()
    await el.reread()
    // Not the poll: the server reads the work again.
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('/api/prs/branch')
    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0]?.[0].status).toBe('stale')
    expect(el.viewStale).toBe(true)
    expect(autoUpdate).toHaveBeenCalledTimes(1)
    expect(autoUpdate.mock.calls).toEqual([[next]])

    // The same head again: nothing to redraw, and no second update for it.
    await el.reread()
    expect(render).toHaveBeenCalledTimes(1)
    expect(autoUpdate).toHaveBeenCalledTimes(1)

    // A commit after that one gets its own update.
    next = bundle({ head: LATER_HEAD })
    await el.reread()
    expect(render).toHaveBeenCalledTimes(2)
    expect(autoUpdate).toHaveBeenCalledTimes(2)
  })

  it('starts no update while one runs, and starts it on the return after the run ends', async () => {
    serveBundle(() => bundle({ head: NEXT_HEAD }))
    const { el, autoUpdate } = reviewPage({ job: job() })
    await el.reread()
    expect(autoUpdate).not.toHaveBeenCalled()
    el.generation = /** @type {PrAppElement['generation']} */ (
      /** @type {unknown} */ ({ job: job({ phase: 'done' }), autoUpdate })
    )
    await el.reread()
    expect(autoUpdate).toHaveBeenCalledTimes(1)
  })

  it.each(
    /** @type {Array<[string, Parameters<typeof reviewPage>[0]]>} */ ([
      ['with the setting off', { enabled: false }],
      ['on the uncommitted review', { local: 'uncommitted', shown: bundle({ local: 'uncommitted' }) }],
      ['without an agent the page can run', { agent: false }],
    ])
  )('redraws but does not update %s', async (_what, opts) => {
    serveBundle(() => bundle({ head: NEXT_HEAD, local: opts?.local ?? 'branch' }))
    const { el, render, autoUpdate } = reviewPage(opts)
    await el.reread()
    expect(render).toHaveBeenCalledTimes(1)
    expect(autoUpdate).not.toHaveBeenCalled()
  })

  it('leaves the screen alone when nothing moved or the work could not be read', async () => {
    serveBundle(() => bundle())
    const { el, render, autoUpdate } = reviewPage()
    await el.reread()
    expect(render).not.toHaveBeenCalled()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      })
    )
    await el.reread()
    expect(render).not.toHaveBeenCalled()
    expect(autoUpdate).not.toHaveBeenCalled()
  })

  it('follows the setting the dialog saves', () => {
    const { el } = reviewPage()
    el.settingsSaved(
      /** @type {import('./contract-types.js').SettingsResponse} */ (
        /** @type {unknown} */ ({
          settings: { layerView: 'all', pointColors: 'classic', autoUpdateCanvas: false },
        })
      )
    )
    expect(el.autoUpdate).toBe(false)
  })
})

describe('the end of an update the page started', () => {
  it('says which commit the canvas is now of, and leaves a failed one to the notice', async () => {
    const { el, showLast } = reviewPage()
    el.reload = vi.fn(async () => undefined)
    await el.generationEnded(job({ phase: 'done', headSha: NEXT_HEAD, sharing: { status: 'local' } }), {
      auto: true,
    })
    expect(el.querySelector('.toast')?.textContent).toBe(`canvas updated to ${NEXT_HEAD.slice(0, 7)}`)
    expect(showLast).not.toHaveBeenCalled()

    el.querySelector('.toast')?.remove()
    await el.generationEnded(job({ phase: 'failed' }), { auto: true })
    expect(el.querySelector('.toast')).toBeNull()
    await el.generationEnded(job({ phase: 'failed' }))
    expect(el.querySelector('.toast')?.textContent).toContain('canvas generation failed')

    await el.generationEnded(job({ phase: 'done', sharing: { status: 'local' } }))
    expect(el.querySelector('.toast')?.textContent).toBe('canvas published')
  })
})

describe('changesMoveCanvas', () => {
  const finding = { message: 'tracked files changed outside a commit: a.ts', fix: 'git restore …' }

  it('moves the canvas on after a turn that committed and left nothing else', () => {
    expect(changesMoveCanvas({ commits: ['c1'], findings: [] })).toBe(true)
  })

  it('waits for the reader when the turn left something besides its commits', () => {
    expect(changesMoveCanvas({ commits: ['c1'], findings: [finding] })).toBe(false)
  })

  it('has nothing to move on to when the turn committed nothing', () => {
    expect(changesMoveCanvas({ commits: [], findings: [] })).toBe(false)
  })
})
