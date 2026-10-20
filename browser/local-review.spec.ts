import { expect, openFiles, test } from './fixtures.js'

test('a local review draws none of the commands that only act on a pull request', async ({
  page,
  localReview,
}) => {
  await page.goto(await localReview({ chat: true }))
  await openFiles(page)
  // A file's diff is drawn once it comes on screen.
  const file = page.locator('article.file[data-path="src/app.ts"]').first()
  await file.scrollIntoViewIfNeeded()
  await expect(file.locator('tr.add').first()).toBeAttached()
  await expect(file.locator('button.plus')).toHaveCount(0)
  // Nothing on the page posts, so nothing is drawn disabled for a reason that never goes away.
  await expect(page.locator('[data-needs-post]')).toHaveCount(0)
  await expect(page.locator('[data-act="point-queue"]')).toHaveCount(0)
  await expect(page.locator('.pending-bar-host, .signoff, .capability-note')).toHaveCount(0)
  await expect(page.locator('[data-act="point-dismiss"]').first()).toBeAttached()
  // The side pane is AI Chat and its threads.
  await expect(page.locator('[data-side-tab]')).toHaveCount(2)
  await expect(page.locator('#side-tab-chat, #side-tab-threads')).toHaveCount(2)
  await expect(page.locator('#review-panel')).toHaveCount(0)

  // A selection can be asked about, not commented on, and c opens no composer.
  await file.locator('#L-src_app_ts-new-4 td.ln').nth(1).click()
  const bar = file.locator('tr.sel-bar')
  await expect(bar).toContainText('src/app.ts line 4')
  await expect(bar.locator('[data-act="ask"]')).toHaveCount(1)
  await expect(bar.locator('[data-act="comment-selection"]')).toHaveCount(0)
  await page.keyboard.press('c')
  await expect(page.locator('.composer-box')).toHaveCount(0)

  await page.keyboard.press('?')
  const help = page.locator('#help-dialog')
  await expect(help).toBeVisible()
  await expect(help).toContainText('ask AI Chat about the card')
  await expect(help).not.toContainText('comment on the line in focus')
})

test('a local review without AI Chat has no side pane at all', async ({ page, localReview }) => {
  await page.goto(await localReview({ chat: false }))
  await expect(page.locator('section.layer').first()).toBeVisible()
  await expect(page.locator('aside.chat, #chat-launcher, [data-side-tab]')).toHaveCount(0)
  await expect(page.locator('[data-needs-post]')).toHaveCount(0)
})
