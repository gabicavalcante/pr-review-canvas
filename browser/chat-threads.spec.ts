import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.js'

/** Asks about a target from its ask command, through the quick-question menu's free question. */
async function askAbout(page: Page, command: ReturnType<Page['locator']>, question: string) {
  await command.click()
  const other = page.getByText('ask something else…', { exact: true }).first()
  if (await other.isVisible()) {
    await other.click()
  }
  await page.locator('#msg').fill(question)
  await page.keyboard.press('Enter')
  await expect(page.locator('#chat-log')).toContainText('covered at')
}

test('each ask opens the thread of its place, and the Threads tab lists them', async ({
  page,
  chatServer,
}, testInfo) => {
  // Narrower screens float the pane over the canvas; the wide one docks it beside the canvas.
  test.skip(testInfo.project.name !== 'desktop')
  const { url } = await chatServer()
  await page.goto(url)
  const pointAsk = page
    .locator('section.layer li.finding[data-fingerprint="fp-1"]')
    .locator('[data-act="ask"]')
    .first()
  const layerAsk = page.getByRole('button', { name: 'ask about this layer' }).first()

  await askAbout(page, pointAsk, 'Is the sum intended?')
  await expect(page.locator('#thread-title')).toHaveText('Sum instead of product')

  await askAbout(page, layerAsk, 'Anything risky here?')
  await expect(page.locator('#thread-title')).toHaveText('layer · Run path')
  await expect(page.locator('#chat-log')).not.toContainText('Is the sum intended?')

  const threadsTab = page.locator('#side-tab-threads')
  await expect(threadsTab).toHaveText('Threads 2')
  await threadsTab.click()
  await page.locator('#thread-index').getByText('Sum instead of product').click()
  await expect(page.locator('#thread-title')).toHaveText('Sum instead of product')
  await expect(page.locator('#chat-log')).toContainText('Is the sum intended?')
  // The point's ask counts its thread's questions.
  expect(await pointAsk.evaluate(el => getComputedStyle(el, '::after').content)).toBe('"1"')
})

test('with a thread per place off, every ask goes to the open thread until the reader turns it on', async ({
  page,
  chatServer,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  const { url } = await chatServer({
    setup: async t => {
      await t.ctx.settings.write({ chatThreadPerPlace: false })
    },
  })
  await page.goto(url)
  const pointAsk = page
    .locator('section.layer li.finding[data-fingerprint="fp-1"]')
    .locator('[data-act="ask"]')
    .first()

  await askAbout(page, pointAsk, 'Is the sum intended?')
  await expect(page.locator('#chat-ctx')).toHaveText('point · Sum instead of product')
  await askAbout(page, page.getByRole('button', { name: 'ask about this layer' }).first(), 'Anything risky?')
  // One thread holds both questions, each naming what it was about.
  await expect(page.locator('#chat-log .turn-ctx')).toHaveText([
    'about point · Sum instead of product',
    'about layer · Run path',
  ])
  await expect(page.locator('#side-tab-threads')).toHaveText('Threads 1')
  expect(await pointAsk.evaluate(el => getComputedStyle(el, '::after').content)).toBe('none')

  await page.locator('#settings').click()
  await page.locator('dialog').getByRole('tab', { name: 'AI Chat' }).click()
  await page.locator('#set-thread-per-place').check()
  await page.locator('[data-act="settings-save"]').click()
  await expect(page.locator('#chat-ctx-line')).toBeHidden()

  await pointAsk.click()
  await page.getByText('ask something else…', { exact: true }).first().click()
  await expect(page.locator('#thread-title')).toHaveText('Sum instead of product')
  await expect(page.locator('#chat-log')).toContainText('A new thread about point · Sum instead of product')
})
