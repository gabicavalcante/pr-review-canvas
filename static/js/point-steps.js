// @ts-check
// The order the one-point-at-a-time view walks the attention points in: layer by layer, as the
// canvas tells the change, and within a layer what most needs a decision first.
/** @typedef {import('./contract-types.js').Point} Point */
/** @typedef {import('./contract-types.js').ReviewArtifact} ReviewArtifact */
/** @typedef {ReviewArtifact['layers'][number]} Layer */
import { layerStepAnchorId, stepAnchorId } from './keys.js'

/**
 * One stop of the view: a point, and the layer it belongs to. A point whose layer the canvas does
 * not list has none.
 * @typedef {{ point: Point, layer: Layer | null }} PointStep
 */

/**
 * The points, layer by layer in the canvas's order, each layer's in the order the canvas lists
 * them. The canvas already lists its points from the most severe (`sortPoints` in
 * `src/review/normalize.ts`), so each layer's come from the most severe too. Points of no listed
 * layer come last.
 * @param {ReviewArtifact} artifact
 * @param {ReadonlyArray<Point>} points the points to walk, such as the reader's open ones
 * @returns {PointStep[]}
 */
export function pointSteps(artifact, points) {
  const layerIds = new Set(artifact.layers.map(layer => layer.id))
  const steps = artifact.layers.flatMap(layer =>
    points.filter(p => p.layerId === layer.id).map(point => ({ point, layer }))
  )
  const unlayered = points
    .filter(p => p.layerId === undefined || !layerIds.has(p.layerId))
    .map(point => ({ point, layer: null }))
  return [...steps, ...unlayered]
}

/**
 * One stop of the view: a layer's opening, with the points that follow it, or a point, with its
 * number among all the points.
 * @typedef {{ kind: 'layer', id: string, layer: Layer, points: PointStep[] }
 *   | { kind: 'point', id: string, step: PointStep, number: number }} Stop
 */

/**
 * The stops in reading order: each layer that has points or tests opens with its stop, followed by
 * its points from the most severe. Points of no listed layer come last, with no opening.
 * @param {ReviewArtifact} artifact
 * @param {ReadonlyArray<PointStep>} steps
 * @returns {Stop[]}
 */
export function stopsOf(artifact, steps) {
  /** @type {Stop[]} */
  const stops = []
  let number = 0
  /** @param {PointStep} step */
  const pointStop = step => {
    number += 1
    stops.push({ kind: 'point', id: stepAnchorId(step.point.id), step, number })
  }
  for (const layer of artifact.layers) {
    const points = steps.filter(step => step.layer?.id === layer.id)
    if (points.length === 0 && layer.tests.length === 0) {
      continue
    }
    stops.push({ kind: 'layer', id: layerStepAnchorId(layer.key), layer, points })
    points.forEach(pointStop)
  }
  steps.filter(step => step.layer === null).forEach(pointStop)
  return stops
}
