import type { Page } from '@playwright/test'
import { expect, openFiles, test } from './fixtures.js'

// A first visit: nothing in storage says the reader opened the chat before.
test.use({ chatOpened: false })

test.beforeEach(async ({ page }) => {
  await page.route('**/api/prs/42', async route => {
    const response = await route.fetch()
    const bundle = await response.json()
    bundle.chat.enabled = true
    await route.fulfill({ response, json: bundle })
  })
  await page.route('**/api/prs/42/chat/threads', route =>
    route.fulfill({ json: { threads: [], activeThread: null } })
  )
})

test('floats on smaller screens and preserves drafts across minimizing and resizing', async ({
  page,
  reviewUrl,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto(reviewUrl)
  const launcher = page.getByRole('button', { name: 'AI Chat', exact: true })
  const dialog = page.locator('#chat-dialog')
  await expect(page.locator('.chat')).toBeHidden()
  await launcher.click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('position', 'fixed')
  expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(false)
  const bounds = await dialog.boundingBox()
  expect(bounds!.x + bounds!.width).toBe(1080)
  expect(bounds!.y + bounds!.height).toBe(780)
  await page.locator('#msg').fill('Keep my draft')
  await page.getByRole('button', { name: 'Minimize AI Chat' }).click()
  await expect(dialog).toBeHidden()
  await expect(launcher).toBeFocused()
  await launcher.click()
  await expect(page.locator('#msg')).toHaveValue('Keep my draft')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('.layout > .chat')).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(launcher).toBeHidden()
  await expect(page.locator('#msg')).toHaveValue('Keep my draft')
  await page.setViewportSize({ width: 390, height: 700 })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true)
  await expect(page.locator('#msg')).toHaveValue('Keep my draft')
})

test('opens a mobile modal with focus containment and Escape to minimize', async ({ page, reviewUrl }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto(reviewUrl)
  const launcher = page.getByRole('button', { name: 'AI Chat', exact: true })
  await launcher.click()
  const dialog = page.locator('#chat-dialog')
  expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true)
  await expect(page.locator('#msg')).toBeFocused()
  await page.locator('#chat-send').focus()
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700)
  await page.locator('#msg').fill('Mobile draft')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(launcher).toBeFocused()
  await launcher.click()
  await expect(page.locator('#msg')).toHaveValue('Mobile draft')
  await page.getByRole('button', { name: 'Minimize AI Chat' }).click()
  await expect(dialog).toBeHidden()
})

test('starts the docked chat minimized on a wide screen and remembers how it was left', async ({
  page,
  reviewUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(reviewUrl)
  const launcher = page.getByRole('button', { name: 'AI Chat', exact: true })
  const pane = page.locator('.layout > .chat')
  const layout = page.locator('.layout')
  await expect(pane).toBeHidden()
  await expect(layout).toHaveClass(/no-chat/)
  await launcher.click()
  await expect(pane).toBeVisible()
  await expect(launcher).toBeHidden()

  // Opened once, the chat stays docked across a reload.
  await page.reload()
  await expect(pane).toBeVisible()
  await expect(launcher).toBeHidden()
  await page.locator('#msg').fill('Wide draft')

  await page.getByRole('button', { name: 'Minimize AI Chat' }).click()
  await expect(pane).toBeHidden()
  await expect(page.locator('#chat-dialog')).toBeHidden()
  await expect(layout).toHaveClass(/no-chat/)
  await expect(launcher).toBeVisible()
  await expect(launcher).toBeFocused()
  await launcher.click()
  await expect(pane).toBeVisible()
  await expect(layout).not.toHaveClass(/no-chat/)
  await expect(page.locator('#msg')).toHaveValue('Wide draft')

  // The canvas keeps the extra width across a reload.
  await page.getByRole('button', { name: 'Minimize AI Chat' }).click()
  await page.reload()
  await expect(page.locator('.layout > .chat')).toBeHidden()
  await expect(layout).toHaveClass(/no-chat/)
  await expect(launcher).toBeVisible()
  await launcher.click()
  await expect(page.locator('.layout > .chat')).toBeVisible()
  await expect(page.locator('#msg')).toBeFocused()
})

test('leaves the canvas scrolled where it was across minimize and restore', async ({ page, reviewUrl }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(reviewUrl)
  await openFiles(page)
  const launcher = page.getByRole('button', { name: 'AI Chat', exact: true })
  const minimize = page.getByRole('button', { name: 'Minimize AI Chat' })
  await launcher.click()
  await expect(page.locator('#msg')).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  await page.evaluate(() => window.scrollTo(0, 600))
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  await minimize.click()
  await launcher.click()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
})

test('keeps the quick-question menu inside the window with the chat minimized', async ({
  page,
  reviewUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(reviewUrl)
  await expect(page.locator('.layout')).toHaveClass(/no-chat/)
  // With the chat gone the layer command sits near the right edge, where the menu used to spill.
  await page.getByRole('button', { name: 'Ask about this layer' }).hover()
  const menu = page.locator('#qq-menu')
  await expect(menu).toBeVisible()
  const box = (await menu.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(1600)
})

test.describe('a docked chat on a wide screen', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'sets its own window width')
  })

  const box = async (page: Page, selector: string) => {
    const found = await page.locator(selector).boundingBox()
    if (found === null) throw new Error(`no box for ${selector}`)
    return { x: found.x, width: found.width, right: found.x + found.width }
  }
  /** Where the rail, the reading column and the title are. */
  const places = async (page: Page) => ({
    rail: (await box(page, 'nav.rail')).x,
    main: await box(page, '#main'),
    title: (await box(page, '.hdr-title h1')).x,
  })
  const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(1)
  const launcher = (page: Page) => page.getByRole('button', { name: 'AI Chat', exact: true })
  const chat = '.layout > .chat'

  /** Drags the chat's left edge to `x`. */
  const dragTo = async (page: Page, x: number) => {
    const handle = await page.locator('#chat-handle').boundingBox()
    if (handle === null) throw new Error('no handle')
    const y = handle.y + 100
    await page.mouse.move(handle.x + handle.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 4 })
    await page.mouse.up()
  }

  // `centred` is the rail's left edge minimized; `docked` is where it goes when the chat opens at
  // its default 380px, which then fills what is right of the 1100px reading column.
  for (const { width, centred, docked } of [
    { width: 1800, centred: 230, docked: 80 },
    { width: 1920, centred: 290, docked: 200 },
    { width: 2400, centred: 530, docked: 530 },
  ]) {
    test(`moves the rail and the text left only as far as the chat needs, and back, at ${width}`, async ({
      page,
      reviewUrl,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(reviewUrl)
      await expect(page.locator('.layout')).toHaveClass(/no-chat/)
      const minimized = await places(page)
      near(minimized.rail, centred)
      near(minimized.main.x, centred + 240)
      near(minimized.main.width, 1100)
      near(minimized.title, centred + 20)

      await launcher(page).click()
      await expect(page.locator(chat)).toBeVisible()
      const open = await places(page)
      const pane = await box(page, chat)
      near(open.rail, docked)
      near(open.main.x, docked + 240)
      near(open.main.width, 1100)
      near(open.title, docked + 20)
      // No gap after the text, none before the edge.
      near(pane.x, open.main.right)
      near(pane.right, width)
      expect(pane.width).toBeGreaterThanOrEqual(380)

      await page.getByRole('button', { name: 'Minimize AI Chat' }).click()
      expect(await places(page)).toEqual(minimized)
    })
  }

  test('narrows the chat into a gap and widens it up to the text, without moving the text', async ({
    page,
    reviewUrl,
  }) => {
    await page.setViewportSize({ width: 2400, height: 900 })
    await page.goto(reviewUrl)
    await launcher(page).click()
    const open = await places(page)

    await dragTo(page, 2030)
    const narrowed = await box(page, chat)
    near(narrowed.width, 370)
    near(narrowed.right, 2400)
    expect(narrowed.x - open.main.right).toBeGreaterThan(150)
    expect(await places(page)).toEqual(open)
    expect(await page.evaluate(() => localStorage.getItem('pr-review.chat-width'))).toBe('370')

    await dragTo(page, open.main.x + 100)
    const widened = await box(page, chat)
    near(widened.x, open.main.right)
    near(widened.right, 2400)
    expect(await places(page)).toEqual(open)
  })

  test('makes room for the width it was resized to after a reload', async ({ page, reviewUrl }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    await page.goto(reviewUrl)
    await launcher(page).click()
    const open = await places(page)
    await dragTo(page, 1550)
    near((await box(page, chat)).x, 1550)
    near((await places(page)).rail, open.rail)

    await page.reload()
    await expect(page.locator(chat)).toBeVisible()
    const reloaded = await places(page)
    const pane = await box(page, chat)
    // 370px needs 10px less than 380, so the rail and the text sit 10px further right.
    near(reloaded.rail, open.rail + 10)
    near(reloaded.title, reloaded.rail + 20)
    near(pane.width, 370)
    near(pane.x, reloaded.main.right)
    near(pane.right, 1920)
  })
})
