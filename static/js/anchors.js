// @ts-check
// Ids and lookups for diff rows. The id builders live in keys.js (shared with the server);
// this module adds the DOM side: finding a row, the nearest visible row, and jumping to a link.
import { flash, scrollIntoViewSafe } from './dom.js'
import { buildLineId, fileAnchorId, layerStepAnchorId, sanitizeKey } from './keys.js'
import { linkTargetId, parseLink } from './links.js'

export {
  buildLineId,
  fileAnchorId,
  hunkAnchorId,
  hunkId,
  layerAnchorId,
  parseHunkId,
  parseLineId,
  pointAnchorId,
  sanitizeKey,
} from './keys.js'

/** @param {string} path */
export function keyFromPath(path) {
  return sanitizeKey(path)
}

/**
 * The row for a line, searched inside `root` (a file card or the document).
 * @param {ParentNode} root
 * @param {string} key
 * @param {'new' | 'old'} side
 * @param {number} line
 * @returns {HTMLTableRowElement | null}
 */
export function findRow(root, key, side, line) {
  const el = root.querySelector(`#${cssEscape(buildLineId(key, side, line))}`)
  if (el instanceof HTMLTableRowElement) {
    return el
  }
  if (side === 'old') {
    // Context rows carry the new-side id and the old line as data; deleted rows have the old-side id.
    const ctx = root.querySelector(`table[data-key="${cssEscape(key)}"] tr[data-old="${line}"]`)
    if (ctx instanceof HTMLTableRowElement) {
      return ctx
    }
  }
  return null
}

/**
 * The one-point view's stops. A stop draws no code of its own: the layer's card for its point's
 * file moves into it while it shows, so every row and point is on the page once.
 */
const STOP_SELECTOR = 'section.point-step'

/**
 * The event a target the stops do not draw sends up to the page, in the one-point view: the page
 * moves to its layers and follows `href` there, then opens a composer on `compose` when it is given.
 */
export const SHOW_IN_LAYERS = 'show-in-layers'

/**
 * The event a target in a card a stop holds sends up to the page, for a link the URL names: the
 * stop gives its cards back to their layers, so the target lands in its layer, as every URL does.
 */
export const RETURN_STOP_CARDS = 'return-stop-cards'

/**
 * Sends the card that holds `el` back to its layer when a stop of the one-point view holds it.
 * @param {Element} el
 */
export function bringHome(el) {
  if (el.closest('[data-away]') !== null) {
    el.dispatchEvent(new Event(RETURN_STOP_CARDS, { bubbles: true }))
  }
}

/**
 * @typedef {{ path: string, side: 'new' | 'old', line: number, startLine?: number, body?: string, proposalFingerprint?: string, pointFingerprint?: string }} ComposeRequest
 * @typedef {{ href: string, compose?: ComposeRequest }} ShowInLayers
 */

/**
 * Whether the page shows the one-point view, the only one that draws stops.
 * @param {ParentNode} root
 */
export function showsStops(root) {
  return root.querySelector(STOP_SELECTOR) !== null
}

/**
 * The stop of the one-point view that shows `el`, a line's row, a chunk, or a file card: the stop
 * of a point on that chunk of that file card (on any of its chunks, for the card itself), the one
 * on screen when it is one of them. Null for something no stop shows.
 * @param {ParentNode} root
 * @param {Element} el
 * @param {HTMLElement | null} [prefer] a stop to take when it shows `el`, such as its point's own
 * @returns {HTMLElement | null}
 */
function stopShowing(root, el, prefer = null) {
  const card = el.closest('article.file')
  const layer = card?.getAttribute('data-layer') ?? null
  const path = card?.getAttribute('data-path') ?? null
  if (layer === null || path === null) {
    return null
  }
  const hunk = el.closest('table.diff')?.getAttribute('data-hunk') ?? null
  const showing =
    `${STOP_SELECTOR}[data-stop-layer="${cssEscape(layer)}"][data-stop-path="${cssEscape(path)}"]` +
    (hunk === null ? '' : `[data-stop-hunk="${cssEscape(hunk)}"]`)
  if (prefer?.matches(showing) === true) {
    return prefer
  }
  const stop = root.querySelector(`${showing}:not([hidden])`) ?? root.querySelector(showing)
  return stop instanceof HTMLElement ? stop : null
}

/**
 * A line's row, and the stop of the one-point view that shows it, or null for a row in a layer
 * only. The row is the page's one row for that line, wherever its card is now. Of two stops on the
 * same chunk, `prefer` is taken when it is one of them, such as the stop of the point at hand.
 * @param {ParentNode} root
 * @param {string} key
 * @param {'new' | 'old'} side
 * @param {number} line
 * @param {HTMLElement | null} [prefer]
 * @returns {{ row: HTMLTableRowElement, stop: HTMLElement | null } | null}
 */
export function rowPreferringStop(root, key, side, line, prefer = null) {
  const row = findRow(root, key, side, line)
  return row === null ? null : { row, stop: stopShowing(root, row, prefer) }
}

/**
 * An attention point, and the stop of the one-point view that shows it: its card, or its row in
 * the diff for a point of a layer with no list.
 * @param {ParentNode} root
 * @param {string} fingerprint
 * @returns {{ el: HTMLElement, stop: HTMLElement | null } | null}
 */
export function pointPreferringStop(root, fingerprint) {
  const fp = cssEscape(fingerprint)
  const el =
    root.querySelector(`li.finding[data-fingerprint="${fp}"]`) ??
    root.querySelector(`[data-point][data-fingerprint="${fp}"]`)
  const stop = root.querySelector(`${STOP_SELECTOR}[data-stop-fingerprint="${fp}"]`)
  return el instanceof HTMLElement ? { el, stop: stop instanceof HTMLElement ? stop : null } : null
}

/**
 * Leads the reader to a target the lookups above found. In the one-point view the target's stop
 * comes on screen first, which brings the target into it; a target no stop shows asks the page for
 * its layers, with `request` saying where to go there, and nothing scrolls now. In the other views
 * the target's layer shows around it.
 * @param {{ el: HTMLElement, stop: HTMLElement | null }} found
 * @param {ParentNode} root
 * @param {ShowInLayers} request
 * @param {ScrollLogicalPosition} [block]
 * @returns {boolean} true when the target is on screen now
 */
export function revealPreferringStop(found, root, request, block = 'center') {
  if (showsStops(root)) {
    if (found.stop === null) {
      found.el.dispatchEvent(new CustomEvent(SHOW_IN_LAYERS, { bubbles: true, detail: request }))
      return false
    }
    // Showing the stop moves the layer's card, and the target with it, into the stop.
    found.stop.dispatchEvent(new Event('reveal-code', { bubbles: true }))
  }
  scrollIntoViewSafe(found.el, block)
  return true
}

/**
 * The closest visible row at or before `line` on `side`, for anchors that fall on a folded-away
 * line or in a gap between rows. Null when the table has no earlier row.
 * @param {ParentNode} root
 * @param {string} key
 * @param {'new' | 'old'} side
 * @param {number} line
 * @param {number} [maxDistance]
 * @returns {{ row: HTMLTableRowElement, approx: boolean } | null}
 */
export function nearestRow(root, key, side, line, maxDistance = 40) {
  for (let d = 0; d <= maxDistance; d++) {
    for (const candidate of d === 0 ? [line] : [line - d, line + d]) {
      if (candidate < 1) {
        continue
      }
      const row = findRow(root, key, side, candidate)
      if (row && isRowVisible(row)) {
        return { row, approx: d !== 0 }
      }
    }
  }
  return null
}

/**
 * Can an anchor land on this row? A row the diff folded away (noise, or a block that only moved)
 * is skipped, so the anchor lands nearby and reads `near line`. A row inside a canvas code fold
 * carries `data-code-fold` and stays reachable: that fold opens when the anchor reveals it.
 * @param {HTMLTableRowElement} row
 * @returns {boolean}
 */
function isRowVisible(row) {
  if (row.hasAttribute('data-code-fold')) {
    return true
  }
  return !row.classList.contains('folded') || row.classList.contains('shown')
}

/**
 * Scrolls to the element a canvas link points at and highlights it. Returns false when the
 * link does not parse or its target is not on the page. `preferStops`, for a link the reader
 * follows: in the one-point view, the stop that shows the target comes on screen with it.
 * @param {string} href
 * @param {ParentNode} [root]
 * @param {boolean} [preferStops]
 * @returns {boolean}
 */
export function jumpTo(href, root = document, preferStops = false) {
  const link = parseLink(href)
  if (!link) {
    return false
  }
  const id = linkTargetId(link, keyFromPath)
  if (link.kind === 'hunk' || link.kind === 'line') {
    drawCardsOf(root, link.path)
  } else if (link.kind === 'file') {
    drawCardOf(root, link.path)
  }
  const el = root.querySelector(`#${cssEscape(id)}`)
  if (!(el instanceof HTMLElement)) {
    return false
  }
  const block = link.kind === 'file' || link.kind === 'layer' ? 'start' : 'center'
  // In the one-point view a layer opens on its opening stop, and a chunk or a file on the stop that
  // shows it; with no stop showing it, the page is asked for its layers.
  if (preferStops && showsStops(root)) {
    const opening =
      link.kind === 'layer' ? root.querySelector(`#${cssEscape(layerStepAnchorId(link.layerKey))}`) : null
    const found =
      opening instanceof HTMLElement ? { el: opening, stop: opening } : { el, stop: stopShowing(root, el) }
    if (revealPreferringStop(found, root, { href }, block)) {
      flash(found.el)
    }
    return true
  }
  bringHome(el)
  scrollIntoViewSafe(el, block)
  flash(el)
  return true
}

/**
 * A file's card, which is on the page whether or not its diff is drawn yet.
 * @param {ParentNode} root
 * @param {string} path
 * @param {string} [layerId] the layer whose card of the file to find; the file's first card otherwise
 * @returns {Element | null}
 */
export function fileCardOf(root, path, layerId) {
  return layerId === undefined
    ? root.querySelector(`#${cssEscape(fileAnchorId(keyFromPath(path)))}`)
    : root.querySelector(`article.file[data-layer="${cssEscape(layerId)}"][data-path="${cssEscape(path)}"]`)
}

/**
 * Draws the diff of a file card that is waiting to be seen, so a link into it has a row to land
 * on. The card draws itself (`pr-file` in layers.js); this only asks it to do so now.
 * @param {ParentNode} root
 * @param {string} path
 * @param {string} [layerId] the layer whose card of the file to draw; the file's first card otherwise
 */
export function drawCardOf(root, path, layerId) {
  drawCard(fileCardOf(root, path, layerId))
}

/** Draw every layer's part of a file before looking up a line or hunk.
 * @param {ParentNode} root
 * @param {string} path
 */
export function drawCardsOf(root, path) {
  const selector = `#${cssEscape(fileAnchorId(keyFromPath(path)))}, article.file[data-path="${cssEscape(path)}"]`
  for (const card of root.querySelectorAll(selector)) {
    drawCard(card)
  }
}

/** @param {Element | null} element */
function drawCard(element) {
  const card = element?.closest('pr-file')
  const draw = /** @type {{ renderNow?: (force?: boolean) => boolean }} */ (card)?.renderNow
  if (typeof draw === 'function' && card !== null && card !== undefined) {
    // Force, so a card holding a huge patch behind `[ show diff ]` still has the row to land on.
    draw.call(card, true)
  }
}

/**
 * CSS.escape with a fallback for environments without it.
 * @param {string} id
 */
export function cssEscape(id) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id)
  }
  return id.replace(/([^a-zA-Z0-9_-])/g, '\\$1')
}
