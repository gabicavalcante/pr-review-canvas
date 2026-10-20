// @ts-check
// The forge this server talks to, as the page shell's bootstrap names it. One server serves one
// host, so the words and links that depend on it are read from here rather than threaded through
// every renderer.
/** @typedef {import('./contract-types.js').PublicHost} PublicHost */

/** @type {PublicHost} */
const DEFAULT_HOST = { kind: 'github', label: 'GitHub', webBase: 'https://github.com' }

/** @type {PublicHost} */
let current = DEFAULT_HOST

/** @param {PublicHost | undefined} host */
export function setHost(host) {
  current = host ?? DEFAULT_HOST
}

export function currentHost() {
  return current
}

/**
 * Whether the page reviews a pull request. Work reviewed before it has one is on no forge, so its
 * page draws none of the commands that only a pull request can take: posting, the pending review,
 * and its sign-off, rather than drawing them disabled for a reason that never goes away. `app.js`
 * sets it once per render, before the first renderer reads it.
 */
let onPullRequest = true

/** @param {boolean} on */
export function setOnPullRequest(on) {
  onPullRequest = on
}

export function isOnPullRequest() {
  return onPullRequest
}

/** `GitHub` or `GitLab`, for sentences. */
export function hostLabel() {
  return current.label
}

/** `post to github` / `post to gitlab`, the command label. */
export function postToLabel() {
  return `post to ${current.kind}`
}

/** What a command says when this login may not post. */
export function noPostingTitle() {
  return `this ${current.label} login cannot post on this repository`
}

/** @param {string} author */
export function authorProfileUrl(author) {
  return `${current.webBase}/${author}`
}
