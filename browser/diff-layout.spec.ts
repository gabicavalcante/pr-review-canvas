import { expect, test } from './fixtures.js'

test('a short hunk under a long one spans the width the reader scrolls through', async ({
  page,
  reviewUrl,
}) => {
  await page.goto(reviewUrl)
  const file = page.locator('article.file[data-path="src/app.ts"]').first()
  await file.scrollIntoViewIfNeeded()
  await file.locator('table.diff td.code').first().waitFor()
  const widths = await file
    .locator('.diff-wrap')
    .first()
    .evaluate(wrap => {
      // A second hunk, then one line in the first long enough to scroll.
      const first = wrap.querySelector('table.diff')
      if (first !== null) wrap.append(first.cloneNode(true))
      const code = [...wrap.querySelectorAll('td.code')].find(c => c.getBoundingClientRect().width > 0)
      if (code) code.textContent = `${code.textContent} ${'x'.repeat(300)}`
      return {
        scroll: wrap.scrollWidth,
        client: wrap.clientWidth,
        tables: [...wrap.querySelectorAll('table.diff')].map(t =>
          Math.round(t.getBoundingClientRect().width)
        ),
      }
    })
  expect(widths.scroll).toBeGreaterThan(widths.client)
  expect(new Set(widths.tables).size).toBe(1)
  expect(widths.tables[0]).toBeGreaterThanOrEqual(widths.scroll - 1)
})
