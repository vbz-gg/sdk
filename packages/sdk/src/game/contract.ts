/**
 * The contract between a game's page module and the page that loads it.
 *
 * A studio's page and the game's page module are built at different times,
 * often against different releases of this package. The page module carries
 * its own engine and its own copy of `./game`, and the page carries neither:
 * it imports the module by URL and drives it through what is declared here.
 * So everything that crosses is plain data - numbers, strings, arrays and
 * objects of them, and functions to call - and nothing is recognised by
 * `instanceof`, because the page and the module do not share a class.
 *
 * `contract` names the version of this shape a module speaks. A release of
 * this package drives every contract version an earlier release drove, and a
 * page refuses a module speaking one it does not know rather than misreading
 * it.
 *
 * Types and two constants only. The page's side imports this file and no
 * other part of `./game`, so a studio's page bundles no engine.
 */

import type {
  ErrorCode,
  InputEvent,
  PlainValue,
  PresentationContext,
  Recording,
  TerminalReason,
} from "@clockwork2/engine"
import type {
  CaptureEnvironment,
  DeviceNotice,
  MotionAccess,
  Scheduler,
} from "@clockwork2/engine/host"

/** The contract version a page module built with this release speaks. */
export const PAGE_MODULE_CONTRACT = 1

/**
 * Every contract version a page on this release can drive, oldest first. A
 * release adds to this and never removes from it.
 */
export const DRIVEN_CONTRACTS: readonly number[] = [1]

/** Why a page module's own check found it unfit to play, by kind. */
export const PAGE_MODULE_PROBLEM = {
  /** The manifest declares a data pack the rules code reads. */
  PACKS: "E_SIM_PACKS",
  /** The input mapping names something the manifest does not allow. */
  CAPTURE: "E_CAPTURE_INVALID",
  /** The module's own parts disagree, or one of them failed. */
  MODULE: "E_GAME_MODULE_INVALID",
} as const

export type PageModuleProblemCode =
  (typeof PAGE_MODULE_PROBLEM)[keyof typeof PAGE_MODULE_PROBLEM]

export interface PageModuleProblem {
  readonly code: PageModuleProblemCode
  readonly message: string
}

/**
 * The codes a mount reports that are not the engine's own. Anything the
 * engine throws arrives with its own code, read by its mark rather than by
 * its class.
 */
export const MOUNT_ERROR = {
  /** The run expects another version of the game than this module is. */
  WRONG_GAME: "E_WRONG_GAME",
  /** The run's tick rate is not 30, 60 or 120. */
  TICK_RATE_UNSUPPORTED: "E_TICK_RATE_UNSUPPORTED",
  /** Something with no code failed: a bug in the game, with its message. */
  UNEXPECTED: "E_UNEXPECTED",
} as const

export type MountErrorCode =
  | (typeof MOUNT_ERROR)[keyof typeof MOUNT_ERROR]
  | ErrorCode

/** A failure, as plain data. */
export interface MountError {
  readonly code: MountErrorCode
  readonly message: string
}

export interface MountedCheckpoint {
  readonly tick: number
  readonly hash: string
}

/** After each frame the page drew. */
export interface MountedFrame {
  /** The tick the session reached. */
  readonly tick: number
  /** What the game's counters read, as evidence for a chunk. Never ranked. */
  readonly counters: Readonly<Record<string, number>>
}

export interface MountedEnd {
  /** How many ticks ran. */
  readonly tick: number
  readonly reason: TerminalReason
  readonly counters: Readonly<Record<string, number>>
  /** The whole recording, as the engine writes it: what a submit sends. */
  readonly recording: Recording
}

export interface MountHandlers {
  onCheckpoint(checkpoint: MountedCheckpoint): void
  onFrame(frame: MountedFrame): void
  /** Once, when the run ends, however it ends. Capture has stopped by then. */
  onEnded(ended: MountedEnd): void
  /** Once, for a failure that ends the run, or for a mount refused outright. */
  onError(error: MountError): void
  /**
   * Something to tell the player that does not stop the run: a blocked
   * gamepad, a refused mouse lock. Required when the game's mapping reads a
   * gamepad or locks the mouse, as the engine requires it.
   */
  onNotice?(notice: DeviceNotice): void
}

export type MountMode = "play" | "watch"

export interface MountOptions {
  /** `play` records the player; `watch` replays `inputs` and records nothing. */
  readonly mode: MountMode
  readonly seed: string
  readonly config: PlainValue
  /** The run's tick rate, which must be the module's own. */
  readonly tickHz: number
  /** Where the run stops at the latest; at most the manifest's own cap. */
  readonly maxTicks: number
  /** The run's recorded inputs, for `watch`. */
  readonly inputs?: readonly InputEvent[]
  /** What the run was issued for, checked before anything is built. */
  readonly expect: { readonly manifestHash: string }
  readonly handlers: MountHandlers
  /** For the presentation. `devicePixelRatio` defaults to the window's. */
  readonly presentationContext?: Partial<PresentationContext>
  /** For a test: the frame clock. The browser's animation frames by default. */
  readonly scheduler?: Scheduler
  /** For a test: the devices. The browser's own by default. */
  readonly environment?: CaptureEnvironment
}

/** What a mount hands back. Every method is safe to call after the run ends. */
export interface MountHandle {
  /** The inputs recorded so far, in order: the run's log. Read it, never write it. */
  recorded(): readonly InputEvent[]
  /** Ends the run where it stands: `abandoned` for a player who left. */
  stop(reason?: TerminalReason): void
  /** Stops the run, takes the presentation down and stops listening. */
  destroy(): void
}

/** What a page module's default export is. */
export interface PageModule {
  readonly contract: number
  /** The engine's canonical hash of the module's manifest. */
  readonly manifestHash: string
  /** Whether the game reads tilt, so a page asks for motion in the click. */
  readonly needsMotion: boolean
  /** Every reason the module cannot be played, or an empty list. Never throws. */
  check(): readonly PageModuleProblem[]
  /** The engine's `requestMotion`, from the module's own engine. Call it in the click. */
  requestMotion(): Promise<MotionAccess>
  /**
   * Plays a run in `element`, which the presentation fills, so a pointer's
   * position across the element is its position across the game.
   */
  mount(element: HTMLElement, options: MountOptions): MountHandle
}
