// @ts-check
/** @typedef {import('./contract-types.js').PrBundle} PrBundle */
/** @typedef {import('./contract-types.js').RiskTag} RiskTag */
import { setDisabledReason } from './composer.js'
import { diffstatHtml, testChanges } from './diffstat.js'
import { esc, timeAgo } from './dom.js'
import { generationMode } from './generate.js'
import { authorProfileUrl, currentHost, hostLabel } from './host.js'
import { refreshRail } from './layers.js'
import { draftsByCommit, pendingBarHtml, pendingCount } from './pending.js'
import { progressSummary } from './progress.js'
import { authorNextStepHtml, pointsStillYours } from './self-review.js'
import { approveBlockedReason } from './signoff.js'
import { headerBarHtml } from './header-bar.js'

/**
 * @param {ReadonlyArray<RiskTag>} risk
 * @returns {string} the `touches:` line, or '' when nothing is tagged
 */
export function riskLineHtml(risk) {
  if (risk.length === 0) {
    return ''
  }
  const pills = risk
    .map(r => {
      const title = r.source === 'model' && r.reason ? ` title="${esc(r.reason)}"` : ''
      return `<span class="pill risk ${r.source}"${title}>${esc(r.label)}</span>`
    })
    .join('<span aria-hidden="true">·</span>')
  return `<p class="touches"><span>touches:</span>${pills}</p>`
}

/**
 * One line saying the canvas was generated under the large-change-set caps, so a reader who finds
 * a file with no annotation knows why.
 * @param {PrBundle} bundle
 */
export function largePrNoticeHtml(bundle) {
  if (!bundle.largePr) {
    return ''
  }
  return (
    '<p class="notice large-pr" role="status">Large change set: the canvas keeps at most 6 annotations per file ' +
    'and 12 attention points, and diffs were not inlined for the generator.</p>'
  )
}

/**
 * The author, linked to their page on the forge. A local review's author is the name this clone
 * commits as, which is no forge login, so it stays plain text.
 * @param {string} author
 * @param {boolean} local
 * @returns {string}
 */
function authorHtml(author, local) {
  return local
    ? esc(author)
    : `<a href="${esc(authorProfileUrl(author))}" target="_blank" rel="noopener noreferrer">${esc(author)}</a>`
}

/** @param {PrBundle['pr']} pr */
export function statePill(pr) {
  const state = pr.state === 'open' && pr.draft ? 'draft' : pr.state
  return `<span class="pill ${esc(state)}">${esc(state)}</span>`
}

/**
 * The one generate command in the header, named for what it does on this screen. With an agent,
 * the page generates the first canvas, updates an outdated one, or writes the current one again.
 * Without one, it shows the skill command, which needs a canvas to regenerate. While a job runs,
 * `generate.js` puts the job on this button instead.
 * @param {PrBundle} bundle
 * @param {boolean} hasCanvas
 * @returns {{ label: string, title: string, disabled: boolean }}
 */
export function generateCommand(bundle, hasCanvas) {
  if (!bundle.chat.enabled) {
    const what = bundle.local !== undefined ? 'this local work' : 'this PR'
    return { label: 'regenerate', title: `Generate a new canvas for ${what}`, disabled: !hasCanvas }
  }
  const { label, title } = generationMode(bundle)
  return { label, title, disabled: false }
}

/** @typedef {import('./header-bar.js').ProjectLink} ProjectLink */
/** @typedef {import('./header-bar.js').BarOptions} BarOptions */

/**
 * The header of a page that could not load its review: the bar with no commands of its own, so
 * the reader can still leave for another review or project, or change the look.
 * @param {BarOptions} opts
 * @returns {string}
 */
export function bareHeaderHtml(opts) {
  return `<header class="hdr">${headerBarHtml(opts, '')}<div class="stripe" aria-hidden="true"></div></header>`
}

/**
 * @param {PrBundle} bundle
 * @param {{ host: string, theme: import('./theme.js').Theme, skin: import('./skin.js').Skin, now: Date, project?: ProjectLink | undefined }} opts
 *   The wordmark links to the project list; the project, when the page has one, gets a link home.
 * @returns {string}
 */
export function renderHeader(bundle, opts) {
  const { pr, artifact } = bundle
  const ready = bundle.status === 'ready' && artifact !== undefined
  // A stale canvas can be exported and regenerated too, so both commands stay live for it.
  const hasCanvas = artifact !== undefined && (bundle.status === 'ready' || bundle.status === 'stale')
  const generate = generateCommand(bundle, hasCanvas)
  const agent = ready
    ? `<span class="pill agent" title="The agent, model, and harness that generated this canvas">canvas by ${esc(artifact.generator.agent)}${artifact.generator.model ? ` · ${esc(artifact.generator.model)}` : ''} · ${esc(artifact.generator.harness)}</span><span>generated ${esc(timeAgo(artifact.generatedAt, opts.now))}</span>`
    : ''
  const number = pr.number === null ? '' : `<span class="mono num">#${pr.number}</span>`
  // Work that is not pushed has no page on the forge, and nothing to refresh from it either: the
  // page reads the work again whenever the reader comes back to it.
  const local = bundle.local !== undefined
  const forgeLink =
    pr.url === ''
      ? ''
      : `<a class="cmd" href="${esc(pr.url)}" target="_blank" rel="noopener noreferrer">${esc(currentHost().kind)}</a>`
  const refresh = local
    ? ''
    : `<button class="cmd" type="button" id="refresh" title="Fetch the latest PR, comments, and shared canvas from ${esc(hostLabel())}">refresh</button>`
  const progress = ready
    ? progressHtml(artifact, bundle.state, { pr, readerIsAuthor: bundle.readerIsAuthor, local })
    : ''
  const risk = ready ? riskLineHtml(artifact.risk) : ''
  return (
    '<header class="hdr">' +
    headerBarHtml(
      opts,
      `<button class="cmd" type="button" id="regenerate" title="${esc(generate.title)}" aria-haspopup="dialog"${generate.disabled ? ' disabled' : ''}>${generate.label}</button>` +
        `<button class="cmd" type="button" id="export-zip" title="Download this canvas as a zip to share on ${esc(hostLabel())}"${hasCanvas ? '' : ' disabled'}>export zip</button>` +
        refresh +
        '<button class="cmd" type="button" id="settings" data-act="settings" aria-haspopup="dialog" title="Configure the default reading level, how layers show, point colors, and the AI Chat agent, model, and limits">settings</button>' +
        '<button class="cmd" type="button" data-act="help" title="Show keyboard shortcuts and review help" aria-haspopup="dialog">help</button>'
    ) +
    '<div class="stripe" aria-hidden="true"></div>' +
    '<div class="hdr-title">' +
    `<div class="title"><h1>${number}${esc(pr.title)}</h1>${forgeLink}</div>` +
    `<p class="meta"><span>by ${authorHtml(pr.author, local)}</span>` +
    `<span class="mono">${esc(pr.headRef)} &rarr; ${esc(pr.baseRef)}</span>${statePill(pr)}` +
    `${diffstatHtml(pr, ready ? testChanges(artifact, bundle.files) : undefined)}${agent}</p>` +
    `${largePrNoticeHtml(bundle)}${risk}${progress}</div></header>`
  )
}

/**
 * The thin line, its text, the pending-review bar, and the sign-off commands. Approve stays
 * disabled with the reason until every layer that is not Other has been marked reviewed; a
 * comment-only review and a request for changes are always allowed, since neither claims the
 * change set was read in full. The author of the pull request gets neither verdict, which the
 * forge refuses on one's own change, but their next step in their place, and keeps comment.
 * @param {import('./contract-types.js').ReviewArtifact} artifact
 * @param {import('./contract-types.js').PrState} state
 * @param {{ pr?: PrBundle['pr'], readerIsAuthor?: boolean, local?: boolean }} [opts] `pr` the pull
 *   request as the page has it now, whose diff the drafts belong to and whose state words the
 *   author's step; `readerIsAuthor` as the bundle says it; `local` for work with no pull request,
 *   which has nowhere to post a review, so it gets no sign-off at all
 */
export function progressHtml(artifact, state, opts = {}) {
  const { pr = artifact.pr, readerIsAuthor = false, local = false } = opts
  const p = progressSummary(artifact, state)
  const blocked = approveBlockedReason(artifact, state)
  const approveTitle = `Write and preview an approving review on ${esc(hostLabel())}`
  const verdicts = readerIsAuthor
    ? authorNextStepHtml(pointsStillYours(artifact.points, artifact.settled ?? {}), pr)
    : `<button class="cmd" type="button" id="approve" data-tooltip="${approveTitle}" data-act="signoff" data-event="APPROVE" data-needs-post` +
      `${blocked === null ? ` title="${approveTitle}"` : ` disabled data-disabled-reason="${esc(blocked)}" title="${esc(blocked)}"`}>approve on ${esc(currentHost().kind)}</button>` +
      `<button class="cmd" type="button" id="request-changes" data-tooltip="Write and preview a review requesting changes on ${esc(hostLabel())}" title="Write and preview a review requesting changes on ${esc(hostLabel())}" data-act="signoff" data-event="REQUEST_CHANGES" data-needs-post>request changes</button>`
  const commentTitle = `Write and preview a review with no verdict on ${esc(hostLabel())}`
  const signoff = local
    ? ''
    : `<div class="signoff">${verdicts}` +
      `<button class="cmd" type="button" id="comment-review" data-tooltip="${commentTitle}" title="${commentTitle}" data-act="signoff" data-event="COMMENT" data-needs-post>comment</button>` +
      '<span class="capability-note" role="status"></span></div>'
  return (
    `<div class="progress"><div class="pline" role="progressbar" aria-valuenow="${p.done}" aria-valuemin="0" aria-valuemax="${p.total}" aria-label="Layers reviewed"><span style="width:${p.percent}%"></span></div>` +
    `<span class="ptext">${p.done} of ${p.total} layers reviewed</span></div>` +
    `<div class="pending-bar-host${pendingCount(state) > 0 ? ' has-pending' : ''}">${pendingBarHtml(
      pendingCount(state),
      draftsByCommit(state, pr).earlier.length
    )}</div>` +
    signoff
  )
}

/**
 * Draws the progress line, its text, and the approve command again from the current state, and
 * with them the rail. Called after every reviewed change.
 * @param {ParentNode} root
 * @param {import('./contract-types.js').ReviewArtifact} artifact
 * @param {import('./contract-types.js').PrState} state
 */
export function refreshProgress(root, artifact, state) {
  const p = progressSummary(artifact, state)
  const line = root.querySelector('.pline')
  const fill = line?.querySelector('span')
  if (line !== null) {
    line.setAttribute('aria-valuenow', String(p.done))
    line.setAttribute('aria-valuemax', String(p.total))
  }
  if (fill instanceof HTMLElement) {
    fill.style.width = `${p.percent}%`
  }
  const text = root.querySelector('.ptext')
  if (text !== null) {
    text.textContent = `${p.done} of ${p.total} layers reviewed`
  }
  setDisabledReason(root.querySelector('#approve'), approveBlockedReason(artifact, state))
  refreshRail(root, artifact, state)
  return p
}
