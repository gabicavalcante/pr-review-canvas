// @ts-check
// Ids and lookups for diff rows. The id builders live in keys.js (shared with the server);
// this module adds the DOM side: finding a row, the nearest visible row, and jumping to a link.
import { flash, scrollIntoViewSafe } from './dom.js'
import { buildLineId, fileAnchorId, sanitizeKey } from './keys.js'
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

/** The one-point view's stops, each drawing a point's card and its file again, under the layers. */
const STOP_SELECTOR = 'section.point-step'

/**
 * The event a target the stops do not draw sends up to the page, in the one-point view: the page
 * moves to its layers and follows `href` there, then opens a composer on `compose` when it is given.
 */
export const SHOW_IN_LAYERS = 'show-in-layers'

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
 * A line's row where the reader looks for it: inside `scope` first, such as the stop or card an
 * action came from; else in the first stop of the one-point view that draws it; else on the page,
 * which is its layer, since the stops come after the layers and a lookup takes the first match.
 * `stop` is the stop that holds the row, or null for a row in a layer.
 * @param {ParentNode} root
 * @param {string} key
 * @param {'new' | 'old'} side
 * @param {number} line
 * @param {ParentNode | null} [scope]
 * @returns {{ row: HTMLTableRowElement, stop: HTMLElement | null } | null}
 */
export function rowPreferringStop(root, key, side, line, scope = null) {
  const scopes = [...(scope === null ? [] : [scope]), ...root.querySelectorAll(STOP_SELECTOR)]
  for (const place of scopes) {
    const row = findRow(place, key, side, line)
    if (row !== null && isRowVisible(row)) {
      return { row, stop: stopOf(row) }
    }
  }
  const row = findRow(root, key, side, line)
  return row === null ? null : { row, stop: stopOf(row) }
}

/**
 * An attention point where the reader looks for it: its card in its stop of the one-point view,
 * else its card in its layer, or its row in the diff for a point of a layer with no list.
 * @param {ParentNode} root
 * @param {string} fingerprint
 * @returns {{ el: HTMLElement, stop: HTMLElement | null } | null}
 */
export function pointPreferringStop(root, fingerprint) {
  const holder = `[data-point][data-fingerprint="${cssEscape(fingerprint)}"]`
  const el = root.querySelector(`${STOP_SELECTOR} ${holder}`) ?? root.querySelector(holder)
  return el instanceof HTMLElement ? { el, stop: stopOf(el) } : null
}

/** @param {Element} el */
function stopOf(el) {
  const stop = el.closest(STOP_SELECTOR)
  return stop instanceof HTMLElement ? stop : null
}

/**
 * Leads the reader to a target the lookups above found. The one-point view keeps its stops: a
 * target in one comes on screen in it, as the stop takes the place of the one shown. A target in
 * no stop asks the page for its layers, with `request` saying where to go there; nothing scrolls
 * now, since the page draws itself again. In the other views the target's layer shows around it.
 * @param {{ el: HTMLElement, stop: HTMLElement | null }} found
 * @param {ParentNode} root
 * @param {ShowInLayers} request
 * @param {ScrollLogicalPosition} [block]
 * @returns {boolean} true when the target is on screen now
 */
export function revealPreferringStop(found, root, request, block = 'center') {
  if (found.stop === null && showsStops(root)) {
    found.el.dispatchEvent(new CustomEvent(SHOW_IN_LAYERS, { bubbles: true, detail: request }))
    return false
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
 * link does not parse or its target is not on the page.
 * @param {string} href
 * @param {ParentNode} [root]
 * @returns {boolean}
 */
export function jumpTo(href, root = document) {
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
  scrollIntoViewSafe(el, link.kind === 'file' || link.kind === 'layer' ? 'start' : 'center')
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
