/**
 * Asking the platform's sign-in for a one-time code, in a box over the page.
 *
 * OAuth's authorization code with PKCE, handed back by `postMessage` rather
 * than a redirect. The sign-in is framed by the page that asked, in a box
 * the page draws over itself, and frames for that page's exact origin
 * alone. The box is made before anything is awaited, in the click's own
 * turn, so focus moves into the frame from the click, which is when a phone
 * opens its keyboard.
 *
 * A browser that refused the frame, because the page's policy names no
 * `frame-src` for the sign-in, or the page is shown inside another page
 * whose origin is not the one that asked, or the sign-in would not frame
 * for this page, still fires `load` on the iframe (measured in Chromium 141
 * and 153, and Firefox 142 for a `frame-ancestors` refusal), so the only
 * sign of a sign-in page that works is its own word.
 *
 * That holds for every page the frame shows, not only the first: a form
 * step the sign-in answers with a page the browser will not frame leaves
 * the box as empty as a refused first page does. So each time the frame
 * finishes loading a page, the page asks that page, `vbz.signin.ping` with
 * the load's number, and waits the ready time, `SIGN_IN_READY_MS` unless the
 * page names another, for `vbz.signin.ready` echoing it. A ready for an
 * earlier load, a second one, or one nobody asked for changes nothing, so a
 * page that posts more than one cannot leave a later refused page unowed.
 * The page cannot simply wait for a ready after each `load`: in Firefox 142
 * under COOP and COEP a sign-in page's own message arrived before the
 * iframe's `load`, measured, so only an answer to a ping sent after the
 * load says which page it is about. A refused page is another origin's, so
 * the ping, aimed at the sign-in origin alone, never reaches it.
 */

import type {
  PageKey,
  SignInCancel,
  SignInHandoff,
  SignInMessage,
  SignInPing,
  SignInReady,
} from "../api/index.js"
import type { MessageLike, PageEnvironment } from "./environment.js"
import { type ClientErrorCode, PlatformClientError } from "./errors.js"
import { makePkce } from "./pkce.js"

/**
 * How long a page of the sign-in has to say it loaded in its box before the
 * page says it cannot be reached, unless the client is given another. An
 * estimate: the ready message arrives as soon as a page of the sign-in
 * renders, and nothing here measured how long that takes on a slow network.
 */
export const SIGN_IN_READY_MS = 15_000

/** Each message's `type`, as the platform's sign-in posts it. */
const READY: SignInReady["type"] = "vbz.signin.ready"
const HANDOFF: SignInHandoff["type"] = "vbz.signin"
const CANCEL: SignInCancel["type"] = "vbz.signin.cancel"
const PING: SignInPing["type"] = "vbz.signin.ping"

/** What the sign-in hands back: a code to trade, and the verifier that answers it. */
export interface SignInGrant {
  readonly code: string
  readonly verifier: string
}

/** A sign-in open over the page. */
export interface OpenSignIn {
  /** The code and its verifier, once the player has signed in. */
  readonly grant: Promise<SignInGrant>
  /**
   * Whether the sign-in has handed the code over: true from the turn the
   * hand-off arrived in, before anything awaiting `grant` has run.
   */
  readonly handedOver: boolean
  /**
   * The page closing the box itself: `grant` rejects with
   * `E_SIGNIN_CANCELLED`. Nothing, once it has settled.
   */
  cancel(): void
}

/**
 * Puts the sign-in's box over the page and frames the sign-in in it.
 *
 * The box is on the page when this returns, before anything is awaited;
 * then the PKCE challenge is made and the frame pointed at `/authorize`.
 * `grant` resolves on a `vbz.signin` message whose source is the frame, on
 * the sign-in origin, carrying the state sent. It rejects with
 * `E_SIGNIN_CANCELLED` when the player closes the box, from the page or
 * from inside the frame, or the page cancels it, and with
 * `E_SIGNIN_UNREACHABLE` when a page the frame loaded, the first or any
 * after it, says no `vbz.signin.ready` within `readyMs`. The box is taken
 * down either way.
 */
export function openSignIn(options: {
  readonly environment: PageEnvironment
  readonly signInOrigin: string
  readonly pageKey: PageKey
  /** How long a page of the sign-in has to say it is ready. */
  readonly readyMs: number
}): OpenSignIn {
  const { environment, signInOrigin } = options
  // Assigned by the executor, which runs before the constructor returns.
  let resolveGrant!: (grant: SignInGrant) => void
  let rejectGrant!: (error: unknown) => void
  const grant = new Promise<SignInGrant>((resolve, reject) => {
    resolveGrant = resolve
    rejectGrant = reject
  })

  let settled = false
  let handedOver = false
  let pkce: Awaited<ReturnType<typeof makePkce>> | null = null
  /** The wait for a ready still owed, while there is one. */
  let waiting: unknown
  /** Pages the frame finished loading: the last one is the one asked. */
  let loads = 0
  const stopWaiting = () => {
    if (waiting !== undefined) environment.clearTimeout(waiting)
    waiting = undefined
  }
  /** A fresh wait, from now, for the ready still owed. */
  const waitForReady = () => {
    stopWaiting()
    waiting = environment.setTimeout(
      () => failWith("E_SIGNIN_UNREACHABLE"),
      options.readyMs,
    )
  }
  const finish = (): boolean => {
    if (settled) return false
    settled = true
    environment.removeMessageListener(listen)
    stopWaiting()
    box.remove()
    return true
  }
  const fail = (error: unknown) => {
    if (finish()) rejectGrant(error)
  }
  const failWith = (code: ClientErrorCode) =>
    fail(new PlatformClientError(code))

  const listen = (event: MessageLike) => {
    // Pages get messages from extensions and other frames too, so anything
    // that is not this frame's, on the sign-in origin, for this state, is
    // ignored rather than refused.
    if (pkce === null) return
    if (event.origin !== signInOrigin || event.source !== box.frame) return
    const data = event.data as Partial<
      Record<keyof SignInHandoff, unknown>
    > | null
    if (data?.state !== pkce.state) return
    const type = data.type as SignInMessage["type"] | undefined
    if (type === READY) {
      // Only the answer for the page the frame holds now: an earlier page's,
      // a second one, or one nobody asked for says nothing about this page.
      const answered = (data as Partial<Record<keyof SignInReady, unknown>>)
        .load
      if (loads > 0 && answered === loads) stopWaiting()
    } else if (type === CANCEL) {
      failWith("E_SIGNIN_CANCELLED")
    } else if (type === HANDOFF && typeof data.code === "string") {
      const code = data.code
      const { verifier } = pkce
      if (finish()) {
        handedOver = true
        resolveGrant({ code, verifier })
      }
    }
  }

  // First, before anything is awaited: the box, in the click's own turn.
  let box: ReturnType<PageEnvironment["mountSignInBox"]>
  try {
    box = environment.mountSignInBox({
      onCancel: () => failWith("E_SIGNIN_CANCELLED"),
      // Every page the frame shows owes a ready, whether or not the browser
      // let it render: asked now, it answers for this load and no other.
      onFrameLoad: () => {
        if (settled || pkce === null) return
        loads += 1
        waitForReady()
        const ping: SignInPing = { type: PING, state: pkce.state, load: loads }
        box.post(ping, signInOrigin)
      },
    })
  } catch (error) {
    settled = true
    rejectGrant(error)
    return { grant, handedOver: false, cancel: () => {} }
  }
  environment.addMessageListener(listen)

  makePkce(environment.crypto).then(
    (made) => {
      if (settled) return
      pkce = made
      const query = new URLSearchParams({
        client_id: options.pageKey,
        redirect_uri: environment.origin,
        state: made.state,
        code_challenge: made.challenge,
        code_challenge_method: "S256",
      })
      box.load(`${signInOrigin}/authorize?${query}`)
      // From the moment it is asked for: a frame the policy refuses may
      // fire no load at all (Firefox 142 fires error for a missing
      // frame-src, and nothing for a page COEP refused).
      waitForReady()
    },
    (error: unknown) => fail(error),
  )

  return {
    grant,
    get handedOver() {
      return handedOver
    },
    cancel: () => failWith("E_SIGNIN_CANCELLED"),
  }
}
