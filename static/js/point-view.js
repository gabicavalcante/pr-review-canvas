// @ts-check
// The one-point-at-a-time view's stops, layer by layer. Each layer opens with a stop of its own:
// its heading, its description, and its tests shown at once, leading on to its attention points.
// Each point's stop is the point's card, whole, then the file it is on, showing only the chunk
// that holds its lines and the point's mark in it. A stop draws no copy of either: it has a slot
// for each, which takes the layer's own card while the stop shows (`one-layer.js` moves it there
// and back), so every card, line and thread is on the page once. Every stop leads to the one
// before and after; the last leads to the layers, for the rest of the diff. Only that view draws
// the stops, and `one-layer.js` shows them one at a time.
/** @typedef {import('./contract-types.js').FileEntry} FileEntry */
/** @typedef {import('./contract-types.js').PrState} PrState */
/** @typedef {import('./contract-types.js').ReviewArtifact} ReviewArtifact */
/** @typedef {import('./contract-types.js').ReviewComment} ReviewComment */
/** @typedef {ReviewArtifact['layers'][number]} Layer */
/** @typedef {import('./point-steps.js').PointStep} PointStep */
/** @typedef {import('./point-steps.js').Stop} Stop */
/**
 * Where a way from a stop goes and what it says. `attrs` carry what a link there needs to switch
 * the view; `lead` marks the way on a layer's opening stop leads its reader to.
 * @typedef {{ href: string, label: string, attrs: string, lead?: boolean }} StopWay
 */
import { askButtonHtml } from './ask.js'
import { esc } from './dom.js'
import { layerAnchorId, layerStepAnchorId, reviewedId, stepAnchorId } from './keys.js'
import { hunkIdForPoint, hunkLayerIndex, pathSet, testMapHtml } from './layers.js'
import { renderMarkdown } from './markdown.js'
import { pointSteps, stopsOf } from './point-steps.js'
import { pointCardHtml, postedUrls } from './points.js'
import { layerProgress } from './progress.js'

export const POINT_STEPS_ID = 'point-steps'

/**
 * The position of a layer of the change, its number of how many, or null for Other, which has none.
 * @param {ReviewArtifact} artifact
 * @param {Layer} layer
 * @returns {{ number: number, total: number } | null}
 */
function layerPosition(artifact, layer) {
  const semantic = artifact.layers.filter(l => l.kind !== 'other')
  return layer.kind === 'other' ? null : { number: semantic.indexOf(layer) + 1, total: semantic.length }
}

/**
 * The ways from a stop: back to the one before, and on to the next, whose label says what it is.
 * After the last stop come the layers, for the rest of the diff: the way there switches to them as
 * the rail's switch does, on the first layer, so the rail lists every layer again.
 * @param {ReadonlyArray<Stop>} stops
 * @param {number} index
 * @param {ReviewArtifact} artifact
 * @returns {{ back: StopWay, on: StopWay | null }}
 */
function stopWays(stops, index, artifact) {
  const stop = stops[index]
  const previous = stops[index - 1]
  const next = stops[index + 1]
  const firstLayer = artifact.layers[0]
  const back =
    previous === undefined
      ? { href: '#overview', label: 'overview', attrs: '' }
      : {
          href: `#${previous.id}`,
          label: previous.kind === 'layer' ? previous.layer.title : 'previous point',
          attrs: '',
        }
  if (next === undefined) {
    return {
      back,
      on:
        firstLayer === undefined
          ? null
          : {
              href: `#${layerAnchorId(firstLayer.key)}`,
              label: 'the rest of the diff, by layer',
              attrs: ' data-act="layer-view" data-view="layers"',
            },
    }
  }
  if (stop?.kind === 'layer' && next.kind === 'point') {
    const count = stop.points.length
    return {
      back,
      on: {
        href: `#${next.id}`,
        label: `go to its ${count} attention point${count === 1 ? '' : 's'}`,
        attrs: '',
        lead: true,
      },
    }
  }
  return {
    back,
    on: {
      href: `#${next.id}`,
      label: next.kind === 'layer' ? `next layer: ${next.layer.title}` : 'next point',
      attrs: '',
    },
  }
}

/**
 * The way on at the foot of a stop, each way named.
 * @param {{ back: StopWay, on: StopWay | null }} ways
 */
function stopNavHtml({ back, on }) {
  const link = /** @param {StopWay} way @param {string} text */ (way, text) =>
    `<a${way.lead === true ? ' class="step-on"' : ''} href="${esc(way.href)}"${way.attrs}>${text}</a>`
  const onLink = on === null ? '' : link(on, `${esc(on.label)} &rarr;`)
  return `<nav class="step-nav" aria-label="Attention points">${link(back, `&larr; ${esc(back.label)}`)}${onLink}</nav>`
}

/**
 * The same ways as arrows at the head of a stop, so a reader at the top of a tall one need not
 * scroll down to move. Each says where it goes to a screen reader and on hover.
 * @param {{ back: StopWay, on: StopWay | null }} ways
 */
function stopArrowsHtml({ back, on }) {
  const arrow = /** @param {StopWay} way @param {string} glyph */ (way, glyph) =>
    `<a href="${esc(way.href)}"${way.attrs} aria-label="${esc(way.label)}" title="${esc(way.label)}">${glyph}</a>`
  return `<nav class="step-arrows" aria-label="Attention points, from the top">${arrow(back, '&larr;')}${on === null ? '' : arrow(on, '&rarr;')}</nav>`
}

/**
 * The way on from the overview in the one-point view: to its first stop, the first layer's opening
 * when the layer has one. Nothing for a canvas with no point, which has no stops.
 * @param {ReviewArtifact} artifact
 */
export function overviewWayOnHtml(artifact) {
  // The stops are drawn only for a canvas with points, so with none there is nowhere to lead.
  const steps = pointSteps(artifact, artifact.points)
  const first = steps.length === 0 ? undefined : stopsOf(artifact, steps)[0]
  if (first === undefined) {
    return ''
  }
  const position = first.kind === 'layer' ? layerPosition(artifact, first.layer) : null
  const label =
    first.kind === 'point'
      ? 'the first attention point'
      : position === null
        ? first.layer.title
        : `Layer ${position.number}: ${first.layer.title}`
  return `<nav class="step-nav" aria-label="Attention points"><a class="step-on" href="#${esc(first.id)}">start with ${esc(label)} &rarr;</a></nav>`
}

/**
 * Where the switch between the views lands, for the place the reader is at: the layer a layer's
 * section, its opening stop, or one of its points' stops names, shown in the other view. Into the
 * one-point view that is the layer's opening stop, or '' for the view's first stop when the layer
 * has none or the place is no layer's; into a layer view, the layer's section, or the place as it is.
 * @param {ReviewArtifact} artifact
 * @param {import('./layer-views.js').PageView} view the view switched to
 * @param {string} hash the place, as `#id`
 */
export function viewSwitchTarget(artifact, view, hash) {
  const point = artifact.points.find(p => hash === `#${stepAnchorId(p.id)}`)
  const layer = artifact.layers.find(
    candidate =>
      candidate.id === point?.layerId ||
      hash === `#${layerAnchorId(candidate.key)}` ||
      hash === `#${layerStepAnchorId(candidate.key)}`
  )
  if (view !== 'points') {
    return layer === undefined ? hash : `#${layerAnchorId(layer.key)}`
  }
  if (hash === '#overview') {
    return hash
  }
  const opening = layer === undefined ? undefined : layerStepAnchorId(layer.key)
  const stops = stopsOf(artifact, pointSteps(artifact, artifact.points))
  return stops.some(stop => stop.id === opening) ? `#${opening}` : ''
}

/**
 * A layer's opening stop, without its way on: the layer's heading with its reviewed mark and ask
 * command, its description, and its tests, shown at once.
 * @param {Extract<Stop, { kind: 'layer' }>} stop
 * @param {ReviewArtifact} artifact
 * @param {PrState} state
 * @param {ReadonlySet<string>} paths
 * @param {string} arrows the ways on, at the head beside the layer's commands
 */
function layerStopHtml(stop, artifact, state, paths, arrows) {
  const { layer } = stop
  const position = layerPosition(artifact, layer)
  const reviewed = layerProgress(layer, state) === 'done'
  const controls =
    layer.kind === 'other'
      ? ''
      : `<div class="layer-ctl"><label class="chk"><input type="checkbox" data-reviewed-id="${esc(reviewedId(layer.key))}"${reviewed ? ' checked' : ''}> reviewed</label>` +
        `${askButtonHtml({ kind: 'layer', layerId: layer.id }, { label: 'ask about this layer' })}</div>`
  return (
    `<section class="point-step layer-step" id="${esc(stop.id)}" data-layer="${esc(layer.id)}" aria-label="${esc(layer.title)}">` +
    `<div class="panel-h layer-h"><h2>${position === null ? '' : `<span class="lbl">Layer ${position.number} of ${position.total}</span>`}${esc(layer.title)}</h2>${controls}${arrows}</div>` +
    `<div class="body"><div class="rationale prose">${renderMarkdown(layer.rationale, { paths, diagrams: true })}</div></div>` +
    testMapHtml(layer, paths)
  )
}

/**
 * Every layer's opening stop and every attention point's stop, in the view's order. A point the
 * reader acted on keeps its stop, so the sequence stays the same while the reader works through
 * it. A canvas with no point has none.
 * @param {ReviewArtifact} artifact
 * @param {ReadonlyArray<FileEntry>} files
 * @param {PrState} state
 * @param {ReadonlyArray<ReviewComment>} [comments] so a point that was posted says so
 * @returns {string}
 */
export function renderPointSteps(artifact, files, state, comments = []) {
  const steps = pointSteps(artifact, artifact.points)
  if (steps.length === 0) {
    return ''
  }
  const ctx = {
    hunkIndex: hunkLayerIndex(artifact),
    paths: pathSet(files),
    state,
    posted: postedUrls(state, comments),
  }
  const stops = stopsOf(artifact, steps)
  const html = stops.map((stop, index) => {
    const ways = stopWays(stops, index, artifact)
    const nav = stopNavHtml(ways)
    const arrows = stopArrowsHtml(ways)
    if (stop.kind === 'layer') {
      return `${layerStopHtml(stop, artifact, state, ctx.paths, arrows)}${nav}</section>`
    }
    const { point, layer } = stop.step
    const entry = files.find(f => f.path === point.path)
    const hunk = entry === undefined ? '' : hunkIdForPoint(point, entry)
    const owner = hunk === '' ? undefined : ctx.hunkIndex.get(hunk)?.layer
    // The stop draws no copy of the code: its slot takes the layer's own file card while the stop
    // shows (one-layer.js). Its attributes say which card, and which chunk and point in it.
    const code =
      layer === null || owner === undefined
        ? '<p class="muted small">The code this point is about is not in the diff.</p>'
        : ''
    const slotFor =
      owner === undefined
        ? ''
        : ` data-stop-path="${esc(point.path)}" data-stop-layer="${esc(owner.id)}" data-stop-hunk="${esc(hunk)}"`
    // A point the layers draw no card for, as the Other layer's, has its only card here.
    const card = layer === null || layer.kind === 'other' ? pointCardHtml(point, ctx) : ''
    const position = layer === null ? null : layerPosition(artifact, layer)
    const where =
      layer === null
        ? ''
        : ` · <a href="#${esc(layerStepAnchorId(layer.key))}">${esc(position === null ? layer.title : `Layer ${position.number} · ${layer.title}`)}</a>`
    return (
      `<section class="point-step" id="${esc(stop.id)}" data-stop-point="${esc(point.id)}" data-stop-fingerprint="${esc(point.fingerprint)}"${slotFor} aria-label="Attention point ${stop.number} of ${steps.length}">` +
      `<div class="step-h"><p><span class="step-n">Point ${stop.number} of ${steps.length}</span>${where}</p>${arrows}</div>` +
      `<ol class="findings step-card" data-slot="card">${card}</ol>` +
      `<div class="files" data-slot="file">${code}</div>${nav}</section>`
    )
  })
  return `<div class="point-steps" id="${POINT_STEPS_ID}">${html.join('')}</div>`
}
