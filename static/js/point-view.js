// @ts-check
// The one-point-at-a-time view's stops: each open attention point with its code. A stop is the
// point's card, then the file it is on, drawn with the one chunk that holds its lines, then the
// way to the previous and the next stop. The last stop leads to the layers, for the rest of the
// diff. The stops are drawn on every page and shown only by that view (`one-layer.js`).
/** @typedef {import('./contract-types.js').FileEntry} FileEntry */
/** @typedef {import('./contract-types.js').PrState} PrState */
/** @typedef {import('./contract-types.js').ReviewArtifact} ReviewArtifact */
/** @typedef {import('./contract-types.js').ReviewComment} ReviewComment */
/** @typedef {import('./point-steps.js').PointStep} PointStep */
import { esc } from './dom.js'
import { layerAnchorId } from './keys.js'
import { hunkIdForPoint, hunkLayerIndex, pathSet, renderFileCard } from './layers.js'
import { pointSteps } from './point-steps.js'
import { openPoints, pointCardHtml, postedUrls } from './points.js'

export const POINT_STEPS_ID = 'point-steps'

/**
 * The id of a point's stop.
 * @param {{ id: string }} point
 */
export function stepAnchorId(point) {
  return `step-${point.id}`
}

/**
 * What a stop calls its layer: `Layer 2 · title` for a layer of the change, its title for Other.
 * @param {ReviewArtifact} artifact
 * @param {PointStep['layer']} layer
 */
function layerLabel(artifact, layer) {
  if (layer === null) {
    return 'no layer'
  }
  if (layer.kind === 'other') {
    return layer.title
  }
  const number = artifact.layers.filter(l => l.kind !== 'other').indexOf(layer) + 1
  return `Layer ${number} · ${layer.title}`
}

/**
 * The way on from a stop: the previous stop, and the next one or, after the last, the layers.
 * @param {ReadonlyArray<PointStep>} steps
 * @param {number} index
 * @param {ReviewArtifact} artifact
 */
function stepNavHtml(steps, index, artifact) {
  const previous = steps[index - 1]
  const next = steps[index + 1]
  const firstLayer = artifact.layers[0]
  const back =
    previous === undefined
      ? '<a href="#overview">&larr; overview</a>'
      : `<a href="#${esc(stepAnchorId(previous.point))}">&larr; previous point</a>`
  const on =
    next !== undefined
      ? `<a href="#${esc(stepAnchorId(next.point))}">next point &rarr;</a>`
      : firstLayer === undefined
        ? ''
        : `<a href="#${esc(layerAnchorId(firstLayer.key))}">the rest of the diff, by layer &rarr;</a>`
  return `<nav class="step-nav" aria-label="Attention points">${back}${on}</nav>`
}

/**
 * Every open attention point's stop, in the view's order, inside one container the page keeps
 * hidden until the view shows it. A canvas with no open point has none.
 * @param {ReviewArtifact} artifact
 * @param {ReadonlyArray<FileEntry>} files
 * @param {PrState} state
 * @param {ReadonlyArray<ReviewComment>} [comments] so a point that was posted says so
 * @returns {string}
 */
export function renderPointSteps(artifact, files, state, comments = []) {
  const steps = pointSteps(artifact, openPoints(artifact.points, state))
  if (steps.length === 0) {
    return ''
  }
  const ctx = {
    hunkIndex: hunkLayerIndex(artifact),
    paths: pathSet(files),
    firstCardFor: new Set(),
    state,
    posted: postedUrls(state, comments),
  }
  const stops = steps.map(({ point, layer }, index) => {
    const id = stepAnchorId(point)
    const entry = files.find(f => f.path === point.path)
    const hunk = entry === undefined ? '' : hunkIdForPoint(point, entry)
    const layerFile = layer?.files.find(f => f.path === point.path)
    const code =
      layer === null || entry === undefined || hunk === ''
        ? '<p class="muted small">The code this point is about is not in the diff.</p>'
        : renderFileCard(
            { ...(layerFile ?? { path: point.path, isTest: false, annotations: [] }), hunks: [hunk] },
            entry,
            layer,
            ctx,
            { id: `${id}-file`, open: true }
          )
    const where =
      layer === null
        ? ''
        : ` · <a href="#${esc(layerAnchorId(layer.key))}">${esc(layerLabel(artifact, layer))}</a>`
    return (
      `<section class="point-step" id="${esc(id)}" aria-label="Attention point ${index + 1} of ${steps.length}">` +
      `<p class="step-h"><span class="step-n">Point ${index + 1} of ${steps.length}</span>${where}</p>` +
      `<ol class="findings">${pointCardHtml(point, ctx, { id: `${id}-card` })}</ol>` +
      `<div class="files">${code}</div>${stepNavHtml(steps, index, artifact)}</section>`
    )
  })
  return `<div class="point-steps" id="${POINT_STEPS_ID}" hidden>${stops.join('')}</div>`
}
