/**
 * One platform run on a studio's page: started in the click, played through
 * the game's own page module, and driven to its result by `Run`.
 *
 * The page loads the module the next start will play with `loadGame` before
 * the click, from `GET /v1/game`, so the click itself awaits nothing before
 * it has asked for what only a tap can ask for. The platform says which
 * version each run plays, and the page never chooses: a resumed run plays the
 * version it started on, and that module is loaded here when its manifest
 * hash is not the one the page had.
 */

import type { MotionAccess } from "@clockwork2/engine/host"
import type { PageKey, RunMode } from "../api/index.js"
import type {
  MountError,
  MountHandlers,
  PreparedGame,
} from "../game/contract.js"
import type { PlatformClient } from "../platform/client.js"
import { CLIENT_ERROR, PlatformClientError } from "../platform/errors.js"
import {
  RUN_PHASE,
  Run,
  type RunPhase,
  type RunState,
} from "../platform/run.js"
import { focusGame } from "./focus.js"
import { type GameAddress, type LoadedGame, loadGame } from "./load.js"
import { motionRefusal } from "./motion.js"

/** What `playRun` needs of the browser's Web Locks, for a test to stand in for. */
export interface RunLocks {
  request(
    name: string,
    options: { readonly ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | undefined,
  ): Promise<unknown>
}

export interface PlayOptions {
  readonly client: Pick<
    PlatformClient,
    "pageKey" | "startRun" | "sendChunk" | "submit" | "awaitResult"
  >
  /**
   * The module `loadGame` loaded before the click: the version `GET /v1/game`
   * names for `mode`.
   */
  readonly game: LoadedGame
  readonly mode: RunMode
  readonly onState?: (state: RunState) => void
  /** Something about a device to tell the player, which stops nothing. */
  readonly onNotice?: MountHandlers["onNotice"]
  /** The game element's label, for a screen reader. */
  readonly title?: string
  /** For a test: loads a run's own module. `loadGame` by default. */
  readonly load?: (address: GameAddress) => Promise<LoadedGame>
  /**
   * For a test: the browser's Web Locks, `navigator.locks` by default, or
   * null for a browser that has none.
   */
  readonly locks?: RunLocks | null
  /** For a test: seconds of play between chunks. */
  readonly chunkSeconds?: number
}

export interface PlayedRun {
  readonly run: Run
  /**
   * The module the run plays: the one given, until the run turns out to be
   * on another version, and then that version's. After
   * `E_MOTION_NEEDS_TAP` it is the run's own module, for the next tap.
   */
  readonly game: LoadedGame
  /**
   * The answer to the tilt request the click made, or null when none was
   * made. Anything but a grant has already failed the run with its code.
   */
  readonly motion: Promise<MotionAccess> | null
  /** The player leaving: the run ends where it stands, and is submitted. */
  end(): void
  /** Takes everything down, and sends nothing more. */
  destroy(): void
}

/**
 * The lock a page holds from the click until the platform has the run: one
 * per game and mode in a browser, as the platform keeps one open run per
 * player, game and mode. The page key names the game, and the player kept
 * for a page is kept under it too.
 */
export function runLockName(pageKey: PageKey, mode: RunMode): string {
  return `vbz-run:${pageKey}:${mode}`
}

/**
 * The phases the lock is held through. A run is open on the platform until
 * the recording is taken, and a start from another tab before then would
 * close it under its player.
 */
const LOCKED_PHASES: ReadonlySet<RunPhase> = new Set([
  RUN_PHASE.PLAYING,
  RUN_PHASE.SUBMITTING,
])

/**
 * Starts a run in the click and plays it in `element`.
 *
 * Call it from the Play button's click handler. When the game reads tilt it
 * asks for it first, before anything is awaited, because iOS grants it only
 * there; then it asks for the game's lock. Once it holds the lock and tilt
 * is granted, it gets the game ready in `element`, its presentation drawing
 * and its start packs fetched, and only then starts the run, so a device the
 * game cannot draw on spends no run. Every failure arrives as the run's
 * state, with the code that says why: tilt refused or missing
 * (`E_MOTION_DENIED` and the engine's other refusals, each with the client's
 * sentence for the player), another tab playing the game in this mode, a
 * game that cannot draw here (`E_PRESENTATION_FAILED`) or whose packs did
 * not arrive, a start the platform refused, a run module that did not load,
 * or `E_MOTION_NEEDS_TAP` when the run turned out to be on a version that
 * reads tilt the click did not ask for. Then call `playRun` again with
 * `played.game` from the next tap: the same run resumes, and is not counted
 * twice.
 */
export function playRun(element: HTMLElement, options: PlayOptions): PlayedRun {
  let game = options.game
  // A browser that cannot keep a run to one tab starts nothing: two of its
  // tabs on one run would post chunks that conflict, and the platform counts
  // that against the player.
  const locks = options.locks === undefined ? browserLocks() : options.locks
  // First, in the click's own turn, before anything is awaited.
  const motion =
    locks !== null && game.needsMotion ? game.requestMotion() : null
  // Read once the lock is held; a failure meanwhile is kept for then.
  motion?.catch(() => {})
  // Then the lock, and nothing is started until this tab holds it: a second
  // tab's start would close a run the first has committed to and answer a
  // new one, or hand it the same run to post conflicting chunks for.
  const holding =
    locks === null
      ? Promise.reject(new PlatformClientError("E_BROWSER_UNSUPPORTED"))
      : holdLock(locks, runLockName(options.client.pageKey, options.mode))

  let release: (() => void) | null = null
  const unlock = () => {
    release?.()
    release = null
  }
  const run = new Run({
    client: options.client,
    onState: (state) => {
      if (!LOCKED_PHASES.has(state.phase)) unlock()
      options.onState?.(state)
    },
    ...(options.onNotice === undefined ? {} : { onNotice: options.onNotice }),
    ...(options.chunkSeconds === undefined
      ? {}
      : { chunkSeconds: options.chunkSeconds }),
  })
  let stopped = false
  /** The game made ready before the run was asked for, until a run plays it. */
  let prepared: PreparedGame | null = null
  const unprepare = () => {
    prepared?.release()
    prepared = null
  }

  async function begin(): Promise<void> {
    const held = await holding
    if (held === null) throw new PlatformClientError("E_RUN_OPEN_ELSEWHERE")
    release = held
    // The player left while the lock was asked for: nothing is started.
    if (stopped) {
      unlock()
      return
    }
    // The player's answer comes first, so a request that failed spends no
    // run, and neither does a refusal: a game steered by tilt is not played
    // without it.
    const access = await motion
    const refused = access === null ? null : motionRefusal(access)
    if (refused !== null) throw refused
    // Then the game gets ready here, so a device it cannot draw on, or a
    // pack that does not arrive, spends no run either.
    prepared = game.prepare(element)
    const cannot = await prepared.ready
    if (cannot !== null) throw unreadyError(cannot)
    if (stopped) {
      unprepare()
      unlock()
      return
    }
    const started = await options.client.startRun(
      options.mode === "practice" ? { practice: true } : {},
    )
    // The manifest hash names the module; the address of one version can be
    // written more than one way, and the same module is never loaded twice.
    if (started.game.manifestHash !== game.manifestHash) {
      // Another version's run: what was got ready is not its game.
      unprepare()
      game = await (options.load ?? loadGame)({
        presentUrl: started.game.presentUrl,
        manifestHash: started.game.manifestHash,
        filesUrl: started.game.filesUrl,
      })
      if (game.needsMotion && motion === null) {
        throw new PlatformClientError("E_MOTION_NEEDS_TAP")
      }
    }
    if (stopped) {
      unprepare()
      unlock()
      return
    }
    focusGame(element, options.title)
    const own = game
    const ready = prepared
    prepared = null
    // The run's own module, when it is not the one got ready, gets ready
    // inside its mount: its clock starts once it can draw.
    run.play(
      started,
      ready === null
        ? (mountOptions) => own.mount(element, mountOptions)
        : (mountOptions) => ready.mount(mountOptions),
    )
  }

  begin().catch((error: unknown) => {
    unprepare()
    unlock()
    run.refuse(error)
  })

  return {
    run,
    get game() {
      return game
    },
    motion,
    end: () => {
      if (run.current.phase === RUN_PHASE.LOADING) stopped = true
      run.end()
    },
    destroy() {
      stopped = true
      unprepare()
      run.destroy()
      unlock()
    },
  }
}

/**
 * Why a game that could not get ready starts no run, as the run's failure:
 * in the client's own sentence when it has one, such as for
 * `E_PRESENTATION_FAILED`, and in the module's words otherwise.
 */
function unreadyError(failure: MountError): PlatformClientError | MountError {
  return Object.hasOwn(CLIENT_ERROR, failure.code)
    ? new PlatformClientError(failure.code as keyof typeof CLIENT_ERROR, {
        cause: failure.message,
      })
    : failure
}

/**
 * Takes the run's lock if nobody holds it, and hands back what lets it go,
 * or null when another tab or window has it.
 */
function holdLock(locks: RunLocks, name: string): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve(null)
          return undefined
        }
        return new Promise<void>((done) => resolve(() => done()))
      })
      .catch(reject)
  })
}

function browserLocks(): RunLocks | null {
  const scope = globalThis as unknown as {
    readonly navigator?: { readonly locks?: RunLocks }
  }
  return scope.navigator?.locks ?? null
}
