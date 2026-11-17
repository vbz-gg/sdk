/**
 * What can go wrong talking to the platform, as two kinds.
 *
 * A `PlatformRefusal` is the platform's own answer: a code from
 * `PublicRefusalCode`, the status it always comes with, a sentence a person
 * can read and a detail for a log. A `PlatformClientError` is this client
 * failing before or around a request: a sign-in the browser would not
 * frame, a request that got no answer, a game's code that did not load. Both carry a `code` a page
 * switches on, and the two code sets never overlap.
 */

import type { PublicRefusalCode } from "../api/index.js"
import type {
  MOUNT_ERROR,
  PageModule,
  PageModuleProblemCode,
} from "../game/contract.js"

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
  /**
   * The sign-in was closed before a player signed in: its Cancel button,
   * Escape, or the page's own `closeSignIn()`.
   */
  E_SIGNIN_CANCELLED: "the sign-in was closed before a player signed in",
  /**
   * The sign-in did not say it had loaded in its box in time. A browser that
   * refuses to frame it shows nothing in the box and tells the page nothing,
   * so this is every refusal: a policy with no `frame-src` for the sign-in,
   * a page framed by another site, or a page the game does not allow.
   */
  E_SIGNIN_UNREACHABLE:
    "the sign-in did not load in its box; check that the page's Content-Security-Policy has frame-src naming the sign-in origin, https://signin.vbz.gg, that the page is not itself in a frame on another site, and that the page's origin is one the game allows",
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
  /*
   * The five below are the engine's refusals of tilt, by its own names. A
   * game that reads tilt starts no run without it, so `playRun` fails the run
   * with whichever the click's request answered, before a run is started.
   */
  /** The page is not https, or localhost, and a browser gives tilt only to a secure page. */
  E_MOTION_INSECURE:
    "this game is steered by tilting, and a browser gives tilt only to an https page, so no run was started; open the game at its https address",
  /** The browser has no orientation events, or cannot say which way its screen is turned. */
  E_MOTION_UNSUPPORTED:
    "this game is steered by tilting, and this browser cannot read tilt, so no run was started; play it on a phone or tablet in a current browser",
  /**
   * The player did not allow tilt, or was asked outside a tap. iOS remembers
   * the refusal for the site and answers every later request with it without
   * asking, until the site's data is cleared in the browser's settings.
   */
  E_MOTION_DENIED:
    "this game is steered by tilting, and tilt was not allowed, so no run was started; tap Play and allow it, or if the browser does not ask again, clear this site's data in the browser's settings and reload the page",
  /** The page's own permissions policy keeps the motion sensors from the game. */
  E_MOTION_BLOCKED:
    "this game is steered by tilting, and this page does not allow the motion sensors, so no run was started; only the page's owner can change that, so tell the game's studio",
  /** No reading arrived: a laptop or a desktop, or a device whose browser keeps its sensors from the site. */
  E_MOTION_NO_SENSOR:
    "this game is steered by tilting, and no tilt reading came from this device, so no run was started; play it on a phone or tablet, with motion sensors allowed for this site in the browser's settings",
  /**
   * The browser has no Web Locks, so it cannot keep a run to one tab: Safari
   * before 15.4, or a page that is not https. Nothing was started.
   */
  E_BROWSER_UNSUPPORTED:
    "this browser cannot keep a run to one tab; play on an https page in Safari 15.4 or later, or another current browser",
  /**
   * Another tab or window of this browser is playing this game in this mode,
   * so nothing was started: a start would close its run.
   */
  E_RUN_OPEN_ELSEWHERE:
    "a run of this game in this mode is being played in another tab or window; finish it there first",
  /** The run's replay covers no ticks, so there is nothing to show. */
  E_NOTHING_TO_WATCH: "the run has nothing to replay",
  /**
   * `playLocal` was handed a contract-1 module, which cannot say its tick
   * rate or its config, and stops every run at its manifest's step limit.
   */
  E_LOCAL_PLAY_UNSUPPORTED:
    "the game's page module was built by a release of @vbz-gg/sdk from before local play; build it again with a current one",
  /**
   * `playLocal` was given no config, and the game declares a setting that is
   * required and has no default, so there is none to serve.
   */
  E_CONFIG_REQUIRED:
    "the game declares a setting with no default, so a local run needs the page to give it a config",
  /**
   * The engine's code for a presentation that cannot get ready to draw on
   * this device, such as a renderer that finds no GPU it can use. A page
   * gets the game ready before it asks for a run, so nothing was started.
   */
  E_PRESENTATION_FAILED:
    "this game cannot draw on this device, so no run was started; try a current browser on another device, or tell the game's studio",
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

/** Every refusal a page module's `requestMotion` can answer. */
type MotionRefusalCode = Extract<
  Awaited<ReturnType<PageModule["requestMotion"]>>,
  { readonly granted: false }
>["code"]

/**
 * Fails to compile when a page module can report a code this table does not
 * explain: a problem or a mount failure of its own, or a refusal of tilt,
 * which `playRun` fails a run with. So every code a run fails with outside
 * the engine's mount errors and the platform's own is one a page can look up
 * here.
 */
type FromTheModule =
  | PageModuleProblemCode
  | (typeof MOUNT_ERROR)[keyof typeof MOUNT_ERROR]
  | MotionRefusalCode
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
