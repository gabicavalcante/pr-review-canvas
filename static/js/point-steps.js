// @ts-check
// The order the one-point-at-a-time view walks the attention points in: layer by layer, as the
// canvas tells the change, and within a layer what most needs a decision first.
/** @typedef {import('./contract-types.js').Point} Point */
/** @typedef {import('./contract-types.js').ReviewArtifact} ReviewArtifact */
/** @typedef {ReviewArtifact['layers'][number]} Layer */

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
