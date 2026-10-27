// @ts-check
// Canvas links as navigation. The markdown, the diagrams and the chat all write links in the
// canvas scheme (#layer:, #file:, #hunk:, #line:), and the same string works as a URL fragment,
// so `…/review/278#line:path/to/file.ts:40` opens the page on that line and a click on a link
// leaves a URL the reader can share. The jump itself is `jumpTo` in anchors.js; this module
// decides when it runs. A link the reader follows on the page, in the one-point view, opens the
// stop that draws its line, or the layers when no stop does; the URL the page opens with, and back
// and forward, land in the layer.
import {
  drawCardsOf,
  jumpTo,
  keyFromPath,
  nearestRow,
  revealPreferringStop,
  rowPreferringStop,
  showsStops,
} from './anchors.js'
import { flash, scrollIntoViewSafe } from './dom.js'
import { layerAnchorId } from './keys.js'
import { parseLink } from './links.js'
import { markRailCurrent } from './scroll-spy.js'

/**
 * The fragment with its percent escapes resolved, for a browser that hands back an encoded hash.
 * A path holds `/`, `:` and `-`, which the parser reads raw, and a malformed escape is left as
 * written rather than throwing.
 * @param {string} hash
 * @returns {string}
 */
export function decodeHash(hash) {
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}

/**
 * Follows one canvas link: scrolls to its target and highlights it. A line whose row is folded
 * as noise or missing lands on the nearest row instead, marked `is-approx` the way the point and
 * thread rows are. Returns false when the link does not parse or has no target on the page.
 *
 * The string is tried as written first, so a path that holds a literal `%` keeps it, and then
 * with its escapes resolved, which is how the same link comes back out of the URL bar.
 * @param {string} href
 * @param {ParentNode} [root]
 * @param {{ preferStops?: boolean }} [opts] `preferStops` sends a line link to a stop that draws it
 * @returns {boolean}
 */
export function followLink(href, root = document, opts = {}) {
  if (jumpToTarget(href, root, opts.preferStops === true)) {
    return true
  }
  const decoded = decodeHash(href)
  return decoded !== href && jumpToTarget(decoded, root, opts.preferStops === true)
}

/**
 * Records an activated canvas link before scrolling, so Back restores the position being left.
 * Initial loads and history replay use followLink without adding an entry.
 * @param {string} href
 * @param {ParentNode} [root]
 * @param {Window} [view]
 */
export function navigateLink(href, root = document, view = window) {
  try {
    if (view.location.hash !== href) {
      view.history.pushState(null, '', href)
    }
  } catch {
    // A view without session history can still follow the link.
  }
  return followLink(href, root, { preferStops: true })
}

/**
 * @param {string} target
 * @param {ParentNode} root
 * @param {boolean} preferStops
 * @returns {boolean}
 */
function jumpToTarget(target, root, preferStops) {
  const link = parseLink(target)
  if (link === null) {
    return false
  }
  if (link.kind === 'line') {
    return (preferStops && jumpToLineInStop(root, link, target)) || jumpToLine(root, link)
  }
  if (!jumpTo(target, root, preferStops)) {
    return false
  }
  if (link.kind === 'layer') {
    markRailCurrent(root, layerAnchorId(link.layerKey))
  }
  return true
}

/**
 * The row of a line link, or the closest one when that line is folded away as noise or is not
 * among the rows on screen.
 * @param {ParentNode} root
 * @param {{ path: string, start: number, side: 'new' | 'old' }} link
 * @returns {boolean}
 */
function jumpToLine(root, link) {
  const key = keyFromPath(link.path)
  drawCardsOf(root, link.path)
  const near = nearestRow(root, key, link.side, link.start)
  if (near === null) {
    return false
  }
  if (near.approx) {
    near.row.classList.add('is-approx')
  }
  scrollIntoViewSafe(near.row)
  flash(near.row)
  return true
}

/**
 * In the one-point view, a line link the reader follows goes to the stop that draws the line, or
 * asks the page for its layers when no stop does. False outside that view, and for a line on no
 * row at all, which `jumpToLine` then lands near.
 * @param {ParentNode} root
 * @param {{ path: string, start: number, side: 'new' | 'old' }} link
 * @param {string} href
 * @returns {boolean}
 */
function jumpToLineInStop(root, link, href) {
  if (!showsStops(root)) {
    return false
  }
  drawCardsOf(root, link.path)
  const key = keyFromPath(link.path)
  const exact = rowPreferringStop(root, key, link.side, link.start)
  const near = nearestRow(root, key, link.side, link.start)
  const found =
    exact !== null && exact.stop !== null ? exact : near === null ? null : { row: near.row, stop: null }
  if (found === null) {
    return false
  }
  if (revealPreferringStop({ el: found.row, stop: found.stop }, root, { href })) {
    flash(found.row)
  }
  return true
}

/**
 * A plain left click the page is free to take over. A modified click is the reader asking the
 * browser for a new tab or window.
 * @param {MouseEvent} event
 */
export function plainClick(event) {
  return (
    !event.defaultPrevented &&
    (event.button === undefined || event.button === 0) &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

/**
 * The canvas link a plain click landed on, as the string to follow, or null for any other click.
 * @param {MouseEvent} event
 * @returns {string | null}
 */
export function clickedCanvasLink(event) {
  const el = event.target instanceof Element ? event.target.closest('a[data-link], a[href^="#"]') : null
  if (el === null || !plainClick(event)) {
    return null
  }
  const href = el.getAttribute('data-link') ?? el.getAttribute('href') ?? ''
  return parseLink(href) === null ? null : href
}

/**
 * Wires canvas links for one screen: clicks on the anchors the renderers wrote, the fragment the
 * page was opened with, and every later `hashchange`. `stop` removes all of it, so a re-render
 * never leaves two sets of listeners behind.
 * @param {HTMLElement | Document} root
 * @param {{ view?: Window, jumpOnInit?: boolean }} [opts]
 * @returns {{ stop: () => void, follow: (href: string) => boolean, followHash: () => boolean }}
 */
export function initDeepLinks(root, opts = {}) {
  const view = opts.view ?? window
  const listeners = new AbortController()

  const followHash = () => followLink(view.location.hash, root)

  root.addEventListener(
    'click',
    event => {
      const href = clickedCanvasLink(/** @type {MouseEvent} */ (event))
      if (href === null) {
        return
      }
      event.preventDefault()
      navigateLink(href, root, view)
    },
    { signal: listeners.signal }
  )

  view.addEventListener('hashchange', () => void followHash(), { signal: listeners.signal })
  if (opts.jumpOnInit !== false) {
    followHash()
  }

  return {
    stop: () => listeners.abort(),
    follow: href => followLink(href, root),
    followHash,
  }
}
