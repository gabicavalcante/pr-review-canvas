import { expect, test } from './fixtures.js'

test('shows one layer at a time once the setting is saved, on this page and after a reload', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  const overview = page.locator('#overview')
  const layer = page.locator('#layer-run-path')
  const other = page.locator('#layer-other')
  await expect(overview).toBeVisible()
  await expect(layer).toBeVisible()

  // The save applies to the open page: the overview stays, the layers go.
  await page.locator('#settings').click()
  await page.locator('#set-layer-view').selectOption('one')
  await page.locator('[data-act="settings-save"]').click()
  await expect(page.locator('#settings-dialog')).toBeHidden()
  await expect(overview).toBeVisible()
  await expect(layer).toBeHidden()
  await expect(other).toBeHidden()

  // The rail moves between layers, and marks the one that shows.
  await page.locator('nav.rail a[href="#layer-run-path"]').click()
  await expect(layer).toBeVisible()
  await expect(overview).toBeHidden()
  await expect(page.locator('nav.rail a[href="#layer-run-path"]')).toHaveAttribute('aria-current', 'location')
  await expect(page.locator('nav.rail a[href="#overview"]')).not.toHaveAttribute('aria-current', 'location')

  // The choice is in settings.yml, and the URL names the layer, so a reload opens on it alone.
  await page.reload()
  await expect(layer).toBeVisible()
  await expect(overview).toBeHidden()
  await expect(other).toBeHidden()

  // With nothing in focus, j starts from the layer on screen, though it is too short to scroll.
  await page.keyboard.press('j')
  await expect(other).toBeVisible()
  await expect(page).toHaveURL(/#layer-other$/)
  await expect(other.locator('details > .body')).toBeVisible()
  await page.reload()
  await expect(other.locator('details > .body')).toBeVisible()
  // A refresh keeps the layer the reader moved to.
  await page.locator('#refresh').click()
  await expect(page.locator('#refresh')).toBeEnabled()
  await expect(other).toBeVisible()
  await expect(layer).toBeHidden()

  // The keys move too: g o to the overview, j to the first layer, j again to Other.
  await page.keyboard.press('g')
  await page.keyboard.press('o')
  await expect(overview).toBeVisible()
  await expect(layer).toBeHidden()
  await page.keyboard.press('j')
  await expect(layer).toBeVisible()
  await expect(overview).toBeHidden()
  await page.keyboard.press('j')
  await expect(other).toBeVisible()
  await expect(layer).toBeHidden()

  // After the rail moves away, j steps on from the layer that shows, not the card it left.
  await page.locator('nav.rail a[href="#overview"]').click()
  await expect(overview).toBeVisible()
  await page.keyboard.press('j')
  await expect(layer).toBeVisible()
  await expect(other).toBeHidden()

  // And k, from a reload onto the last layer.
  await page.locator('nav.rail a[href="#layer-other"]').click()
  await page.reload()
  await expect(other).toBeVisible()
  await page.keyboard.press('k')
  await expect(layer).toBeVisible()
  await expect(other).toBeHidden()

  await expect(page).toHaveURL(/#layer-run-path$/)
  await page.keyboard.press('k')
  await expect(overview).toBeVisible()
  await expect(page).toHaveURL(/#overview$/)
  await page.keyboard.press('j')
  await page.keyboard.press('Shift+r')
  await page.reload()
  await expect(layer.locator('.layer-body')).toBeVisible()

  // Back to all at once, and every section returns.
  await page.locator('#settings').click()
  await page.locator('#set-layer-view').selectOption('all')
  await page.locator('[data-act="settings-save"]').click()
  await expect(overview).toBeVisible()
  await expect(layer).toBeVisible()
  await expect(other).toBeVisible()
})

test('reads the canvas one attention point at a time once the setting is saved, on this page and after a reload', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  const overview = page.locator('#overview')
  const layer = page.locator('#layer-run-path')
  const opening = page.locator('#step-layer-run-path')
  const first = page.locator('#step-p-1')
  await expect(overview).toBeVisible()
  await expect(layer).toBeVisible()

  // The save draws the page again, opening on the first layer's opening stop alone.
  await page.locator('#settings').click()
  await page.locator('#set-layer-view').selectOption('points')
  await page.locator('[data-act="settings-save"]').click()
  await expect(page.locator('#settings-dialog')).toBeHidden()
  await expect(opening).toBeVisible()
  await expect(opening.locator('table.testmap')).toBeVisible()
  await expect(overview).toBeHidden()
  await expect(layer).toBeHidden()

  // The opening leads to the layer's points, each with only its chunk of code.
  await opening.locator('.step-nav a.step-on').click()
  await expect(first).toBeVisible()
  await expect(opening).toBeHidden()
  await expect(first.locator('table.diff')).toHaveCount(1)
  await expect(page).toHaveURL(/#step-p-1$/)

  // The rail lists the points under their layers; a stop takes the place of the one before, under a
  // page that stays at the top.
  await page.mouse.wheel(0, 600)
  await page.locator('nav.rail a[href="#step-p-2"]').click()
  await expect(page.locator('#step-p-2')).toBeVisible()
  await expect(first).toBeHidden()
  await expect(page.locator('nav.rail a[href="#step-p-2"]')).toHaveAttribute('aria-current', 'location')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  // The URL names the stop, so a reload opens on it alone.
  await page.reload()
  await expect(page.locator('#step-p-2')).toBeVisible()
  await expect(first).toBeHidden()

  // After the last point come the layers, for the rest of the diff: the link switches to them, so
  // the rail lists every layer, and the switch leads back to the points.
  await page.locator('#step-p-2 .step-nav a', { hasText: 'next point' }).click()
  await page.locator('#step-p-3 .step-nav a', { hasText: 'the rest of the diff' }).click()
  await expect(layer).toBeVisible()
  await expect(page.locator('section.point-step')).toHaveCount(0)
  await expect(page.locator('nav.rail .rail-view [data-view="layers"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.locator('nav.rail a[href="#layer-run-path"]')).toBeVisible()
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await expect(page.locator('section.point-step').first()).toBeAttached()

  // The rail's switch goes back to the layers: every section returns, the stops are gone, and the
  // rail lists the layers in place of the points.
  await expect(page.locator('nav.rail a[href="#layer-run-path"]')).toHaveCount(0)
  await page.locator('nav.rail .rail-view [data-view="layers"]').click()
  await expect(overview).toBeVisible()
  await expect(layer).toBeVisible()
  await expect(page.locator('#layer-other')).toBeVisible()
  await expect(page.locator('section.point-step')).toHaveCount(0)
  await expect(page.locator('nav.rail a[href="#layer-run-path"]')).toBeVisible()
  await expect(page.locator('nav.rail .rail-points')).toHaveCount(0)

  // It is saved as the setting is, so a reload keeps the layers; the switch leads back to the points,
  // from anywhere down the page, under a page at its top.
  await page.reload()
  await expect(page.locator('nav.rail .rail-view [data-view="layers"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await page.mouse.wheel(0, 1500)
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await expect(opening).toBeVisible()
  await expect(overview).toBeHidden()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('the one-point view keeps back and forward between stops, and a line link lands in its layer', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  await page.locator('#settings').click()
  await page.locator('#set-layer-view').selectOption('points')
  await page.locator('[data-act="settings-save"]').click()
  await page.locator('#step-layer-run-path .step-nav a.step-on').click()
  await page.locator('#step-p-1 .step-nav a', { hasText: 'next layer' }).click()
  await page.goBack()
  await expect(page.locator('#step-p-1')).toBeVisible()
  await expect(page.locator('#step-layer-other')).toBeHidden()
  await page.goForward()
  await expect(page.locator('#step-layer-other')).toBeVisible()
  await page.goto(reviewUrl + '#line:src/app.ts:4')
  await expect(page.locator('#layer-run-path')).toBeVisible()
  // A point's stop draws the line again; the link lands in the layer.
  await expect(page.locator('pr-layer #L-src_app_ts-new-4')).toBeInViewport()
})

test('the rail’s switch goes back to the layers in the layer view the reader read them in', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  await page.locator('#settings').click()
  await page.locator('#set-layer-view').selectOption('one')
  await page.locator('[data-act="settings-save"]').click()
  await expect(page.locator('#settings-dialog')).toBeHidden()
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await expect(page.locator('#step-layer-run-path')).toBeVisible()
  await page.locator('nav.rail .rail-view [data-view="layers"]').click()
  // One section at a time again, not every layer at once, on the layer of the stop that showed
  // though the URL never named it.
  await expect(page.locator('section.point-step')).toHaveCount(0)
  await expect(page.locator('#layer-run-path')).toBeVisible()
  await expect(page.locator('#overview')).toBeHidden()
})

test('a mark made in the points view stays on the page when the view switches', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await page.locator('nav.rail a[href="#step-p-1"]').click()
  const inStop = page.locator('#step-p-1 li.finding')
  const fingerprint = await inStop.getAttribute('data-fingerprint')
  await inStop.locator('[data-act="point-dismiss"]').click()
  await expect(page.locator('.toast')).toHaveText('attention point dismissed')
  // The page is drawn again for the layers, from the marks made since it loaded.
  await page.locator('nav.rail .rail-view [data-view="layers"]').click()
  await expect(page.locator('section.point-step')).toHaveCount(0)
  await expect(page.locator(`section.layer li.finding[data-fingerprint="${fingerprint}"]`)).toHaveAttribute(
    'data-status',
    'dismissed'
  )
})

test('the step keys walk the stops in the points view', async ({ page, reviewUrl }) => {
  await page.goto(reviewUrl)
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await expect(page.locator('#step-layer-run-path')).toBeVisible()
  const lands = async (key: string, id: string) => {
    await page.keyboard.press(key)
    await expect(page.locator(`#${id}`)).toBeVisible()
    await expect(page.locator('section.point-step:not([hidden])')).toHaveCount(1)
    await expect(page).toHaveURL(new RegExp(`#${id}$`))
  }
  // n and p take every stop; j and k the layers' openings; ] and [ the open points.
  await lands('n', 'step-p-1')
  await lands('j', 'step-layer-other')
  await lands(']', 'step-p-2')
  await lands('k', 'step-layer-other')
  await lands('k', 'step-layer-run-path')
  await lands(']', 'step-p-1')
  await lands('p', 'step-layer-run-path')
})

test('a switch whose save fails leaves the view and the URL as they were', async ({ page, reviewUrl }) => {
  // On a layer, so a URL written before the save would name its opening stop.
  await page.goto(`${reviewUrl}#layer-run-path`)
  await page.route('**/api/settings', route =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 400, json: { error: { code: 'BAD_REQUEST', message: 'settings rejected' } } })
      : route.continue()
  )
  const before = page.url()
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await expect(page.locator('.toast')).toContainText('could not switch the view')
  await expect(page.locator('nav.rail .rail-view [data-view="layers"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.locator('section.point-step')).toHaveCount(0)
  expect(page.url()).toBe(before)
})

test('back after a switch out of the points view lands on what stands for the stop', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await page.locator('nav.rail a[href="#step-p-1"]').click()
  await page.locator('#step-p-1 .step-nav a', { hasText: 'next layer' }).click()
  await expect(page.locator('#step-layer-other')).toBeVisible()
  // The switch takes the place of the stop it leaves in the history, not of the one before it.
  await page.locator('nav.rail .rail-view [data-view="layers"]').click()
  await expect(page.locator('section.point-step')).toHaveCount(0)
  // Back brings a stop's fragment, which the layers have no element for: its point's card shows.
  await page.goBack()
  await expect(page).toHaveURL(/#step-p-1$/)
  await expect(page.locator('#point-p-1')).toBeInViewport()
})

test('the rail’s switch goes back to one at a time after a reload in the points view', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  await page.locator('#settings').click()
  await page.locator('#set-layer-view').selectOption('one')
  await page.locator('[data-act="settings-save"]').click()
  await expect(page.locator('#settings-dialog')).toBeHidden()
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await expect(page.locator('section.point-step:not([hidden])')).toHaveCount(1)
  // The setting now says points; the page comes back from it.
  await page.reload()
  await expect(page.locator('section.point-step:not([hidden])')).toHaveCount(1)
  await page.locator('nav.rail .rail-view [data-view="layers"]').click()
  // One section at a time, as the reader read the layers before, not every layer at once.
  await expect(page.locator('section.point-step')).toHaveCount(0)
  await expect(page.locator('#layer-run-path')).toBeVisible()
  await expect(page.locator('#layer-other')).toBeHidden()
})

test('a switch keeps unfinished text in the layers, with no question', async ({ page, reviewUrl }) => {
  await page.goto(reviewUrl)
  const questions: string[] = []
  page.on('dialog', dialog => {
    questions.push(dialog.message())
    void dialog.dismiss()
  })
  const file = page.locator('section.layer article.file[data-path="src/app.ts"]').first()
  await file.scrollIntoViewIfNeeded()
  await file.locator('#L-src_app_ts-new-4 td.ln').nth(1).click()
  await file.locator('tr.sel-bar [data-act="comment-selection"]').click()
  const draft = file.locator('tr.composer .composer-box textarea')
  await draft.fill('not sent yet')
  // Into the points view and back: the layers stay on the page, and the text with them.
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await expect(page.locator('section.point-step:not([hidden])')).toHaveCount(1)
  await page.locator('nav.rail .rail-view [data-view="layers"]').click()
  await expect(page.locator('section.point-step')).toHaveCount(0)
  await expect(draft).toHaveValue('not sent yet')
  expect(questions).toEqual([])
})

test('leaving the points view asks before it takes away text in a stop', async ({ page, reviewUrl }) => {
  await page.goto(reviewUrl)
  const saves: unknown[] = []
  page.on('request', request => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/api/settings')) {
      saves.push(request.postDataJSON())
    }
  })
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await page.locator('nav.rail a[href="#step-p-1"]').click()
  const stop = page.locator('#step-p-1')
  await stop.locator('#L-src_app_ts-new-4 td.ln').nth(1).click()
  await stop.locator('tr.sel-bar [data-act="comment-selection"]').click()
  const draft = stop.locator('tr.composer .composer-box textarea')
  await draft.fill('in the stop')
  const before = saves.length
  // Keeping the text keeps the view and the setting.
  page.once('dialog', dialog => void dialog.dismiss())
  await page.locator('nav.rail .rail-view [data-view="layers"]').click()
  await expect(page.locator('nav.rail .rail-view [data-view="points"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(draft).toHaveValue('in the stop')
  expect(saves.length).toBe(before)
  // Discarding it switches.
  page.once('dialog', dialog => void dialog.accept())
  await page.locator('nav.rail .rail-view [data-view="layers"]').click()
  await expect(page.locator('section.point-step')).toHaveCount(0)
  expect(saves.length).toBe(before + 1)
})

test('the settings dialog keeps the points view when the reader keeps text in a stop', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await page.locator('nav.rail a[href="#step-p-1"]').click()
  const stop = page.locator('#step-p-1')
  await stop.locator('#L-src_app_ts-new-4 td.ln').nth(1).click()
  await stop.locator('tr.sel-bar [data-act="comment-selection"]').click()
  const draft = stop.locator('tr.composer .composer-box textarea')
  await draft.fill('not sent yet')
  await page.locator('#settings').click()
  await page.locator('#set-layer-view').selectOption('one')
  page.once('dialog', dialog => void dialog.dismiss())
  await page.locator('[data-act="settings-save"]').click()
  // The setting is saved, but the page stays as it is, and says when the view changes.
  await expect(page.locator('.toast')).toContainText('the view changes to one at a time on the next load')
  await expect(stop).toBeVisible()
  await expect(draft).toHaveValue('not sent yet')
  await page.reload()
  await expect(page.locator('section.point-step')).toHaveCount(0)
})

test('a comment posted in the points view is still on the page after switching to the layers', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await page.locator('nav.rail a[href="#step-p-1"]').click()
  const inStop = page.locator('#step-p-1 li.finding')
  await inStop.locator('[data-act="point-post"]').click()
  await expect(inStop).toHaveAttribute('data-status', 'posted')
  // The page is drawn again for the layers, with the comment posted since it loaded.
  await page.locator('nav.rail .rail-view [data-view="layers"]').click()
  await expect(page.locator('section.point-step')).toHaveCount(0)
  const card = page.locator('section.layer li.finding[data-fingerprint="fp-1"]')
  await expect(card).toHaveAttribute('data-status', 'posted')
  await expect(card.getByRole('link', { name: /view comment/ })).toHaveAttribute(
    'href',
    'https://github.com/acme/widgets/pull/42#discussion_r5001'
  )
  await expect(page.locator('section.layer tr.thread[data-thread="5001"]')).toHaveCount(1)
})

test('the points view has every card, line and thread on the page once', async ({ page, reviewUrl }) => {
  await page.goto(reviewUrl)
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  for (const stop of ['#step-p-1', '#step-p-2', '#step-p-3']) {
    await page.locator(`nav.rail a[href="${stop}"]`).click()
    await expect(page.locator(stop)).toBeVisible()
    const repeated = await page.evaluate(() => {
      const seen = new Map()
      for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1)
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
    })
    expect(repeated).toEqual([])
  }
})

test('a stop keeps its code open when the reading level changes, a reviewed file’s too', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await page.locator('nav.rail a[href="#step-p-1"]').click()
  const file = page.locator('#step-p-1 article.file')
  await file.locator('input[data-reviewed-id]').check()
  await expect(file.locator('.file-body')).toBeVisible()
  await page.locator('#fold-level').selectOption('aggressive')
  await expect(file.locator('.file-body')).toBeVisible()
})
