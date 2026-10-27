// @ts-check
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { toFileEntry } from '../../src/git/diff-collector.js'
import { emptyState } from '../../src/contract/state.js'
import { SYNTHETIC_FILES, syntheticArtifact } from '../../src/testing/synthetic.js'
import { stepAnchorId } from './keys.js'
import { overviewWayOnHtml, POINT_STEPS_ID, renderPointSteps, viewSwitchTarget } from './point-view.js'
import { pointSteps, stopsOf } from './point-steps.js'
import { pointCollapses } from './points.js'
import { hunkIdForPoint, renderLayers } from './layers.js'
import { placeStopCards, returnStopCards } from './one-layer.js'

const artifact = syntheticArtifact()
const files = SYNTHETIC_FILES.map(toFileEntry)
const state = emptyState('2026-10-21T10:00:00.000Z')

/** @param {string} html */
function draw(html) {
  document.body.innerHTML = html
  return document.body
}

/** @param {string} selector */
function all(selector) {
  return Array.from(document.querySelectorAll(selector))
}

describe('renderPointSteps', () => {
  it('opens each layer with a stop of its own, then its points, layer by layer', () => {
    const root = draw(renderPointSteps(artifact, files, state))
    expect(root.querySelector(`#${POINT_STEPS_ID}`)).not.toBeNull()
    expect(all('section.point-step').map(section => section.id)).toEqual([
      'step-layer-run-path',
      'step-p-1',
      'step-layer-other',
      'step-p-2',
      'step-p-3',
    ])
    expect(all('.step-n').map(el => el.textContent)).toEqual(['Point 1 of 3', 'Point 2 of 3', 'Point 3 of 3'])
  })

  it('shows a layer’s heading, description and tests in its opening stop', () => {
    draw(renderPointSteps(artifact, files, state))
    const stop = document.querySelector('#step-layer-run-path')
    expect(stop?.querySelector('h2')?.textContent).toBe('Layer 1 of 1Run path')
    expect(stop?.querySelector('input[data-reviewed-id="layer:run-path"]')).not.toBeNull()
    expect(stop?.querySelector('.rationale')?.textContent).toContain('The change to')
    expect(stop?.querySelectorAll('table.testmap tbody tr').length).toBeGreaterThan(0)
    // Other has no position among the layers and nothing to mark reviewed.
    expect(document.querySelector('#step-layer-other h2')?.textContent).toBe('Other changes')
    expect(document.querySelector('#step-layer-other input[data-reviewed-id]')).toBeNull()
  })

  it('names the layer each point belongs to, as a link to the layer’s opening stop', () => {
    draw(renderPointSteps(artifact, files, state))
    const link = document.querySelector('#step-p-1 .step-h a')
    expect(link?.textContent).toBe('Layer 1 · Run path')
    expect(link?.getAttribute('href')).toBe('#step-layer-run-path')
  })

  it('draws no copy of a point’s card or file: slots, and what goes in them', () => {
    draw(renderPointSteps(artifact, files, state))
    const stop = document.querySelector('#step-p-1')
    expect(stop?.querySelector('li.finding, article.file')).toBeNull()
    expect(stop?.querySelector(':scope > [data-slot="card"]')).not.toBeNull()
    expect(stop?.querySelector(':scope > [data-slot="file"]')).not.toBeNull()
    const point = artifact.points.find(p => p.id === 'p-1')
    const entry = files.find(f => f.path === point?.path)
    if (point === undefined || entry === undefined) throw new Error('fixture changed')
    expect(
      ['data-stop-point', 'data-stop-fingerprint', 'data-stop-path', 'data-stop-layer', 'data-stop-hunk'].map(
        name => stop?.getAttribute(name)
      )
    ).toEqual(['p-1', 'fp-1', 'src/app.ts', 'run-path', hunkIdForPoint(point, entry)])
  })

  it('draws the only card of a point the layers list no card for, under the point’s own anchor', () => {
    draw(renderPointSteps(artifact, files, state))
    // The Other layer lists no point cards; its points’ cards are their stops’.
    expect(document.querySelector('#step-p-2 [data-slot="card"] li.finding')?.id).toBe('point-p-2')
  })

  it('leads from each stop to the one before and after, and from the last to the layers', () => {
    draw(renderPointSteps(artifact, files, state))
    const links = (/** @type {string} */ id) =>
      all(`#${id} .step-nav a`).map(a => [a.textContent, a.getAttribute('href')])
    expect(links('step-layer-run-path')).toEqual([
      ['← overview', '#overview'],
      ['go to its 1 attention point →', '#step-p-1'],
    ])
    expect(links(stepAnchorId('p-1'))).toEqual([
      ['← Run path', '#step-layer-run-path'],
      ['next layer: Other changes →', '#step-layer-other'],
    ])
    expect(links('step-layer-other')).toEqual([
      ['← previous point', '#step-p-1'],
      ['go to its 2 attention points →', '#step-p-2'],
    ])
    expect(links('step-p-2')).toEqual([
      ['← Other changes', '#step-layer-other'],
      ['next point →', '#step-p-3'],
    ])
    expect(links('step-p-3')).toEqual([
      ['← previous point', '#step-p-2'],
      ['the rest of the diff, by layer →', '#layer-run-path'],
    ])
    // The last link switches to the layers, so the rail lists every layer again.
    const rest = document.querySelector(`#${stepAnchorId('p-3')} .step-nav a[href="#layer-run-path"]`)
    expect([rest?.getAttribute('data-act'), rest?.getAttribute('data-view')]).toEqual([
      'layer-view',
      'layers',
    ])
  })

  it('keeps a point the reader acted on in its place, and draws nothing for a canvas without points', () => {
    const dismissed = { ...state, dismissed: { 'fp-2': { at: 'x' } } }
    draw(renderPointSteps(artifact, files, dismissed))
    expect(all('section.point-step').map(section => section.id)).toEqual([
      'step-layer-run-path',
      'step-p-1',
      'step-layer-other',
      'step-p-2',
      'step-p-3',
    ])
    expect(document.querySelector('#step-p-2 #point-p-2')?.classList.contains('is-handled')).toBe(true)
    expect(renderPointSteps({ ...artifact, points: [] }, files, state)).toBe('')
  })

  it('opens a layer with tests and no points, and skips one with neither', () => {
    const [runPath, other] = artifact.layers
    if (runPath === undefined || other === undefined) throw new Error('two layers')
    const testsOnly = { ...artifact, points: artifact.points.filter(p => p.layerId === other.id) }
    expect(stopsOf(testsOnly, pointSteps(testsOnly, testsOnly.points)).map(stop => stop.id)).toEqual([
      'step-layer-run-path',
      'step-layer-other',
      'step-p-2',
      'step-p-3',
    ])
    const bare = {
      ...testsOnly,
      layers: testsOnly.layers.map(layer => (layer.id === runPath.id ? { ...layer, tests: [] } : layer)),
    }
    expect(stopsOf(bare, pointSteps(bare, bare.points)).map(stop => stop.id)).toEqual([
      'step-layer-other',
      'step-p-2',
      'step-p-3',
    ])
  })
})

describe('overviewWayOnHtml', () => {
  it('leads from the overview to the first layer’s opening stop', () => {
    draw(overviewWayOnHtml(artifact))
    const link = document.querySelector('.step-nav a')
    expect(link?.textContent).toBe('start with Layer 1: Run path →')
    expect(link?.getAttribute('href')).toBe('#step-layer-run-path')
  })

  it('has nothing to lead to on a canvas without points', () => {
    expect(overviewWayOnHtml({ ...artifact, points: [] })).toBe('')
  })
})

describe('viewSwitchTarget', () => {
  it('opens the one-point view on the opening stop of the layer being read', () => {
    expect(viewSwitchTarget(artifact, 'points', '#layer-run-path')).toBe('#step-layer-run-path')
    expect(viewSwitchTarget(artifact, 'points', '#step-p-2')).toBe('#step-layer-other')
    expect(viewSwitchTarget(artifact, 'points', '#overview')).toBe('#overview')
    // Any other place starts the view from its first stop.
    expect(viewSwitchTarget(artifact, 'points', '#line:src/app.ts:4')).toBe('')
    expect(viewSwitchTarget(artifact, 'points', '')).toBe('')
  })

  it('opens the layers on the layer of the stop being read, and anywhere else where it was', () => {
    expect(viewSwitchTarget(artifact, 'all', '#step-layer-other')).toBe('#layer-other')
    expect(viewSwitchTarget(artifact, 'all', '#step-p-1')).toBe('#layer-run-path')
    expect(viewSwitchTarget(artifact, 'all', '#overview')).toBe('#overview')
    expect(viewSwitchTarget(artifact, 'all', '')).toBe('')
  })
})

describe('a stop on screen holds the layer’s own cards', () => {
  /** The layers, then the stops, as the page draws them in the one-point view. */
  function page() {
    return draw(
      `<main>${renderLayers(artifact, files, state)}${renderPointSteps(artifact, files, state)}</main>`
    )
  }

  it('moves the point’s card and its file card into the stop, open, and back to their places', () => {
    const root = page()
    const stop = document.querySelector('#step-p-1')
    if (!(stop instanceof HTMLElement)) throw new Error('no stop')
    const layerList = document.querySelector('#point-p-1')?.parentElement
    placeStopCards(root, stop)
    const card = document.querySelector('#point-p-1')
    const file = document.querySelector('article.file[data-layer="run-path"][data-path="src/app.ts"]')
    expect(card?.closest('[data-slot="card"]')).not.toBeNull()
    expect(file?.closest('[data-slot="file"]')).not.toBeNull()
    expect(all('#point-p-1')).toHaveLength(1)
    // Whole in the stop, whatever the list density; its file held open there.
    if (!(card instanceof HTMLElement)) throw new Error('no card')
    expect(pointCollapses(card)).toBe(false)
    expect(file?.hasAttribute('data-open')).toBe(true)
    expect(file?.querySelector('.file-body')?.hasAttribute('hidden')).toBe(false)
    // Only the point’s chunk and its own row show in the stop.
    const lens = document.querySelector('#stop-lens')?.textContent ?? ''
    expect(lens).toContain(`data-hunk="${stop.getAttribute('data-stop-hunk')}"`)
    expect(lens).toContain('data-fingerprint="fp-1"')

    returnStopCards(root)
    expect(document.querySelector('#point-p-1')?.parentElement).toBe(layerList)
    expect(file?.closest('pr-layer')).not.toBeNull()
    expect(file?.hasAttribute('data-open')).toBe(false)
    expect(all('[data-home], [data-away]')).toHaveLength(0)
    expect(document.querySelector('#stop-lens')?.textContent).toBe('')
  })
})
