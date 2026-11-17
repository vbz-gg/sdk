/**
 * What the client needs of the browser, as one seam.
 *
 * Read from `globalThis` when a client is made, never when this module loads:
 * a page's bundle may import the SDK during server-side rendering, where
 * there is no window. A test hands in its own.
 */

import { mountSignInBox } from "./box.js"

/** The sign-in's box over the page, as far as the sign-in drives it. */
export interface SignInBox {
  /**
   * The frame's window: the one source a message is taken from. Read at
   * each message, because a frame taken off the page has none.
   */
  readonly frame: unknown
  /** Points the frame at the sign-in. */
  load(url: string): void
  /**
   * Posts `message` to the page the frame holds now, to `targetOrigin`
   * alone: a page of another origin, such as the one a browser shows for a
   * refused frame, never receives it.
   */
  post(message: unknown, targetOrigin: string): void
  /** Takes the box off the page. */
  remove(): void
}

/** What the sign-in hears from its box. */
export interface SignInBoxHandlers {
  /** The player closing the box from the page: its Cancel button, or Escape. */
  readonly onCancel: () => void
  /**
   * The frame finished loading a page, once it has been pointed at the
   * sign-in: a page the browser refused to show fires it as well as one it
   * showed (measured in Chromium 141 and 153, and in Firefox 142 for a
   * `frame-ancestors` refusal), so it says a page came and nothing about
   * whether it works.
   */
  readonly onFrameLoad: () => void
}

/** The fields of a `MessageEvent` the sign-in flow reads. */
export interface MessageLike {
  readonly origin: string
  readonly source: unknown
  readonly data: unknown
}

export interface PageEnvironment {
  /**
   * The page's own origin: the `redirect_uri` the sign-in checks, and the
   * one origin it lets frame it.
   */
  readonly origin: string
  readonly fetch: typeof fetch
  readonly crypto: Pick<Crypto, "getRandomValues" | "subtle">
  /**
   * Puts the sign-in's box over the page in the calling turn, its frame
   * holding nothing yet, and tells `handlers` when the player closes it from
   * the page and each time its frame finishes loading a page.
   */
  mountSignInBox(handlers: SignInBoxHandlers): SignInBox
  addMessageListener(listener: (event: MessageLike) => void): void
  removeMessageListener(listener: (event: MessageLike) => void): void
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  /** Where the player's token is kept, or undefined where there is none. */
  storage(): Storage | undefined
  now(): number
}

/** The page's own browser. Throws where there is no window. */
export function browserEnvironment(): PageEnvironment {
  const page = globalThis.window
  if (page === undefined) {
    throw new Error(
      "the platform client runs in a browser page; there is no window here",
    )
  }
  return {
    origin: page.location.origin,
    // Bound, because a browser refuses a `fetch` called on another object.
    fetch: page.fetch.bind(page),
    crypto: page.crypto,
    mountSignInBox: (handlers) => mountSignInBox(page.document, handlers),
    addMessageListener: (listener) =>
      page.addEventListener("message", listener),
    removeMessageListener: (listener) =>
      page.removeEventListener("message", listener),
    setTimeout: (run, ms) => page.setTimeout(run, ms),
    clearTimeout: (handle) =>
      page.clearTimeout(handle as ReturnType<typeof setTimeout>),
    storage: () => {
      // Reading `localStorage` throws in a sandboxed or privacy-locked page,
      // and a player who cannot keep a token is a player who signs in again.
      try {
        return page.localStorage
      } catch {
        return undefined
      }
    },
    now: () => Date.now(),
  }
}
