// @ts-check
// @vitest-environment happy-dom
// The commands only a pull request can take, drawn on a pull request's page and left out of a
// local review's. Each case draws the same thing both ways, so the two stay side by side.
import { syntheticArtifact } from '../../src/testing/synthetic.js'
import { proposedCommentHtml, renderChatShell } from './chat.js'
import { sendCommandsHtml } from './comment-link.js'
import { parsePatch, rowHtml } from './diff-renderer.js'
import { isOnPullRequest, setOnPullRequest } from './host.js'
import { helpDialogHtml, KEY_HELP, keyAction, keyHelp } from './keyboard.js'
import { pointCommandsHtml } from './points.js'
import { selectionToolbarHtml } from './selection.js'
import { openReviewTab, reviewPaneHtml, selectSideTab, sideTabsHtml, wireSideTabs } from './side-pane.js'

afterEach(() => {
  setOnPullRequest(true)
  document.body.innerHTML = ''
})

/** @param {string} html */
function draw(html) {
  document.body.innerHTML = html
  return document.body
}

/** @param {string} key */
function press(key) {
  return /** @type {KeyboardEvent} */ (
    /** @type {unknown} */ ({ key, target: null, ctrlKey: false, metaKey: false, altKey: false })
  )
}

const point = syntheticArtifact().points[0]
if (point === undefined) {
  throw new Error('the synthetic canvas has no point')
}

/** @type {import('./proposed-comment.js').ProposedComment} */
const proposal = {
  path: 'src/app.ts',
  line: 3,
  side: 'new',
  body: 'Rename this.',
  proposalFingerprint: 'pf-1',
}

it('reads as a pull request until the page says otherwise', () => {
  expect(isOnPullRequest()).toBe(true)
  setOnPullRequest(false)
  expect(isOnPullRequest()).toBe(false)
})

describe('an attention point', () => {
  it('offers post and add to review on a pull request, still gated by posting', () => {
    const root = draw(pointCommandsHtml(point))
    expect(root.querySelector('[data-act="point-post"]')?.hasAttribute('data-needs-post')).toBe(true)
    expect(root.querySelector('[data-act="point-queue"]')).not.toBeNull()
  })

  it('offers neither on a local review, and keeps copy and dismiss', () => {
    setOnPullRequest(false)
    const root = draw(pointCommandsHtml(point))
    expect(root.querySelector('[data-act="point-post"], [data-act="point-queue"]')).toBeNull()
    expect(root.querySelector('[data-copy]')).not.toBeNull()
    expect(root.querySelector('[data-act="point-dismiss"]')).not.toBeNull()
  })

  it('still says where a sent comment went on a local review', () => {
    setOnPullRequest(false)
    expect(sendCommandsHtml({ kind: 'point', id: 'p-1', queued: true })).toContain('in your review')
    expect(sendCommandsHtml({ kind: 'point', id: 'p-1' })).toBe('')
  })
})

describe('the diff', () => {
  const [hunk] = parsePatch(['@@ -1,1 +1,2 @@', ' a', '+b'].join('\n'))
  const row = hunk?.entries[1]
  if (row === undefined) {
    throw new Error('no row')
  }

  it('draws the comment-on-line control on a pull request', () => {
    expect(rowHtml(row, 'k')).toContain('data-act="comment-line" data-needs-post')
  })

  it('draws no comment-on-line control on a local review, and keeps the line', () => {
    setOnPullRequest(false)
    const html = rowHtml(row, 'k')
    expect(html).not.toContain('comment-line')
    expect(html).toContain('<td class="gut"></td>')
    expect(html).toContain('id="L-k-new-2"')
  })
})

describe('the selection toolbar', () => {
  const selection = {
    key: 'k',
    path: 'src/app.ts',
    side: /** @type {const} */ ('new'),
    anchor: 2,
    start: 2,
    end: 4,
    dragging: false,
  }

  it('offers comment on a pull request', () => {
    const root = draw(`<table>${selectionToolbarHtml(selection)}</table>`)
    expect(root.querySelector('[data-act="comment-selection"]')?.hasAttribute('data-needs-post')).toBe(true)
  })

  it('offers no comment on a local review, and still names the lines', () => {
    setOnPullRequest(false)
    const root = draw(`<table>${selectionToolbarHtml(selection)}</table>`)
    expect(root.querySelector('[data-act="comment-selection"]')).toBeNull()
    expect(root.querySelector('.lbl')?.textContent).toBe('src/app.ts lines 2–4')
  })
})

describe('the side pane', () => {
  it('has AI Chat, Threads, and Your review on a pull request', () => {
    const root = draw(renderChatShell({ enabled: true }))
    expect([...root.querySelectorAll('[role="tab"]')].map(t => t.id)).toEqual([
      'side-tab-chat',
      'side-tab-threads',
      'side-tab-review',
    ])
    expect(root.querySelector('#review-panel')).not.toBeNull()
    expect(root.querySelector('aside')?.getAttribute('aria-label')).toBe('AI Chat and your review')
    expect(reviewPaneHtml()).toContain('review-only')
  })

  it('has AI Chat and Threads alone on a local review', () => {
    setOnPullRequest(false)
    const root = draw(renderChatShell({ enabled: true }))
    expect([...root.querySelectorAll('[role="tab"]')].map(t => t.id)).toEqual([
      'side-tab-chat',
      'side-tab-threads',
    ])
    expect(root.querySelector('#review-panel, .review-count')).toBeNull()
    expect(root.querySelector('aside')?.getAttribute('aria-label')).toBe('AI Chat')
    expect(root.querySelector('#chat-minimize')).not.toBeNull()
  })

  it('stays on the tab it shows when asked for the review a local review has not got', () => {
    setOnPullRequest(false)
    draw(renderChatShell({ enabled: true }))
    const pane = /** @type {HTMLElement} */ (document.querySelector('aside.chat'))
    const stop = wireSideTabs(pane)
    const threads = /** @type {HTMLElement} */ (pane.querySelector('#side-tab-threads'))
    threads.click()
    expect(selectSideTab(pane, 'review')).toBe(false)
    expect(pane.getAttribute('data-tab')).toBe('threads')
    const open = vi.fn()
    openReviewTab(pane, { open })
    expect(open).not.toHaveBeenCalled()
    expect(pane.getAttribute('data-tab')).toBe('threads')
    // The arrows walk the two tabs there are.
    threads.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(pane.getAttribute('data-tab')).toBe('chat')
    pane
      .querySelector('#side-tab-chat')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(pane.getAttribute('data-tab')).toBe('threads')
    stop()
  })

  it('is not drawn at all on a local review without AI Chat, where it would hold nothing', () => {
    setOnPullRequest(false)
    expect(reviewPaneHtml()).toBe('')
    expect(sideTabsHtml({ chat: false })).not.toContain('data-side-tab')
  })
})

describe('a comment AI Chat proposes', () => {
  const tied = { point: { fingerprint: 'fp-1', title: 'Check the retry' } }

  it('offers add to review, post, edit, copy, and unlink on a pull request', () => {
    const root = draw(proposedCommentHtml(proposal, 'turn-0', tied))
    expect([...root.querySelectorAll('.tbtns .cmd')].map(b => b.textContent)).toEqual([
      'add to review',
      'post to github',
      'edit',
      'copy',
    ])
    expect(root.querySelector('[data-act="proposed-edit"]')?.hasAttribute('data-needs-post')).toBe(true)
    expect(root.querySelector('[data-act="proposed-unlink"]')).not.toBeNull()
  })

  it('keeps the text and copy alone on a local review', () => {
    setOnPullRequest(false)
    const root = draw(proposedCommentHtml(proposal, 'turn-0', tied))
    expect([...root.querySelectorAll('.tbtns .cmd')].map(b => b.textContent)).toEqual(['copy'])
    expect(root.querySelector('.prose')?.textContent?.trim()).toBe('Rename this.')
    expect(root.querySelector('.proposed-point')?.textContent).toBe('about the point “Check the retry”')
  })
})

describe('the keyboard', () => {
  it('comments with c on a pull request, and lists it in the help', () => {
    expect(keyAction(press('c')).action).toBe('comment')
    expect(keyHelp()).toEqual(KEY_HELP)
    expect(helpDialogHtml()).toContain('comment on the line in focus')
  })

  it('does nothing with c on a local review, and leaves it out of the help', () => {
    setOnPullRequest(false)
    expect(keyAction(press('c'))).toEqual({ action: null, pendingG: false })
    expect(keyAction(press('a')).action).toBe('ask')
    expect(keyHelp().map(r => r.keys)).not.toContain('c')
    expect(keyHelp()).toHaveLength(KEY_HELP.length - 1)
    expect(helpDialogHtml()).not.toContain('comment on the line in focus')
  })
})
