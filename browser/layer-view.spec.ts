import { expect, test } from './fixtures.js'

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
  await expect(opening.locator('details.test-map')).toHaveAttribute('open', '')
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

  // After the last point come the layers, for the rest of the diff.
  await page.locator('#step-p-2 .step-nav a', { hasText: 'next point' }).click()
  await page.locator('#step-p-3 .step-nav a', { hasText: 'the rest of the diff' }).click()
  await expect(layer).toBeVisible()
  await expect(page.locator('#step-p-3')).toBeHidden()

  // The rail's switch goes back to the layers: every section returns, the stops are gone, and the
  // rail lists the layers in place of the points.
  await expect(page.locator('nav.rail a[href="#layer-run-path"]')).toHaveCount(0)
  await page.locator('nav.rail .rail-view [data-view="all"]').click()
  await expect(overview).toBeVisible()
  await expect(layer).toBeVisible()
  await expect(page.locator('#layer-other')).toBeVisible()
  await expect(page.locator('section.point-step')).toHaveCount(0)
  await expect(page.locator('nav.rail a[href="#layer-run-path"]')).toBeVisible()
  await expect(page.locator('nav.rail .rail-points')).toHaveCount(0)

  // It is saved as the setting is, so a reload keeps the layers; the switch leads back to the points.
  await page.reload()
  await expect(page.locator('nav.rail .rail-view [data-view="all"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('nav.rail .rail-view [data-view="points"]').click()
  await expect(opening).toBeVisible()
  await expect(overview).toBeHidden()
})
