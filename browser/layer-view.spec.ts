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

// From here on a review reads by attention points, as `readByPoints` turns on in the settings.
test.describe('reading by attention points', () => {
  test.use({ readByPoints: true })

  test('reads the canvas one attention point at a time, on this page and after a reload', async ({
    page,
    reviewUrl,
  }) => {
    await page.goto(reviewUrl)
    const overview = page.locator('#overview')
    const layer = page.locator('#layer-run-path')
    const opening = page.locator('#step-layer-run-path')
    const first = page.locator('#step-p-1')

    // The page opens on the first layer's opening stop alone.
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

    // The switch changes this page only: a reload opens on the attention points again, the layer the
    // URL still names on its opening stop. Back to the points from down the page, under its top.
    await page.reload()
    await expect(page.locator('nav.rail .rail-view [data-view="points"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(opening).toBeVisible()
    await expect(overview).toBeHidden()
    await page.locator('nav.rail .rail-view [data-view="layers"]').click()
    await page.mouse.wheel(0, 1500)
    await page.locator('nav.rail .rail-view [data-view="points"]').click()
    await expect(opening).toBeVisible()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('the one-point view keeps back and forward between stops, and a line link lands in its layer', async ({
    page,
    reviewUrl,
  }) => {
    await page.goto(reviewUrl)
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

  test('the rail’s switch goes to the layers in the layer view the settings choose', async ({
    page,
    reviewUrl,
  }) => {
    await page.goto(reviewUrl)
    await page.locator('#settings').click()
    await page.locator('#set-layer-view').selectOption('one')
    await page.locator('[data-act="settings-save"]').click()
    await expect(page.locator('#settings-dialog')).toBeHidden()
    // Show layers is about the layers: the page stays on its attention points.
    await expect(page.locator('#step-layer-run-path')).toBeVisible()
    await page.locator('nav.rail .rail-view [data-view="layers"]').click()
    // One section at a time, not every layer at once, on the layer of the stop that showed though the
    // URL never named it.
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

  test('a switch and a followed link change this page only, and a reload opens on what the settings say', async ({
    page,
    reviewUrl,
  }) => {
    const saves: unknown[] = []
    page.on('request', request => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/api/settings')) {
        saves.push(request.postDataJSON())
      }
    })
    await page.goto(reviewUrl)
    await page.locator('nav.rail .rail-view [data-view="layers"]').click()
    await expect(page.locator('section.point-step')).toHaveCount(0)
    await page.locator('nav.rail .rail-view [data-view="points"]').click()
    await page
      .locator('#step-p-3 .step-nav a', { hasText: 'the rest of the diff' })
      .evaluate(a => (a as HTMLElement).click())
    await expect(page.locator('section.point-step')).toHaveCount(0)
    expect(saves).toEqual([])
    await page.reload()
    await expect(page.locator('section.point-step:not([hidden])')).toHaveCount(1)
    await expect(page.locator('nav.rail .rail-view [data-view="points"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('the settings turn reading by attention points off and on, on the open page', async ({
    page,
    reviewUrl,
  }) => {
    await page.goto(reviewUrl)
    const readByPoints = page.locator('#set-read-by-points')
    await page.locator('#settings').click()
    await readByPoints.uncheck()
    await page.locator('[data-act="settings-save"]').click()
    // Off, the page reads the layers alone, with no switch.
    await expect(page.locator('section.point-step')).toHaveCount(0)
    await expect(page.locator('#layer-run-path')).toBeVisible()
    await expect(page.locator('nav.rail .rail-view')).toHaveCount(0)
    await page.reload()
    await expect(page.locator('section.point-step')).toHaveCount(0)
    await expect(page.locator('nav.rail .rail-view')).toHaveCount(0)
    // On again, the page opens its attention points at once.
    await page.locator('#settings').click()
    await readByPoints.check()
    await page.locator('[data-act="settings-save"]').click()
    await expect(page.locator('section.point-step:not([hidden])')).toHaveCount(1)
    await expect(page.locator('nav.rail .rail-view [data-view="points"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('a switch keeps unfinished text in the layers, with no question', async ({ page, reviewUrl }) => {
    await page.goto(reviewUrl)
    await page.locator('nav.rail .rail-view [data-view="layers"]').click()
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

  test('leaving the points view keeps text typed in a stop, in its layer, with no question', async ({
    page,
    reviewUrl,
  }) => {
    await page.goto(reviewUrl)
    const questions: string[] = []
    page.on('dialog', dialog => {
      questions.push(dialog.message())
      void dialog.dismiss()
    })
    await page.locator('nav.rail .rail-view [data-view="points"]').click()
    await page.locator('nav.rail a[href="#step-p-1"]').click()
    const stop = page.locator('#step-p-1')
    await stop.locator('#L-src_app_ts-new-4 td.ln').nth(1).click()
    await stop.locator('tr.sel-bar [data-act="comment-selection"]').click()
    await stop.locator('tr.composer .composer-box textarea').fill('in the stop')
    // The stop holds the layer's own card, which goes home with what is typed in it.
    await page.locator('nav.rail .rail-view [data-view="layers"]').click()
    await expect(page.locator('section.point-step')).toHaveCount(0)
    await expect(page.locator('pr-layer tr.composer .composer-box textarea')).toHaveValue('in the stop')
    expect(questions).toEqual([])
  })

  test('leaving the points view asks before it takes away text in a stop’s own card', async ({
    page,
    selfReviewUrl,
  }) => {
    await page.goto(selfReviewUrl)
    const saves: unknown[] = []
    page.on('request', request => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/api/settings')) {
        saves.push(request.postDataJSON())
      }
    })
    await page.locator('nav.rail .rail-view [data-view="points"]').click()
    // The Other layer lists no point cards, so this point's card is its stop's own.
    await page.locator('nav.rail a[href="#step-p-2"]').click()
    const card = page.locator('#step-p-2 #point-p-2')
    await card.locator('[data-act="point-settle"]').click()
    await card.locator('.settle-box textarea').fill('a reason not saved yet')
    // Keeping the text keeps the view.
    page.once('dialog', dialog => void dialog.dismiss())
    await page.locator('nav.rail .rail-view [data-view="layers"]').click()
    await expect(page.locator('nav.rail .rail-view [data-view="points"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(card.locator('.settle-box textarea')).toHaveValue('a reason not saved yet')
    // Discarding it switches, on this page only.
    page.once('dialog', dialog => void dialog.accept())
    await page.locator('nav.rail .rail-view [data-view="layers"]').click()
    await expect(page.locator('section.point-step')).toHaveCount(0)
    expect(saves).toEqual([])
  })

  test('turning the points off keeps the view when the reader keeps text in a stop’s own card', async ({
    page,
    selfReviewUrl,
  }) => {
    await page.goto(selfReviewUrl)
    await page.locator('nav.rail .rail-view [data-view="points"]').click()
    await page.locator('nav.rail a[href="#step-p-2"]').click()
    const card = page.locator('#step-p-2 #point-p-2')
    await card.locator('[data-act="point-settle"]').click()
    await card.locator('.settle-box textarea').fill('a reason not saved yet')
    await page.locator('#settings').click()
    await page.locator('#set-read-by-points').uncheck()
    page.once('dialog', dialog => void dialog.dismiss())
    await page.locator('[data-act="settings-save"]').click()
    // The setting is saved, but the page stays as it is, and says when the view changes.
    await expect(page.locator('.toast')).toContainText('the view changes on the next load')
    await expect(page.locator('#step-p-2')).toBeVisible()
    await expect(card.locator('.settle-box textarea')).toHaveValue('a reason not saved yet')
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

  test('the arrows at the head of a stop move as its way on does, to the layers after the last', async ({
    page,
    reviewUrl,
  }) => {
    await page.goto(reviewUrl)
    await page.locator('#step-layer-run-path .step-arrows a[aria-label^="go to its"]').click()
    await expect(page.locator('#step-p-1')).toBeVisible()
    await page.locator('#step-p-1 .step-arrows a[aria-label="Run path"]').click()
    await expect(page.locator('#step-layer-run-path')).toBeVisible()
    await page.goto(`${reviewUrl}#step-p-3`)
    await page.locator('#step-p-3 .step-arrows a[aria-label="the rest of the diff, by layer"]').click()
    await expect(page.locator('section.point-step')).toHaveCount(0)
    await expect(page.locator('#layer-run-path')).toBeVisible()
  })

  test('a stop’s point line keeps its show command inside the diff’s visible width', async ({
    page,
    reviewUrl,
  }) => {
    await page.goto(`${reviewUrl}#step-p-1`)
    const diff = page.locator('#step-p-1 .diff-wrap').first()
    const toggle = page.locator('#step-p-1 tr.ifind [data-act="point-expand"]')
    await expect(toggle).toBeVisible()
    const box = await diff.boundingBox()
    const button = await toggle.boundingBox()
    expect(button!.x + button!.width).toBeLessThanOrEqual(box!.x + box!.width - 14)
    // The line adds no width of its own, so it gives the diff no sideways scroll.
    expect(await diff.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0)
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

  test('a chunk, file or layer link followed in the points view lands on the stop that shows it', async ({
    page,
    reviewUrl,
  }) => {
    await page.goto(reviewUrl)
    await page.locator('nav.rail .rail-view [data-view="points"]').click()
    await page.locator('nav.rail a[href="#step-p-1"]').click()
    const follow = async (href: string) => {
      await page.evaluate(link => {
        const a = document.createElement('a')
        a.href = link
        a.setAttribute('data-link', link)
        a.textContent = link
        a.className = 'test-link'
        document.querySelector('section.point-step:not([hidden]) .step-h')?.append(a)
      }, href)
      await page.locator('a.test-link').last().click()
    }
    // The point's chunk and its file are the stop's own: the reader stays there.
    await follow('#hunk:src/app.ts#1')
    await expect(page.locator('#step-p-1')).toBeVisible()
    await follow('#file:src/app.ts')
    await expect(page.locator('#step-p-1')).toBeVisible()
    // A layer opens on its opening stop, not on its section.
    await follow('#layer:run-path')
    await expect(page.locator('#step-layer-run-path')).toBeVisible()
    await expect(page.locator('section.layer:visible')).toHaveCount(0)
  })

  test('r and R mark the file and the layer of the stop on screen reviewed', async ({ page, reviewUrl }) => {
    await page.goto(reviewUrl)
    await page.locator('nav.rail .rail-view [data-view="points"]').click()
    await page.locator('nav.rail a[href="#step-p-1"]').click()
    await page.keyboard.press(']')
    await expect(page.locator('#step-p-1 #point-p-1')).toHaveClass(/is-focused/)
    await page.keyboard.press('r')
    const file = page.locator('#step-p-1 article.file')
    await expect(file.locator('input[data-reviewed-id]')).toBeChecked()
    // The stop keeps its code in sight.
    await expect(file.locator('.file-body')).toBeVisible()
  })

  test('a line link the URL names lands in its layer, also while a stop holds its card', async ({
    page,
    reviewUrl,
  }) => {
    await page.goto(reviewUrl)
    await page.locator('nav.rail .rail-view [data-view="points"]').click()
    await page.locator('nav.rail a[href="#step-p-1"]').click()
    await expect(page.locator('#step-p-1 #L-src_app_ts-new-4')).toHaveCount(1)
    // A fragment the URL gets, as back and forward give it, not a link the reader follows.
    await page.evaluate(() => {
      window.location.hash = '#line:src/app.ts:4'
    })
    await expect(page.locator('pr-layer #L-src_app_ts-new-4')).toBeInViewport()
    await expect(page.locator('#layer-run-path')).toBeVisible()
    await expect(page.locator('#step-p-1')).toBeHidden()
  })
})
