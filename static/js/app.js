// @ts-check
// Boot: read the bootstrap JSON, fetch the bundle and the patches together, render the screen for
// the bundle's status, and keep the page current: the empty screen polls until a canvas is
// published, the regenerate dialog polls until a newer canvas replaces the one on screen, and a
// local review reads the work again when the reader comes back to the page.
/** @typedef {import('./contract-types.js').PrBundle} PrBundle */
import {
  ApiError,
  fetchBundle,
  fetchPatches,
  fetchSharedCanvas,
  importCanvas,
  pollBundle,
  pollSettled,
  setApiBase,
} from './api.js'
import { setChatEnabled } from './ask.js'
import { readPointsDensity, setMentionCanvas, setPointsDensity } from './points.js'
import { applyPointColors } from './point-colors.js'
import { wireBarDismissal } from './bar-dismissal.js'
import { readChatMinimized, readChatWidth, renderChatShell, wireChat } from './chat.js'
import { reviewPaneHtml, wireReviewPane } from './side-pane.js'
import { runCommand, toast, wireCopyCommands } from './commands.js'
import { initDeepLinks } from './deep-link.js'
import { initDiagrams } from './diagram.js'
import { esc, qs } from './dom.js'
import { exportCanvasZip } from './download.js'
import {
  carriedOverBarHtml,
  marksCarriedBarHtml,
  renderEmptyState,
  renderStaleState,
  staleBarHtml,
} from './empty-state.js'
import { errorCardHtml } from './errors.js'
import { bareHeaderHtml, renderHeader } from './header.js'
import { wireEnvBadge } from './header-bar.js'
import { wireDropZone } from './import-zone.js'
import { wireReview } from './interactions.js'
import {
  defineLayerElements,
  pathSet,
  renderLayers,
  renderRail,
  setFoldLevel,
  setRenderContext,
} from './layers.js'
import { renderOverview } from './overview.js'
import { initOneLayer } from './one-layer.js'
import { wireQuickQuestions } from './quick-questions.js'
import { createGeneration } from './generate.js'
import { isRunning } from './generation-phases.js'
import { renderPointSteps } from './point-view.js'
import { changesMoveCanvas, screenMoved, shouldAutoUpdate, watchReturns } from './local-return.js'
import { canvasChanged, openRegenerateDialog } from './regenerate.js'
import { createReviewSession } from './review-session.js'
import { initScrollSpy } from './scroll-spy.js'
import { setSelfReview } from './self-review.js'
import { openSettingsDialog } from './settings.js'
import { wireAppearanceCommands } from './appearance-commands.js'
import { readSkin } from './skin.js'
import { readTheme } from './theme.js'
import { hostLabel, setHost, setOnPullRequest } from './host.js'

/** @typedef {import('./contract-types.js').ReviewKey} ReviewKey */
/** @typedef {import('./contract-types.js').ReviewBootstrap} Bootstrap */

/** @returns {Bootstrap | null} */
function readBootstrap() {
  const el = document.getElementById('bootstrap')
  if (!el?.textContent) {
    return null
  }
  try {
    return /** @type {Bootstrap} */ (JSON.parse(el.textContent))
  } catch {
    return null
  }
}

/**
 * The project as the header names it.
 * @param {Bootstrap} bootstrap
 * @returns {import('./header-bar.js').ProjectLink}
 */
function projectLinkOf(bootstrap) {
  return { slug: bootstrap.project, home: bootstrap.base, reopenIn: bootstrap.reopenIn }
}

/**
 * @param {string} version
 * @param {PrBundle} [bundle]
 */
function footerHtml(version, bundle) {
  const canvas = bundle?.canvas
    ? `<span>canvas <span class="mono">${esc(bundle.canvas.headSha.slice(0, 7))}</span> · ${esc(bundle.canvas.source)}</span>`
    : ''
  return `<footer><span>pr-review ${esc(version)}</span>${canvas}<span>local review app · ${esc(hostLabel())} operations and AI requests contact their services</span></footer>`
}

/** @param {ReadonlyArray<string>} warnings */
function bannerHtml(warnings) {
  return warnings.length === 0
    ? ''
    : `<div class="banner" role="status">${warnings.map(w => esc(w)).join(' · ')}</div>`
}

/**
 * @param {unknown} err
 * @returns {import('./contract-types.js').ErrorEnvelope['error']}
 */
function toEnvelopeError(err) {
  if (!(err instanceof ApiError)) {
    return { code: 'INTERNAL', message: String(err) }
  }
  return err.hint === undefined
    ? { code: err.code, message: err.message }
    : { code: err.code, message: err.message, hint: err.hint }
}

/**
 * The patches for the bundle. The first visit builds derived/ while the bundle resolves, so the
 * parallel fetch can land before the patches exist; one more try after the bundle is enough.
 * @param {ReviewKey} prNumber
 * @param {Promise<Record<string, string> | null>} started
 * @param {string} [headSha] the canvas commit, when it is not the PR head
 */
async function settlePatches(prNumber, started, headSha) {
  const first = await started
  if (first !== null) {
    return first
  }
  const retry = headSha === undefined ? {} : { headSha }
  return fetchPatches(prNumber, retry).then(
    r => r.patches,
    () => null
  )
}

export class PrAppElement extends HTMLElement {
  /** @type {{ stop: () => void } | null} */
  poller = null
  /**
   * Reads the author's resolutions back on a reviewer's page.
   * @type {{ stop: () => void } | null}
   */
  settledPoller = null
  /** @type {Bootstrap | null} */
  bootstrap = null
  /** @type {{ stop: () => void } | null} */
  diagrams = null
  /** @type {{ stop: () => void } | null} */
  deepLinks = null
  /** @type {{ stop: () => void } | null} */
  scrollSpy = null
  /**
   * Whether the canvas shows every layer or one at a time. Made once per boot, from the setting
   * the page came with, and kept across renders: it redraws with each one, and a save in the
   * settings dialog changes its view without a reload.
   * @type {ReturnType<typeof initOneLayer> | null}
   */
  layerView = null
  /**
   * The view the page is drawn for. Only the one-point view draws a stop per attention point, so
   * moving into it or out of it draws the page again.
   * @type {import('./layer-views.js').LayerView}
   */
  view = 'all'
  /** @type {{ stop: () => void } | null} */
  interactions = null
  /** @type {ReturnType<typeof wireChat>} */
  chat = null
  /** @type {{ stop: () => void } | null} */
  quickQuestions = null
  /** The pane that holds the review alone, on a page without AI Chat. */
  /** @type {ReturnType<typeof wireReviewPane>} */
  reviewPane = null
  /** The reader asked to read the canvas of the older commit. */
  viewStale = false
  /**
   * The canvas generation this page can start and watch, made on the first screen that has an
   * agent to run it. Kept across renders, like the job it follows.
   * @type {ReturnType<typeof createGeneration> | null}
   */
  generation = null
  /**
   * The bundle the screen shows, which a local review's return compares the work read again with.
   * @type {PrBundle | null}
   */
  shown = null
  /** Whether a branch review updates its outdated canvas by itself, from the settings file. */
  autoUpdate = true
  /**
   * The head this page last started an update for by itself, so a return never starts a second.
   * @type {string | null}
   */
  autoUpdatedHead = null
  /** @type {{ stop: () => void } | null} */
  returns = null

  connectedCallback() {
    // Once per element: the content is re-rendered on every flip, the element itself is not.
    wireCopyCommands(this)
    wireEnvBadge(this)
    void this.boot()
  }

  disconnectedCallback() {
    this.returns?.stop()
    this.returns = null
    this.stopPolling()
    this.settledPoller?.stop()
    this.settledPoller = null
    this.generation?.stop()
    this.generation = null
    this.diagrams?.stop()
    this.diagrams = null
    this.deepLinks?.stop()
    this.deepLinks = null
    this.scrollSpy?.stop()
    this.scrollSpy = null
    this.layerView?.stop()
    this.layerView = null
    this.interactions?.stop()
    this.interactions = null
    this.stopChat()
  }

  stopChat() {
    this.chat?.stop()
    this.chat = null
    this.quickQuestions?.stop()
    this.quickQuestions = null
    this.reviewPane?.stop()
    this.reviewPane = null
  }

  async boot() {
    this.bootstrap = readBootstrap()
    if (!this.bootstrap) {
      this.innerHTML = errorCardHtml({ code: 'INTERNAL', message: 'missing bootstrap data' })
      return
    }
    setHost(this.bootstrap.host)
    setApiBase(this.bootstrap.base)
    // The reading level the canvas opens at comes from the settings file with the page, so the
    // first draw hides what the reader asked for.
    setFoldLevel(this, this.bootstrap.foldLevel)
    applyPointColors(this.bootstrap.pointColors, document.documentElement)
    this.layerView?.stop()
    this.view = this.bootstrap.layerView
    this.layerView = initOneLayer(this, { view: this.bootstrap.layerView })
    this.autoUpdate = this.bootstrap.autoUpdateCanvas
    // The page only polls the head it was opened with, so a local review reads the work again when
    // the reader comes back: that is when a commit or an edit made meanwhile shows.
    if (typeof this.bootstrap.prNumber === 'string') {
      this.returns ??= watchReturns(() => this.reread())
    }
    const patchesPromise = fetchPatches(this.bootstrap.prNumber).then(
      r => r.patches,
      () => null
    )
    /** @type {PrBundle} */
    let bundle
    try {
      bundle = await fetchBundle(this.bootstrap.prNumber)
    } catch (err) {
      this.innerHTML =
        bareHeaderHtml({
          host: location.host,
          project: projectLinkOf(this.bootstrap),
          theme: readTheme(document.documentElement),
          skin: readSkin(document.documentElement),
        }) +
        errorCardHtml(toEnvelopeError(err)) +
        footerHtml(this.bootstrap.version)
      qs('#retry', this)?.addEventListener('click', () => void this.boot())
      this.wireAppearance()
      return
    }
    await this.render(bundle, patchesPromise)
    // The home page's generate button lands here with `?generate=1`: the dialog opens on the
    // screen it asked for, and the flag leaves the URL so a reload does not open it again.
    const url = new URL(location.href)
    if (url.searchParams.has('generate')) {
      url.searchParams.delete('generate')
      history.replaceState(history.state, '', url)
      this.generation?.open(bundle)
    }
  }

  /**
   * @param {PrBundle} bundle
   * @param {Promise<Record<string, string> | null>} [patchesPromise]
   */
  async render(bundle, patchesPromise) {
    const boot = this.bootstrap
    if (!boot) {
      return
    }
    this.stopPolling()
    this.settledPoller?.stop()
    this.settledPoller = null
    const showsCanvas = bundle.artifact !== undefined && (bundle.status === 'ready' || this.viewStale)
    const staleSha = bundle.status === 'stale' ? bundle.stale?.canvasHeadSha : undefined
    const patches = showsCanvas
      ? await settlePatches(
          boot.prNumber,
          patchesPromise ??
            fetchPatches(boot.prNumber, staleSha === undefined ? {} : { headSha: staleSha }).then(
              r => r.patches,
              () => null
            ),
          staleSha
        )
      : {}
    // Check after the requests finish, before tearing down the current screen: the reader may
    // have kept typing while the refresh was loading.
    const hasUnfinishedText =
      this.chat?.holdsUnsent() === true ||
      [...this.querySelectorAll('.composer-box textarea, #msg, #signoff-dialog[open] textarea')].some(
        el => el instanceof HTMLTextAreaElement && el.value !== el.defaultValue
      )
    if (hasUnfinishedText && !window.confirm('Discard unfinished text and update the review?')) {
      return
    }
    this.shown = bundle
    this.diagrams?.stop()
    this.diagrams = null
    this.deepLinks?.stop()
    this.deepLinks = null
    this.scrollSpy?.stop()
    this.scrollSpy = null
    this.interactions?.stop()
    this.interactions = null
    this.stopChat()
    const now = new Date()
    const header = renderHeader(bundle, {
      host: location.host,
      theme: readTheme(document.documentElement),
      skin: readSkin(document.documentElement),
      now,
      project: this.bootstrap ? projectLinkOf(this.bootstrap) : undefined,
    })
    const chatEnabled = bundle.chat.enabled
    const storage = typeof localStorage === 'undefined' ? null : localStorage
    const chatMinimized = chatEnabled && readChatMinimized(storage)
    setPointsDensity(document.documentElement, readPointsDensity(storage))
    // The renderers read these while they build the cards, so they are set before the first one.
    setChatEnabled(chatEnabled)
    setOnPullRequest(bundle.local === undefined)
    setMentionCanvas(bundle.mentionCanvas)
    if (bundle.artifact && showsCanvas) {
      const { artifact } = bundle
      // The server says whether this reader resolves points here: the author, on the current head's canvas.
      setSelfReview(bundle.selfReview, artifact.settled, bundle.canvasComment)
      // A stale canvas describes its own commit, so its files and diffs come from that sha.
      const files = staleSha === undefined ? bundle.files : artifact.files
      const paths = pathSet(files)
      // The context is set before any <pr-file> connects, so each card renders once, when visible.
      // A stale canvas's drafts belong to its own diff, which its artifact names.
      const on = staleSha === undefined ? bundle.pr : artifact.pr
      setRenderContext({
        artifact,
        files,
        patches,
        headSha: on.headSha,
        mergeBaseSha: on.mergeBaseSha,
        comments: bundle.comments.reviewComments,
        state: bundle.state,
        now,
      })
      defineLayerElements()
      const staleBar =
        bundle.status === 'stale' && bundle.stale
          ? staleBarHtml(bundle.stale, bundle.local)
          : bundle.carriedOver
            ? carriedOverBarHtml(bundle.carriedOver)
            : ''
      const marksBar =
        bundle.marksCarriedFrom === undefined
          ? ''
          : marksCarriedBarHtml(bundle.marksCarriedFrom, bundle.canvas?.headSha ?? '')
      this.innerHTML =
        header +
        bannerHtml(bundle.warnings) +
        `<div class="layout${chatEnabled && !chatMinimized ? '' : ' no-chat'}">${renderRail(artifact, bundle.state, { points: this.view === 'points' })}<main id="main">${staleBar}${marksBar}${renderOverview(bundle, { paths, now })}${this.view === 'points' ? renderPointSteps(artifact, files, bundle.state, bundle.comments.reviewComments) : ''}${renderLayers(artifact, files, bundle.state, bundle.comments.reviewComments, on)}</main>${chatEnabled ? renderChatShell({ enabled: true, width: readChatWidth(storage), minimized: chatMinimized }) : reviewPaneHtml()}</div>` +
        footerHtml(boot.version, bundle)
      // A bar the reader dismissed goes before the review wiring measures the outdated bar.
      wireBarDismissal(this, storage)
      // The screen is interactive from here: reviewed state, dismissals, threads, and posting.
      // A stale canvas shows the diff of an older commit, so nothing is posted from it: a line
      // number of that commit means something else on the head a comment would land on.
      const capabilities =
        bundle.status === 'stale'
          ? {
              canComment: /** @type {const} */ (false),
              tokenKind: bundle.capabilities.tokenKind,
              login: bundle.capabilities.login,
              reason: `this canvas is for ${bundle.stale?.relation === 'other-base' ? 'an older diff of this commit' : 'an older commit'}; generate one for the current head to post`,
            }
          : bundle.capabilities
      const canvasManifest = bundle.canvas?.manifest ?? null
      const session = createReviewSession({
        prNumber: boot.prNumber,
        artifact,
        files,
        state: bundle.state,
        capabilities,
        headSha: bundle.pr.headSha,
        mergeBaseSha: bundle.pr.mergeBaseSha,
        // The marks are keyed to the canvas on the page, so every mark names it, with the merge base
        // its diff runs from.
        ...(bundle.canvas === undefined ? {} : { canvasSha: bundle.canvas.headSha }),
        ...(canvasManifest === null ? {} : { canvasMergeBaseSha: canvasManifest.mergeBaseSha }),
      })
      const interactions = wireReview(this, session, {
        chat: () => this.chat,
        openReview: () => (this.chat ?? this.reviewPane)?.openReview(),
        uncover: () => (this.chat ?? this.reviewPane)?.uncover(),
        openSettings: el =>
          void openSettingsDialog(this, el, { onSaved: data => void this.settingsSaved(data) }),
      })
      this.interactions = interactions
      if (chatEnabled) {
        this.chat = wireChat({
          root: this,
          prNumber: boot.prNumber,
          session,
          ...(bundle.chat.threadPerPlace === undefined ? {} : { threadPerPlace: bundle.chat.threadPerPlace }),
          onProposed: (what, comment, el) => interactions.onProposedComment(what, comment, el),
          onResolution: (what, resolution, el) => interactions.onProposedResolution(what, resolution, el),
          // A commit moves the branch past the canvas, as one made in a terminal does; the page
          // reads the work again as on the reader's return, which updates the canvas when it may.
          onChanges: report => {
            if (changesMoveCanvas(report)) {
              void this.reread()
            }
          },
          canvasUpdatesItself: () => this.autoUpdate,
          onUpdateCanvas: () => void this.reread({ update: true }),
        })
        this.quickQuestions = wireQuickQuestions(this, {
          onPick: (context, question) => {
            if (question === null) {
              this.chat?.ask(context)
            } else {
              this.chat?.askQuestion(context, question)
            }
          },
        })
      } else {
        this.reviewPane = wireReviewPane(this)
      }
      if (bundle.status === 'stale') {
        this.startPolling(next => next.status === 'ready')
      }
      // A reviewer's page follows the author's resolutions while it stays open. The author's own
      // page has them from the server's answer to each settlement.
      if (
        typeof boot.prNumber === 'number' &&
        bundle.status === 'ready' &&
        !bundle.selfReview &&
        bundle.canvas
      ) {
        this.settledPoller = pollSettled(boot.prNumber, bundle.canvas.headSha, answer => {
          if (answer.generatedAt !== artifact.generatedAt) {
            // A newer generation for this commit was imported; its resolutions belong to it.
            this.settledPoller?.stop()
            this.settledPoller = null
            toast(this, 'the author shared a newer canvas for this commit; refresh to load it')
            return
          }
          const added = session.takeSettled(answer)
          if (added.length > 0) {
            toast(
              this,
              `the author resolved ${added.length === 1 ? 'a point' : `${added.length} points`}; show them from each layer's attention points`
            )
          }
        })
      }
    } else {
      const screen = bundle.status === 'stale' ? renderStaleState(bundle) : renderEmptyState(bundle)
      this.innerHTML =
        header +
        bannerHtml(bundle.warnings) +
        `<div class="layout no-chat"><nav class="rail" aria-label="Review layers"><ul class="tree"><li><a href="#empty-state" aria-current="location"><span class="t">Overview</span><span class="m">no canvas yet</span></a></li></ul></nav><main id="main">${screen}</main></div>` +
        footerHtml(boot.version, bundle)
      // A canvas published from the harness shows up here without a reload.
      this.startPolling(next => next.status === 'ready')
    }
    // Mermaid is fetched only when this screen holds a diagram, and again on a theme flip.
    this.diagrams = initDiagrams(this)
    // One layer at a time hides the rest before the URL is followed, so a link into a layer lands
    // on a layer that is showing.
    this.layerView?.redraw()
    // The cards are in the page now, so a link in the URL has something to land on.
    this.deepLinks = initDeepLinks(this)
    this.scrollSpy = initScrollSpy(this)
    this.wireCommands(bundle)
  }

  /**
   * The header's skin and theme commands, on every screen and on the error screen too. A failed
   * save says so in a toast, since the next load would come back in the old look.
   */
  wireAppearance() {
    wireAppearanceCommands(this, (what, saved) => {
      if (!saved) toast(this, `could not save the ${what} to settings.yml`)
    })
  }

  /** @param {PrBundle} bundle */
  wireCommands(bundle) {
    // The review screen routes this through the delegated handler; the empty and stale screens
    // have no such handler, so the command is wired here for every screen.
    const settings = qs('#settings', this)
    if (settings instanceof HTMLElement && this.interactions === null) {
      settings.addEventListener(
        'click',
        () => void openSettingsDialog(this, settings, { onSaved: data => void this.settingsSaved(data) })
      )
    }
    this.wireAppearance()
    const boot = this.bootstrap
    if (!boot) {
      return
    }
    // With an agent to run it, the page generates the canvas itself; without one, it gives the
    // skill command to run in Claude Code or Codex and waits for the canvas that command publishes.
    if (bundle.chat.enabled) {
      this.generation ??= createGeneration(this, {
        prNumber: boot.prNumber,
        onEnded: (job, how) => this.generationEnded(job, how),
        onError: message => toast(this, message),
      })
      this.generation.attach(bundle)
    }
    const generation = bundle.chat.enabled ? this.generation : null
    const openDialog =
      generation === null
        ? () => {
            openRegenerateDialog(this, bundle.skillCommand)
            this.startPolling(next => canvasChanged(bundle, next))
          }
        : () => generation.open(bundle)
    qs('#regenerate', this)?.addEventListener('click', openDialog)
    qs('#stale-generate', this)?.addEventListener('click', openDialog)
    qs('#generate-start', this)?.addEventListener('click', openDialog)
    const exportZip = qs('#export-zip', this)
    if (exportZip instanceof HTMLElement) {
      exportZip.addEventListener('click', () => {
        // The canvas on screen is the one to export, which is the older one on the stale screen.
        const headSha = bundle.canvas?.headSha
        void runCommand(exportZip, () => exportCanvasZip(boot.prNumber, headSha ? { headSha } : {}), {
          pendingLabel: 'exporting…',
        })
      })
    }
    const fetchShared = qs('#fetch-shared', this)
    if (fetchShared instanceof HTMLElement) {
      fetchShared.addEventListener('click', () => {
        void runCommand(
          fetchShared,
          async () => {
            // Imported or not, the answer changes the callout, so the screen is drawn again.
            await fetchSharedCanvas(boot.prNumber)
            await this.reload()
          },
          { pendingLabel: 'fetching…' }
        )
      })
    }
    const refresh = qs('#refresh', this)
    if (refresh instanceof HTMLElement) {
      refresh.addEventListener('click', () => {
        void runCommand(refresh, () => this.reload({ refresh: true }), { pendingLabel: 'refreshing…' })
      })
    }
    const viewStale = qs('#view-stale', this)
    viewStale?.addEventListener('click', () => {
      this.viewStale = true
      void this.render(bundle)
    })
    // Importing a canvas a teammate attached is a pull request thing; local work has no thread
    // to attach one to, and the local screens draw no drop zone.
    if (typeof boot.prNumber === 'number') {
      wireDropZone(this, {
        prNumber: boot.prNumber,
        importImpl: importCanvas,
        onImported: () => void this.reload(),
      })
    }
  }

  /**
   * The settings the dialog saved, applied to the open page without a reload.
   * @param {import('./contract-types.js').SettingsResponse} data
   */
  async settingsSaved(data) {
    const next = data.settings.layerView
    const redraw = (this.view === 'points') !== (next === 'points')
    this.view = next
    if (redraw && this.shown) {
      await this.render(this.shown)
    }
    this.layerView?.setView(next)
    this.chat?.followSettings(data.settings)
    applyPointColors(data.settings.pointColors, document.documentElement)
    this.autoUpdate = data.settings.autoUpdateCanvas
  }

  /**
   * The reader came back to a local review. The work is read again, and the screen drawn again
   * only when what it shows moved; a canvas the reader was reading stays on screen under the
   * outdated bar. A branch review whose canvas is now of an earlier commit is then updated, when
   * the reader's setting lets the page do it or the reader asked for it (`update`).
   * @param {{ update?: boolean }} [opts]
   */
  async reread(opts = {}) {
    const boot = this.bootstrap
    const shown = this.shown
    if (!boot || !shown) {
      return
    }
    /** @type {PrBundle} */
    let next
    try {
      next = await fetchBundle(boot.prNumber)
    } catch {
      // The next return tries again; the screen still shows what it did.
      return
    }
    if (screenMoved(shown, next)) {
      const readingCanvas = shown.status === 'ready' && shown.artifact !== undefined
      if (readingCanvas && next.status === 'stale') {
        this.viewStale = true
      }
      await this.render(next)
    }
    const generation = this.generation
    const job = generation?.job ?? null
    const running = job !== null && isRunning(job)
    if (
      generation === null ||
      !shouldAutoUpdate(next, {
        enabled: this.autoUpdate || opts.update === true,
        running,
        lastHead: this.autoUpdatedHead,
      })
    ) {
      return
    }
    this.autoUpdatedHead = next.pr.headSha
    await generation.autoUpdate(next)
  }

  /**
   * A job this page watched has ended. A published canvas is loaded; the dialog comes back over
   * it when the reader had it open, or when sharing failed and the reader has an upload to do. An
   * update the page started by itself says how it went in a toast when it published, and in its
   * corner notice when it did not.
   * @param {import('./contract-types.js').GenerationJob} job
   * @param {{ auto: boolean }} [how]
   */
  async generationEnded(job, how = { auto: false }) {
    const wasOpen = this.querySelector('#generate-dialog')?.hasAttribute('open') === true
    if (job.phase !== 'done') {
      if (!wasOpen && !how.auto) {
        toast(
          this,
          job.phase === 'cancelled'
            ? 'canvas generation stopped'
            : `canvas generation failed: ${job.error?.message ?? 'open the generation dialog for details'}`
        )
      }
      return
    }
    await this.reload().catch(() => undefined)
    if (wasOpen || job.sharing?.status === 'failed') {
      this.generation?.showLast()
    } else if (how.auto) {
      toast(
        this,
        job.headSha === undefined ? 'canvas updated' : `canvas updated to ${job.headSha.slice(0, 7)}`
      )
    } else {
      toast(this, 'canvas published')
    }
  }

  /**
   * Re-reads the bundle and re-renders, after an import changed what the server holds. With
   * `refresh` the server asks GitHub again instead of answering from its caches.
   * @param {{ refresh?: boolean }} [opts]
   */
  async reload(opts = {}) {
    const boot = this.bootstrap
    if (!boot) {
      return
    }
    const next = await fetchBundle(boot.prNumber, opts.refresh === true ? { refresh: true } : {})
    await this.render(next)
  }

  /**
   * One poller at a time. When `until` holds, the new bundle replaces the screen.
   * @param {(bundle: PrBundle) => boolean} until
   */
  startPolling(until) {
    const boot = this.bootstrap
    if (!boot) {
      return
    }
    this.stopPolling()
    this.poller = pollBundle(boot.prNumber, {
      until,
      onBundle: next => {
        if (until(next)) {
          this.poller = null
          void this.render(next)
        }
      },
    })
  }

  stopPolling() {
    this.poller?.stop()
    this.poller = null
  }
}

if (!customElements.get('pr-app')) {
  customElements.define('pr-app', PrAppElement)
}
