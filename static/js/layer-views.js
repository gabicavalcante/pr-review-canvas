// @ts-check
// The values of the `layerView` setting. They live apart from the page code that acts on them,
// in `one-layer.js`, because the server validates the settings file against this list.

export const LAYER_VIEWS = /** @type {const} */ (['all', 'points'])
/** @typedef {(typeof LAYER_VIEWS)[number]} LayerView */

/** How the page shows layers when the settings file says nothing: the canvas as one page. */
export const DEFAULT_LAYER_VIEW = /** @type {LayerView} */ ('all')

/** What the settings dialog calls each view. */
export const LAYER_VIEW_LABELS = /** @type {Readonly<Record<LayerView, string>>} */ ({
  all: 'all at once',
  points: 'one point at a time',
})

/**
 * A view a settings file may still name from an earlier version: `one`, one layer at a time, which
 * the one-point view replaced. It shows one section at a time too, and on a canvas with no point it
 * is the same view.
 * @param {unknown} value
 */
export function currentLayerView(value) {
  return value === 'one' ? 'points' : value
}

/**
 * @param {unknown} value
 * @returns {value is LayerView}
 */
export function isLayerView(value) {
  return typeof value === 'string' && /** @type {readonly string[]} */ (LAYER_VIEWS).includes(value)
}
