/**
 * The contract between a game's page module and the page that loads it.
 *
 * A page and the game's page module are built at different times,
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
 * Types and a few constants only. The page's side imports this file and no
 * other part of `./game`, so a page bundles no engine.
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
  ScriptedEvents,
} from "@clockwork2/engine/host"

/** The contract version a page module built with this release speaks. */
export const PAGE_MODULE_CONTRACT = 2

/**
 * Every contract version a page on this release can drive, oldest first. A
 * release adds to this and never removes from it.
 *
 * Contract 1 is driven as it was built: its module stops a run at its own
 * manifest's step limit, whatever the page passes, takes no files folder and
 * no word on scripted events, and cannot be prepared before a run starts.
 * Contract 2 has no step limit, says its tick rate and its served config,
 * fetches its data packs from its files folder, and can be prepared, so a
 * device that cannot draw it spends no run.
 */
export const DRIVEN_CONTRACTS: readonly number[] = [1, 2]

/** Why a page module's own check found it unfit to play, by kind. */
export const PAGE_MODULE_PROBLEM = {
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

/** What every run a page mounts says, whether it is played or watched. */
interface RunMountBase {
  readonly seed: string
  readonly config: PlainValue
  /** The run's tick rate, which must be the module's own. */
  readonly tickHz: number
  /** What the run was issued for, checked before anything is built. */
  readonly expect: { readonly manifestHash: string }
  readonly handlers: MountHandlers
  /** For a test: the frame clock. The browser's animation frames by default. */
  readonly scheduler?: Scheduler
  /** For a test: the devices. The browser's own by default. */
  readonly environment?: CaptureEnvironment
}

/**
 * A run the player plays. It has no step limit: it runs until the game ends
 * it or the page stops it.
 */
export interface PlayMount extends RunMountBase {
  readonly mode: "play"
  /**
   * Whether the device helpers record an event a script dispatched, the
   * engine's `InputCaptureOptions.scripted`. A ranked or practice run takes
   * its inputs from the player's devices alone, so `playRun` always passes
   * `"ignore"`; a game played on its own page may pass `"record"` to drive
   * itself from a test or a tool.
   */
  readonly scripted: ScriptedEvents
}

/** A recorded run played back. Nothing is recorded, and no device is heard. */
export interface WatchMount extends RunMountBase {
  readonly mode: "watch"
  /** The run's recorded inputs. */
  readonly inputs: readonly InputEvent[]
  /**
   * Where the replay stops: `Math.max(endTick, 1)` of the run it replays,
   * which is where the platform's replay stopped too, so an abandoned run
   * ends where its player left it.
   */
  readonly maxTicks: number
  /**
   * `false` builds no presentation, so nothing is drawn and the run's
   * checkpoints are all it reports. For a browser that cannot draw the game,
   * such as the platform's page-module check. Drawn by default.
   */
  readonly draw?: boolean
}

/** A run, as a page hands it to a loaded game: played or watched. */
export type RunMount = PlayMount | WatchMount

/** What a module needs to get a game ready to play in an element. */
export interface PrepareOptions {
  /**
   * The version's files folder, absolute and ending in `/`: where the
   * presentation finds its art and the engine fetches the data packs.
   */
  readonly files: string
  /** For the presentation. `devicePixelRatio` defaults to the window's. */
  readonly presentationContext?: Partial<PresentationContext>
  /** For a test: fetches a data pack. The browser's `fetch` by default. */
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>
}

/** What a page module's own `mount` takes: the run, and how to get ready for it. */
export type MountOptions = RunMount & PrepareOptions

/** What a mount hands back. Every method is safe to call after the run ends. */
export interface MountHandle {
  /** The inputs recorded so far, in order: the run's log. Read it, never write it. */
  recorded(): readonly InputEvent[]
  /**
   * Ends the run where it stands: `abandoned` for a player who left. A run
   * still getting ready ends at tick 0 once it is, so `onEnded` always
   * follows a stop, unless getting ready failed and `onError` came instead.
   */
  stop(reason?: TerminalReason): void
  /** Stops the run, takes the presentation down and stops listening. */
  destroy(): void
}

/**
 * A game made ready in an element before a run is asked for: its
 * presentation mounted and prepared, and its start packs fetched.
 */
export interface PreparedGame {
  /**
   * Settles once the game can be played here: null, or why it cannot, such
   * as the engine's `E_PRESENTATION_FAILED` for a device the presentation
   * cannot draw on. Never rejects.
   */
  readonly ready: Promise<MountError | null>
  /**
   * Plays a run in the prepared element, once. Its clock starts when
   * `ready` settles with null; a failure arrives at `onError` before tick 0.
   */
  mount(options: RunMount): MountHandle
  /** Takes the presentation down, for a page that will not play after all. */
  release(): void
}

/** What a page module's default export is. */
export interface PageModule {
  readonly contract: number
  /** The engine's canonical hash of the module's manifest. */
  readonly manifestHash: string
  /** Whether the game reads tilt, so a page asks for motion in the click. */
  readonly needsMotion: boolean
  /** The game's tick rate: a run must be played at this one. */
  readonly tickHz: number
  /**
   * The engine's `servedConfig`: every setting the manifest declares, at its
   * default. What a platform serves a ranked or practice run, and what a
   * local run plays unless its page says otherwise. Null when the manifest
   * declares a setting that is required and has no default, which only a
   * page that names a config can play.
   */
  readonly servedConfig: PlainValue | null
  /** Every reason the module cannot be played, or an empty list. Never throws. */
  check(): readonly PageModuleProblem[]
  /** The engine's `requestMotion`, from the module's own engine. Call it in the click. */
  requestMotion(): Promise<MotionAccess>
  /**
   * Gets the game ready in `element` before a run is asked for, so a device
   * that cannot draw it, or a pack that cannot be fetched, spends no run.
   */
  prepare(element: HTMLElement, options: PrepareOptions): PreparedGame
  /**
   * Plays a run in `element`, which the presentation fills, so a pointer's
   * position across the element is its position across the game. `prepare`
   * and the prepared game's `mount` in one call: the clock starts once the
   * game is ready.
   */
  mount(element: HTMLElement, options: MountOptions): MountHandle
}

/**
 * What a page passed a contract-1 module's `mount`. A page on this release
 * still drives one, and builds this for it.
 */
export interface ContractOneMountOptions {
  readonly mode: MountMode
  readonly seed: string
  readonly config: PlainValue
  readonly tickHz: number
  /** Where the run stops at the latest; the module clamps it to its manifest's cap. */
  readonly maxTicks: number
  readonly inputs?: readonly InputEvent[]
  readonly expect: { readonly manifestHash: string }
  readonly handlers: MountHandlers
  readonly presentationContext?: Partial<PresentationContext>
  readonly scheduler?: Scheduler
  readonly environment?: CaptureEnvironment
}

/** What a contract-1 module's default export is. */
export interface ContractOnePageModule {
  readonly contract: 1
  readonly manifestHash: string
  readonly needsMotion: boolean
  check(): readonly PageModuleProblem[]
  requestMotion(): Promise<MotionAccess>
  mount(element: HTMLElement, options: ContractOneMountOptions): MountHandle
}
