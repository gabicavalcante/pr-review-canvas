// @ts-check
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYER_VIEW, isLayerView, LAYER_VIEW_LABELS, LAYER_VIEWS } from './layer-views.js'
import { elementForHash, initOneLayer, pageSections, sectionOf, showOnly } from './one-layer.js'
import {
  pointPreferringStop,
  revealPreferringStop,
  rowPreferringStop,
  SHOW_IN_LAYERS,
  showsStops,
} from './anchors.js'

/** @type {HTMLElement} */
let root
/** @type {ReturnType<typeof initOneLayer> | undefined} */
let oneLayer

const PAGE = `
    <header class="hdr"><button id="settings">settings</button></header>
    <nav class="rail"><ul>
      <li><a href="#overview" aria-current="location">Overview</a></li>
      <li><a href="#layer-auth">Auth</a></li>
      <li><a href="#layer-storage">Storage</a></li>
      <li><a href="#layer-other">Other</a></li>
    </ul></nav>
    <main id="main">
      <div class="stale-bar outdated-bar">outdated</div>
      <section class="panel" id="overview"><a href="#line:src/auth.ts:4" data-link="#line:src/auth.ts:4">line 4</a></section>
      <pr-layer><section class="layer" id="layer-auth"><article class="file" id="file-src_auth_ts"><table><tr id="src_auth_ts-new-4"><td>row</td></tr></table></article></section></pr-layer>
      <pr-layer><section class="layer" id="layer-storage"><div class="more-hunks"><a href="#layer-auth">2 more chunks in layer 1</a></div></section></pr-layer>
      <pr-layer><section class="panel" id="layer-other"><details></details></section></pr-layer>
    </main>`

beforeEach(() => {
  root = document.createElement('pr-app')
  root.innerHTML = PAGE
  document.body.replaceChildren(root)
})

afterEach(() => {
  oneLayer?.stop()
  oneLayer = undefined
  window.location.hash = ''
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

/** @param {string} id */
const section = id => {
  const el = root.querySelector(`#${id}`)
  if (!(el instanceof HTMLElement)) {
    throw new Error(`no #${id}`)
  }
  return el
}

const shownIds = () =>
  pageSections(root)
    .filter(s => !s.hidden)
    .map(s => s.id)

/** @param {Element | null} el */
const click = el => el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

/** @param {Element | null} el */
const reveal = el => el?.dispatchEvent(new Event('reveal-code', { bubbles: true }))

describe('the layer views', () => {
  it('names the two layer views, all by default, each with a label; the points are a setting of their own', () => {
    expect(LAYER_VIEWS).toEqual(['all', 'one'])
    expect(DEFAULT_LAYER_VIEW).toBe('all')
    expect(isLayerView('one')).toBe(true)
    expect(isLayerView('points')).toBe(false)
    expect(isLayerView('some')).toBe(false)
    expect(isLayerView(1)).toBe(false)
    expect(Object.keys(LAYER_VIEW_LABELS)).toEqual(['all', 'one'])
  })
})

describe('the sections of the page', () => {
  it('lists the overview and every layer in page order', () => {
    expect(pageSections(root).map(s => s.id)).toEqual([
      'overview',
      'layer-auth',
      'layer-storage',
      'layer-other',
    ])
  })

  it('finds the section that holds an element, and none for the header', () => {
    expect(sectionOf(root, root.querySelector('#src_auth_ts-new-4'))?.id).toBe('layer-auth')
    expect(sectionOf(root, section('layer-other'))?.id).toBe('layer-other')
    expect(sectionOf(root, root.querySelector('#settings'))).toBeNull()
    expect(sectionOf(root, null)).toBeNull()
    // An element of another tree is not on this page.
    const stray = document.createElement('section')
    stray.id = 'overview'
    document.body.appendChild(stray)
    expect(sectionOf(root, stray)).toBeNull()
  })

  it('shows one section and hides the rest', () => {
    showOnly(root, section('layer-storage'))
    expect(shownIds()).toEqual(['layer-storage'])
  })

  it('resolves a plain fragment to its element and leaves canvas links to the deep links', () => {
    expect(elementForHash(root, '#layer-auth')?.id).toBe('layer-auth')
    expect(elementForHash(root, 'overview')?.id).toBe('overview')
    expect(elementForHash(root, '#layer%2Dauth')?.id).toBe('layer-auth')
    expect(elementForHash(root, '#file:src/auth.ts')).toBeNull()
    expect(elementForHash(root, '#')).toBeNull()
    expect(elementForHash(root, '#nope')).toBeNull()
  })
})

describe('initOneLayer', () => {
  it('leaves every section on the page in the all view', () => {
    oneLayer = initOneLayer(root, { view: 'all' })
    expect(shownIds()).toHaveLength(4)
    // A target inside a layer changes nothing here.
    reveal(section('layer-auth'))
    expect(shownIds()).toHaveLength(4)
  })

  it('opens on the overview alone in the one view, and leaves the bar above the canvas', () => {
    oneLayer = initOneLayer(root, { view: 'one' })
    expect(shownIds()).toEqual(['overview'])
    expect(root.querySelector('.stale-bar')?.hasAttribute('hidden')).toBe(false)
  })

  it('opens on the layer the URL names', () => {
    window.location.hash = '#layer-storage'
    oneLayer = initOneLayer(root, { view: 'one' })
    expect(shownIds()).toEqual(['layer-storage'])
  })

  it('shows the layer that holds whatever is scrolled to', () => {
    oneLayer = initOneLayer(root, { view: 'one' })
    reveal(root.querySelector('#src_auth_ts-new-4'))
    expect(shownIds()).toEqual(['layer-auth'])
    // The overview again, the way `g o` gets there.
    reveal(section('overview'))
    expect(shownIds()).toEqual(['overview'])
    // A target outside every section, such as the chat pane, changes nothing.
    reveal(root.querySelector('#settings'))
    expect(shownIds()).toEqual(['overview'])
  })

  it('shows the layer a rail link or a "more chunks" link points at before the browser scrolls', () => {
    oneLayer = initOneLayer(root, { view: 'one' })
    click(root.querySelector('nav.rail a[href="#layer-storage"]'))
    expect(shownIds()).toEqual(['layer-storage'])
    click(root.querySelector('.more-hunks a'))
    expect(shownIds()).toEqual(['layer-auth'])
  })

  it('leaves a modified click, and one on no link, alone', () => {
    oneLayer = initOneLayer(root, { view: 'one' })
    root
      .querySelector('nav.rail a[href="#layer-storage"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
    expect(shownIds()).toEqual(['overview'])
    click(root.querySelector('#settings'))
    expect(shownIds()).toEqual(['overview'])
  })

  it('follows a hash change to a hidden layer and scrolls to it, since the browser could not', () => {
    oneLayer = initOneLayer(root, { view: 'one' })
    const scrolled = vi.fn()
    section('layer-other').scrollIntoView = scrolled
    window.location.hash = '#layer-other'
    window.dispatchEvent(new Event('hashchange'))
    expect(shownIds()).toEqual(['layer-other'])
    expect(scrolled).toHaveBeenCalledWith({ block: 'start' })
    // A hash change to the section already showing does nothing more.
    window.dispatchEvent(new Event('hashchange'))
    expect(scrolled).toHaveBeenCalledTimes(1)
    window.location.hash = ''
    window.dispatchEvent(new Event('hashchange'))
    expect(shownIds()).toEqual(['overview'])
  })

  it('lands a stop’s fragment, which back can bring after a switch of view, on what stands for it', () => {
    section('layer-storage').insertAdjacentHTML('beforeend', '<li class="finding" id="point-p-9"></li>')
    window.location.hash = '#step-layer-storage'
    oneLayer = initOneLayer(root, { view: 'one' })
    expect(shownIds()).toEqual(['layer-storage'])
    window.location.hash = '#step-layer-auth'
    window.dispatchEvent(new Event('hashchange'))
    expect(shownIds()).toEqual(['layer-auth'])
    // A point's stop lands on the point's card, in its layer.
    window.location.hash = '#step-p-9'
    window.dispatchEvent(new Event('hashchange'))
    expect(shownIds()).toEqual(['layer-storage'])
    // A point of the Other layer has no card: its row in the diff stands for it.
    section('layer-other').insertAdjacentHTML(
      'beforeend',
      '<table><tr data-point="p-8"><td></td></tr></table>'
    )
    window.location.hash = '#step-p-8'
    window.dispatchEvent(new Event('hashchange'))
    expect(shownIds()).toEqual(['layer-other'])
  })

  it('switches views on the open page, keeping the section the rail marks as being read', () => {
    oneLayer = initOneLayer(root, { view: 'one' })
    // The URL still names where the reader was sent, not where they scrolled to since.
    window.location.hash = '#overview'
    oneLayer.setView('all')
    expect(shownIds()).toHaveLength(4)
    root.querySelector('nav.rail a[aria-current]')?.removeAttribute('aria-current')
    root.querySelector('nav.rail a[href="#layer-storage"]')?.setAttribute('aria-current', 'location')
    oneLayer.setView('one')
    expect(shownIds()).toEqual(['layer-storage'])
    // Setting the view it already has changes nothing.
    oneLayer.setView('one')
    expect(shownIds()).toEqual(['layer-storage'])
    // With no section marked, the URL names one.
    oneLayer.setView('all')
    root.querySelector('nav.rail a[aria-current]')?.removeAttribute('aria-current')
    oneLayer.setView('one')
    expect(shownIds()).toEqual(['overview'])
  })

  it('keeps the section on screen when the page is redrawn, whatever the URL says', () => {
    window.location.hash = '#layer-storage'
    oneLayer = initOneLayer(root, { view: 'one' })
    expect(shownIds()).toEqual(['layer-storage'])
    // Revealing code moves on to another layer without writing the URL.
    reveal(root.querySelector('#src_auth_ts-new-4'))
    root.innerHTML = PAGE
    expect(shownIds()).toHaveLength(4)
    oneLayer.redraw()
    expect(shownIds()).toEqual(['layer-auth'])
    // The listeners are on the element, so the new content is served by the same ones.
    reveal(root.querySelector('#src_auth_ts-new-4'))
    expect(shownIds()).toEqual(['layer-auth'])
  })

  it('stops listening when told to', () => {
    oneLayer = initOneLayer(root, { view: 'one' })
    oneLayer.stop()
    reveal(section('layer-auth'))
    expect(shownIds()).toEqual(['overview'])
  })

  it('does nothing on a screen without sections', () => {
    root.innerHTML = '<main id="main"><div class="empty">no canvas</div></main>'
    oneLayer = initOneLayer(root, { view: 'one' })
    oneLayer.redraw()
    expect(pageSections(root)).toEqual([])
  })
})

describe('the one-point view', () => {
  const STOPS = `
    <div class="point-steps" id="point-steps">
      <section class="point-step" id="step-p-1"><li class="finding" id="step-p-1-card"></li><nav class="step-nav"><a href="#step-p-2">next point</a></nav></section>
      <section class="point-step" id="step-p-2"><nav class="step-nav"><a href="#layer-auth">the rest of the diff</a></nav></section>
    </div>`

  beforeEach(() => {
    section('overview').insertAdjacentHTML('afterend', STOPS)
  })

  it('opens on the first point alone', () => {
    oneLayer = initOneLayer(root, { view: 'points' })
    expect(shownIds()).toEqual(['step-p-1'])
  })

  it('opens on the point the URL names', () => {
    window.location.hash = '#step-p-2'
    oneLayer = initOneLayer(root, { view: 'points' })
    expect(shownIds()).toEqual(['step-p-2'])
  })

  it('moves from point to point and on to the layers with the stops’ links', () => {
    oneLayer = initOneLayer(root, { view: 'points' })
    click(root.querySelector('#step-p-1 .step-nav a'))
    expect(shownIds()).toEqual(['step-p-2'])
    click(root.querySelector('#step-p-2 .step-nav a'))
    expect(shownIds()).toEqual(['layer-auth'])
  })

  it('still shows a layer that holds whatever is scrolled to, and the overview', () => {
    oneLayer = initOneLayer(root, { view: 'points' })
    reveal(root.querySelector('#src_auth_ts-new-4'))
    expect(shownIds()).toEqual(['layer-auth'])
    reveal(section('overview'))
    expect(shownIds()).toEqual(['overview'])
  })

  it('swaps a section in under a page that stays at the top, and records it in the URL', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    oneLayer = initOneLayer(root, { view: 'points' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    root.querySelector('#step-p-1 .step-nav a')?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(shownIds()).toEqual(['step-p-2'])
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
    expect(window.location.hash).toBe('#step-p-2')
    // Back and forward land in place too.
    window.location.hash = '#step-p-1'
    window.dispatchEvent(new Event('hashchange'))
    expect(shownIds()).toEqual(['step-p-1'])
    expect(scrollTo).toHaveBeenCalledTimes(2)
  })

  it('leaves the one-layer view and the all view to the browser’s own scroll', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    oneLayer = initOneLayer(root, { view: 'one' })
    const inOne = new MouseEvent('click', { bubbles: true, cancelable: true })
    root.querySelector('nav.rail a[href="#layer-storage"]')?.dispatchEvent(inOne)
    expect(inOne.defaultPrevented).toBe(false)
    expect(shownIds()).toEqual(['layer-storage'])
    oneLayer.setView('all')
    const inAll = new MouseEvent('click', { bubbles: true, cancelable: true })
    root.querySelector('nav.rail a[href="#layer-auth"]')?.dispatchEvent(inAll)
    expect(inAll.defaultPrevented).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('starts where the URL says, or at its first stop, when switched to from another view', () => {
    oneLayer = initOneLayer(root, { view: 'all' })
    root.querySelector('nav.rail a[href="#layer-auth"]')?.setAttribute('aria-current', 'location')
    window.location.hash = '#step-p-2'
    oneLayer.setView('points')
    expect(shownIds()).toEqual(['step-p-2'])
    oneLayer.setView('all')
    window.location.hash = ''
    oneLayer.setView('points')
    expect(shownIds()).toEqual(['step-p-1'])
  })

  it('leaves the one-point view for one layer at a time on the layer the URL names, not the rail’s mark', () => {
    oneLayer = initOneLayer(root, { view: 'points' })
    root.querySelector('nav.rail a[href="#layer-auth"]')?.setAttribute('aria-current', 'location')
    window.location.hash = '#layer-storage'
    oneLayer.setView('one')
    expect(shownIds()).toEqual(['layer-storage'])
  })

  it('goes to the layer view the settings choose, which the dialog can change', () => {
    oneLayer = initOneLayer(root, { view: 'points', layersView: 'one' })
    expect(oneLayer.layersView).toBe('one')
    oneLayer.setLayersView('all')
    expect(oneLayer.layersView).toBe('all')
    // Moving to a view leaves the settings' choice as it is.
    oneLayer.setView('one')
    oneLayer.setView('points')
    expect(oneLayer.layersView).toBe('all')
  })

  it('opens a layer’s section the URL names on the layer’s opening stop, or the first stop', () => {
    section('overview').insertAdjacentHTML(
      'afterend',
      '<section class="point-step layer-step" id="step-layer-auth"></section>'
    )
    window.location.hash = '#layer-auth'
    oneLayer = initOneLayer(root, { view: 'points' })
    expect(shownIds()).toEqual(['step-layer-auth'])
    oneLayer.stop()
    // A layer with no opening stop, one with neither points nor tests.
    window.location.hash = '#layer-storage'
    oneLayer = initOneLayer(root, { view: 'points' })
    expect(shownIds()).toEqual(['step-layer-auth'])
  })

  it('names the reader’s place, which the URL does not when a view opens on its first section', () => {
    oneLayer = initOneLayer(root, { view: 'points' })
    expect(window.location.hash).toBe('')
    expect(oneLayer.place()).toBe('#step-p-1')
    click(root.querySelector('#step-p-1 .step-nav a'))
    expect(oneLayer.place()).toBe('#step-p-2')
    // While every section shows, none is on screen alone.
    oneLayer.setView('all')
    expect(oneLayer.place()).toBe('')
  })
})

describe('finding a line or a point, and the stop that shows it', () => {
  /** A layer whose file has two chunks, and two stops on its first chunk; each row is on the page once. */
  const STOPS_PAGE = `
    <pr-layer><section class="layer" id="layer-run">
      <ol><li class="finding" id="point-p-1" data-point="p-1" data-fingerprint="fp-1"></li></ol>
      <pr-file><article class="file" data-layer="run" data-path="a.ts"><div class="file-body">
        <table class="diff" data-key="a_ts" data-hunk="a_ts#1"><tbody><tr id="L-a_ts-new-4"><td class="ln"></td></tr></tbody></table>
        <table class="diff" data-key="a_ts" data-hunk="a_ts#2"><tbody><tr id="L-a_ts-new-9"><td class="ln"></td></tr></tbody></table>
      </div></article></pr-file>
    </section></pr-layer>
    <section class="point-step" id="step-p-1" hidden data-stop-point="p-1" data-stop-fingerprint="fp-1" data-stop-path="a.ts" data-stop-layer="run" data-stop-hunk="a_ts#1">
      <ol data-slot="card"></ol><div data-slot="file"></div>
    </section>
    <section class="point-step" id="step-p-2" hidden data-stop-point="p-2" data-stop-fingerprint="fp-2" data-stop-path="a.ts" data-stop-layer="run" data-stop-hunk="a_ts#1">
      <ol data-slot="card"></ol><div data-slot="file"></div>
    </section>`

  beforeEach(() => {
    root.innerHTML = STOPS_PAGE
  })

  it('finds a line’s one row, and the stop that shows its chunk, the point’s own first', () => {
    const found = rowPreferringStop(root, 'a_ts', 'new', 4)
    expect(found?.row.closest('pr-layer')).not.toBeNull()
    expect(found?.stop?.id).toBe('step-p-1')
    expect(rowPreferringStop(root, 'a_ts', 'new', 4, section('step-p-2'))?.stop?.id).toBe('step-p-2')
    // The file’s other chunk is in no stop.
    expect(rowPreferringStop(root, 'a_ts', 'new', 9)?.stop).toBeNull()
    expect(rowPreferringStop(root, 'a_ts', 'new', 99)).toBeNull()
  })

  it('finds a point’s one card, and its stop', () => {
    expect(pointPreferringStop(root, 'fp-1')?.el.id).toBe('point-p-1')
    expect(pointPreferringStop(root, 'fp-1')?.stop?.id).toBe('step-p-1')
    root.querySelector('#step-p-1')?.remove()
    expect(pointPreferringStop(root, 'fp-1')?.stop).toBeNull()
  })

  it('shows a target’s stop, which brings the target into it, and asks for the layers for one in no stop', () => {
    /** @type {unknown[]} */
    const asked = []
    root.addEventListener(SHOW_IN_LAYERS, event => asked.push(/** @type {CustomEvent} */ (event).detail))
    oneLayer = initOneLayer(root, { view: 'points' })
    const inStop = rowPreferringStop(root, 'a_ts', 'new', 4)
    if (inStop === null) throw new Error('no row')
    expect(revealPreferringStop({ el: inStop.row, stop: inStop.stop }, root, { href: '#line:a.ts:4' })).toBe(
      true
    )
    expect(section('step-p-1').hidden).toBe(false)
    expect(inStop.row.closest('#step-p-1')).not.toBeNull()
    const inLayer = rowPreferringStop(root, 'a_ts', 'new', 9)
    if (inLayer === null) throw new Error('no row')
    expect(revealPreferringStop({ el: inLayer.row, stop: null }, root, { href: '#line:a.ts:9' })).toBe(false)
    expect(asked).toEqual([{ href: '#line:a.ts:9' }])
    // With no stop on the page, the layer is where the target shows.
    oneLayer.returnCards()
    root.querySelectorAll('section.point-step').forEach(stop => stop.remove())
    expect(showsStops(root)).toBe(false)
    expect(revealPreferringStop({ el: inLayer.row, stop: null }, root, { href: '#line:a.ts:9' })).toBe(true)
    expect(asked).toHaveLength(1)
  })
})
