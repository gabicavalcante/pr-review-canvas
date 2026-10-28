// @ts-check
// The rail: the overview, the layers with their progress and size, and the Other layer; in the
// one-point view, the attention points under their layers, with the switch between the two views.
// It reads the diff's sizes from the render context `layers.js` keeps.
/** @typedef {import('./contract-types.js').Layer} Layer */
/** @typedef {import('./contract-types.js').PrState} PrState */
/** @typedef {import('./contract-types.js').ReviewArtifact} ReviewArtifact */
import { diffstatHtml, layerChanges } from './diffstat.js'
import { esc } from './dom.js'
import { layerAnchorId, layerStepAnchorId } from './keys.js'
import { fileCount, getRenderContext } from './layers.js'
import { levelIconHtml } from './point-level.js'
import { pointSteps, stopsOf } from './point-steps.js'
import { openPoints, pointStatus } from './points.js'
import { filesReviewed, layerProgress } from './progress.js'

/**
 * Stripe color for a layer position (cycles through the six bands).
 * @param {number} index
 */
export function dotColor(index) {
  return `var(--s${(index % 6) + 1})`
}

/**
 * A layer's heading over its points in the rail's points group: its title, leading to the layer's
 * opening stop, with its description and tests.
 * @param {Layer | null} layer
 */
function railPointsLayerHtml(layer) {
  if (layer === null) {
    return '<li class="pt-layer"><span class="t">No layer</span></li>'
  }
  return `<li class="pt-layer"><a href="#${esc(layerStepAnchorId(layer.key))}"><span class="t">${esc(layer.title)}</span></a></li>`
}

/**
 * The switch at the head of the rail, for a canvas with points: the one-point view's attention
 * points, or the layers, in the layer view the reader read them in last. The one shown is pressed.
 * @param {boolean} points
 */
function railViewSwitchHtml(points) {
  const option = (/** @type {string} */ view, /** @type {string} */ label, /** @type {boolean} */ on) =>
    `<button type="button" data-act="layer-view" data-view="${view}" aria-pressed="${on}">${label}</button>`
  return `<div class="rail-view" role="group" aria-label="Read by">${option('points', 'Attention points', points)}${option('layers', 'Layers', !points)}</div>`
}

/**
 * The rail's group of attention points in the one-point view: every point in the view's order,
 * under the layer each belongs to. It is drawn from the state, so a point acted on dims at once.
 * @param {ReviewArtifact} artifact
 * @param {PrState} state
 * @param {(id: string) => string} current
 */
function railPointsHtml(artifact, state, current) {
  // The rail lists the view's stops, so a layer that opens with a stop has its title here, points
  // or none.
  let unlayered = false
  const items = stopsOf(artifact, pointSteps(artifact, artifact.points))
    .map(stop => {
      if (stop.kind === 'layer') {
        return railPointsLayerHtml(stop.layer)
      }
      const { point, layer } = stop.step
      // Points of no listed layer have no opening stop; they come last, under one heading.
      const heading = layer === null && !unlayered ? railPointsLayerHtml(null) : ''
      unlayered ||= layer === null
      const handled = pointStatus(point, state) === 'open' ? '' : ' class="is-handled"'
      return `${heading}<li${handled}><a href="#${esc(stop.id)}"${current(stop.id)}>${levelIconHtml(point.level, null)}<span class="t">${esc(point.title)}</span></a></li>`
    })
    .join('')
  return `<li class="grp">${railViewSwitchHtml(true)}<ul class="rail-points">${items}</ul></li>`
}

/**
 * With a render context, each layer shows the lines it adds and removes. `points` draws, in place
 * of the layers, the attention points the one-point view walks. `switchable`, on a page that reads
 * by attention points, heads the rail's group of a canvas with points with the switch between the
 * two.
 * @param {ReviewArtifact} artifact
 * @param {PrState} state
 * @param {{ activeId?: string, points?: boolean, switchable?: boolean }} [opts]
 * @returns {string}
 */
export function railInnerHtml(artifact, state, opts = {}) {
  const active = opts.activeId ?? 'overview'
  const ctx = getRenderContext()
  const current = /** @param {string} id */ id => (id === active ? ' aria-current="location"' : '')
  const semantic = artifact.layers.filter(l => l.kind !== 'other')
  const other = artifact.layers.find(l => l.kind === 'other')
  const items = semantic
    .map((layer, i) => {
      const progress = layerProgress(layer, state)
      const dotClass = progress === 'done' ? 'dot on' : progress === 'partial' ? 'dot half' : 'dot'
      const dotLabel =
        progress === 'done' ? 'reviewed' : progress === 'partial' ? 'in progress' : 'not started'
      const reviewed = filesReviewed(layer, state)
      const files = layer.files.length
      const meta = reviewed > 0 && reviewed < files ? `${reviewed} of ${files} files` : fileCount(files)
      const changes = ctx === null ? null : layerChanges(layer, ctx.files, ctx.patches)
      const stat = changes === null ? '' : ` · ${diffstatHtml(changes.total, changes.tests)}`
      const risk = layer.risk.length > 0 ? ` · ${layer.risk.map(r => esc(r.label)).join(' · ')}` : ''
      const id = layerAnchorId(layer.key)
      return (
        `<li><a href="#${esc(id)}"${current(id)}><span class="${dotClass}" style="--dc:${dotColor(i)}" role="img" aria-label="${dotLabel}"></span>` +
        `<span class="n">${i + 1}</span><span class="t">${esc(layer.title)}</span><span class="m">${meta}${stat}${risk}</span></a></li>`
      )
    })
    .join('')
  const points = openPoints(artifact.points, state).length
  const otherItem = other
    ? `<li class="other"><a href="#${esc(layerAnchorId(other.key))}"${current(layerAnchorId(other.key))}><span class="t">${esc(other.title)}</span><span class="m">${fileCount(other.files.length)}, ignored</span></a></li>`
    : ''
  const overview = `<li><a href="#overview"${current('overview')}><span class="t">Overview</span><span class="m">${points} attention ${points === 1 ? 'point' : 'points'}</span></a></li>`
  const hasPoints = artifact.points.length > 0
  if (opts.points === true && hasPoints) {
    return `<ul class="tree">${overview}${railPointsHtml(artifact, state, current)}</ul>`
  }
  const heading =
    hasPoints && opts.switchable === true
      ? railViewSwitchHtml(false)
      : '<span class="lbl grp-lbl">Layers</span>'
  return `<ul class="tree">${overview}<li class="grp">${heading}<ul class="layers">${items}</ul></li>${otherItem}</ul>`
}

/**
 * `switchable` marks the rail of a page that reads by attention points, which keeps the switch
 * between them and the layers when the rail is drawn again.
 * @param {ReviewArtifact} artifact
 * @param {PrState} state
 * @param {{ activeId?: string, switchable?: boolean }} [opts]
 * @returns {string}
 */
export function renderRail(artifact, state, opts = {}) {
  return `<nav class="rail" aria-label="Review layers"${opts.switchable === true ? ' data-switchable' : ''}>${railInnerHtml(artifact, state, opts)}</nav>`
}

/**
 * Draws the rail again from the current state, keeping the item the scrollspy marked.
 * @param {ParentNode} root
 * @param {ReviewArtifact} artifact
 * @param {PrState} state
 */
export function refreshRail(root, artifact, state) {
  const rail = root.querySelector('nav.rail')
  if (!(rail instanceof HTMLElement)) {
    return false
  }
  const active = rail.querySelector('a[aria-current]')?.getAttribute('href')?.slice(1)
  rail.innerHTML = railInnerHtml(artifact, state, {
    ...(active === undefined ? {} : { activeId: active }),
    points: rail.hasAttribute('data-points'),
    switchable: rail.hasAttribute('data-switchable'),
  })
  return true
}
