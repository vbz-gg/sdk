/**
 * What can go wrong talking to the platform, as two kinds.
 *
 * A `PlatformRefusal` is the platform's own answer: a code from
 * `PublicRefusalCode`, the status it always comes with, a sentence a person
 * can read and a detail for a log. A `PlatformClientError` is this client
 * failing before or around a request: a popup the browser blocked, a request
 * that got no answer, a game's code that did not load. Both carry a `code` a page
 * switches on, and the two code sets never overlap.
 */

import type { PublicRefusalCode } from "../api/index.js"
import type { MOUNT_ERROR, PageModuleProblemCode } from "../game/contract.js"

export class PlatformRefusal extends Error {
  readonly code: PublicRefusalCode
  readonly status: number
  readonly detail: Readonly<Record<string, unknown>> | undefined

  constructor(
    status: number,
    body: {
      readonly error: PublicRefusalCode
      readonly message: string
      readonly detail?: Readonly<Record<string, unknown>>
    },
  ) {
    super(body.message)
    this.name = "PlatformRefusal"
    this.code = body.error
    this.status = status
    this.detail = body.detail
  }
}

/** Every failure this client raises itself, with what it means. */
export const CLIENT_ERROR = {
  /** The browser did not open the sign-in window: `signIn()` ran outside a click. */
  E_POPUP_BLOCKED:
    "the browser blocked the sign-in window; call signIn() from a click handler, before anything is awaited",
  /** The sign-in window closed without handing a code over. */
  E_SIGNIN_CLOSED:
    "the sign-in window closed before a player signed in; if it closed by itself at once, check the page does not send Cross-Origin-Opener-Policy: same-origin",
  /** A player route, and no player is signed in on this page. */
  E_NOT_SIGNED_IN: "no player is signed in on this page",
  /** `fetch` threw: the request may or may not have reached the platform. */
  E_UNREACHABLE: "the platform did not answer",
  /** An answer that is not JSON, or a failure with no code in it. */
  E_ANSWER_UNREADABLE: "the platform's answer could not be read",
  /** The game's page module did not load: the network, the page's CSP, or an address that is not https. */
  E_GAME_UNLOADABLE:
    "the game's code did not load from its address; check the network and that the page's Content-Security-Policy allows the game's path, then reload the page to try again",
  /** What the page module exports is not a page module; the detail names the field. */
  E_GAME_MODULE_INVALID: "the game's page module is not one this page can play",
  /** The page module speaks a contract version this page's SDK does not drive. */
  E_GAME_CONTRACT_UNKNOWN:
    "the game's page module was built for a newer @vbz-gg/sdk than this page's; update the page's @vbz-gg/sdk",
  /** The game's input mapping names an input or a device its manifest does not allow. */
  E_CAPTURE_INVALID:
    "the game's input mapping does not match the inputs its manifest declares",
  /** A script on the page replaced a built-in the rules code calls; the detail names it. */
  E_PAGE_ALTERS_BUILTINS:
    "a script on this page replaced a built-in the game's rules code calls, so the page would play a different game from the one the platform replays",
  /** The page module, or the run's, is another version than the one expected. */
  E_WRONG_GAME:
    "the game's page module is another version of the game than the one this run plays",
  /** The run's tick rate is not one the engine runs at. */
  E_TICK_RATE_UNSUPPORTED: "the run's tick rate is not 30, 60 or 120",
  /** The run's own module reads tilt, and the tap that started it did not ask. */
  E_MOTION_NEEDS_TAP:
    "this run's game reads tilt, which a browser grants only from a tap; tap Play again to carry on with the same run",
  /**
   * The browser has no Web Locks, so it cannot keep a run to one tab: Safari
   * before 15.4, or a page that is not https. Nothing was started.
   */
  E_BROWSER_UNSUPPORTED:
    "this browser cannot keep a run to one tab; play on an https page in Safari 15.4 or later, or another current browser",
  /** Another tab or window of this browser is playing the same run. */
  E_RUN_OPEN_ELSEWHERE:
    "this run is already being played in another tab or window",
  /** The run's replay covers no ticks, so there is nothing to show. */
  E_NOTHING_TO_WATCH: "the run has nothing to replay",
  /** The manifest declares a data pack the simulation reads. */
  E_SIM_PACKS:
    "the game's manifest declares a data pack its simulation reads, which the platform cannot store or replay yet",
  /** An error this client has no code for: a bug to report, with its detail. */
  E_UNEXPECTED: "the run met an error the client has no code for",
} as const

export type ClientErrorCode = keyof typeof CLIENT_ERROR

/**
 * Fails to compile when a client code is also one the platform answers, so a
 * page's `switch` on `code` never has one case meaning two things.
 */
type Shared = Extract<ClientErrorCode, PublicRefusalCode>
export const NO_CODE_IS_BOTH: [Shared] extends [never] ? true : Shared = true

/**
 * Fails to compile when a page module can report a code of its own that this
 * table does not explain, so every code a run fails with outside the engine's
 * and the platform's own is one a page can look up here.
 */
type FromTheModule =
  | PageModuleProblemCode
  | (typeof MOUNT_ERROR)[keyof typeof MOUNT_ERROR]
type Unexplained = Exclude<FromTheModule, ClientErrorCode>
export const EVERY_MODULE_CODE_IS_EXPLAINED: [Unexplained] extends [never]
  ? true
  : Unexplained = true

export class PlatformClientError extends Error {
  readonly code: ClientErrorCode
  /** The HTTP status, for an answer that came back unreadable. */
  readonly status: number | undefined

  constructor(
    code: ClientErrorCode,
    options: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(CLIENT_ERROR[code], { cause: options.cause })
    this.name = "PlatformClientError"
    this.code = code
    this.status = options.status
  }
}

/**
 * Whether the same request is worth sending again.
 *
 * One that got no answer may not have reached the platform, and one the
 * platform failed on left nothing behind, so the same body goes again: every
 * run write takes the same body twice with no harm. A refusal is the
 * platform's answer to that body, and sending it again gets the same answer.
 */
export function worthRetrying(error: unknown): boolean {
  if (error instanceof PlatformRefusal) return error.status >= 500
  if (!(error instanceof PlatformClientError)) return false
  // A proxy's own 502, 503 or 504 page is not JSON, and the platform behind
  // it may never have seen the request.
  return (
    error.code === "E_UNREACHABLE" ||
    (error.code === "E_ANSWER_UNREADABLE" && (error.status ?? 0) >= 500)
  )
}
