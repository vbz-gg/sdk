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
 * `frame-src` for the sign-in, or the page is framed by another site, or
 * the sign-in would not frame for this page, still fires `load` on the
 * iframe (measured in Chromium 141 and 153, and Firefox 142 for a
 * `frame-ancestors` refusal), so the only sign of a sign-in that works is
 * the `vbz.signin.ready` message it posts as it loads.
 */

import type {
  PageKey,
  SignInCancel,
  SignInHandoff,
  SignInMessage,
  SignInReady,
} from "../api/index.js"
import type { MessageLike, PageEnvironment } from "./environment.js"
import { type ClientErrorCode, PlatformClientError } from "./errors.js"
import { makePkce } from "./pkce.js"

/**
 * How long the sign-in has to say it loaded in its box before the page says
 * it cannot be reached. An estimate: the ready message arrives as soon as
 * the sign-in's first page renders, and nothing here measured how long that
 * takes on a slow network.
 */
export const SIGN_IN_READY_MS = 15_000

/** Each message's `type`, as the platform's sign-in posts it. */
const READY: SignInReady["type"] = "vbz.signin.ready"
const HANDOFF: SignInHandoff["type"] = "vbz.signin"
const CANCEL: SignInCancel["type"] = "vbz.signin.cancel"

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
 * `E_SIGNIN_UNREACHABLE` when no `vbz.signin.ready` arrives within
 * `SIGN_IN_READY_MS`. The box is taken down either way.
 */
export function openSignIn(options: {
  readonly environment: PageEnvironment
  readonly signInOrigin: string
  readonly pageKey: PageKey
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
  let pkce: Awaited<ReturnType<typeof makePkce>> | null = null
  let waiting: unknown
  const finish = (): boolean => {
    if (settled) return false
    settled = true
    environment.removeMessageListener(listen)
    if (waiting !== undefined) environment.clearTimeout(waiting)
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
      if (waiting !== undefined) environment.clearTimeout(waiting)
      waiting = undefined
    } else if (type === CANCEL) {
      failWith("E_SIGNIN_CANCELLED")
    } else if (type === HANDOFF && typeof data.code === "string") {
      const code = data.code
      const { verifier } = pkce
      if (finish()) resolveGrant({ code, verifier })
    }
  }

  // First, before anything is awaited: the box, in the click's own turn.
  let box: ReturnType<PageEnvironment["mountSignInBox"]>
  try {
    box = environment.mountSignInBox(() => failWith("E_SIGNIN_CANCELLED"))
  } catch (error) {
    settled = true
    rejectGrant(error)
    return { grant, cancel: () => {} }
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
      waiting = environment.setTimeout(
        () => failWith("E_SIGNIN_UNREACHABLE"),
        SIGN_IN_READY_MS,
      )
    },
    (error: unknown) => fail(error),
  )

  return { grant, cancel: () => failWith("E_SIGNIN_CANCELLED") }
}
