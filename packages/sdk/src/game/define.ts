/**
 * A game's page module: its presentation, its input mapping and the host that
 * plays them, behind the contract in `contract.ts`.
 *
 * This file is bundled into every page module, with the game's own engine, so
 * the engine that plays a run on any page is always the one the game
 * was built and checked with. The page never builds a `GameHost`: it imports
 * the module and calls `prepare` and `mount`.
 *
 * Nothing here touches the browser when the module loads, and nothing here
 * imports anything by a computed name, because `vbz build`, and vbz.gg on an
 * upload, refuse a page module with a dynamic import.
 */

import {
  ClockworkError,
  type GameModule,
  hashCanonical,
  isClockworkError,
  type Manifest,
  type PackBytes,
  PackSet,
  type PlainValue,
  type Presentation,
  type PresentationContext,
  RecordedInputSource,
  RemoteInputFeed,
  seatsOf,
  servedConfig,
  type TerminalReason,
} from "@clockwork2/engine"
import {
  type CaptureMapping,
  checkCapture,
  fetchPackLoader,
  GameHost,
  InputCapture,
  loadPacks,
  type PackLoader,
  requestMotion,
} from "@clockwork2/engine/host"
import { TICK_RATES } from "@clockwork2/engine/manifest"
import {
  MOUNT_ERROR,
  type MountError,
  type MountedRemote,
  type MountHandle,
  type MountOptions,
  PAGE_MODULE_CONTRACT,
  PAGE_MODULE_PROBLEM,
  type PageModule,
  type PageModuleProblem,
  type PreparedGame,
  type PrepareOptions,
  type RunMount,
} from "./contract.js"
import { type GameFiles, gameFiles } from "./files.js"

/** What a game's page module entry hands `definePageModule`. */
export interface PageModuleParts<TView, TConfig> {
  /** The rules code's default export: a fresh game per call. */
  readonly createGame: () => GameModule<TView, TConfig>
  /** The rules code's `MANIFEST`. */
  readonly manifest: Manifest
  /**
   * A fresh presentation per call, given the version's files folder, where
   * its art is. It must fill the element it is mounted in, stretched the same
   * way on both axes, because a pointer's position is measured across that
   * element. A presentation that starts asynchronously, such as one that
   * compiles a WebAssembly renderer, says when it can draw through the
   * engine's `prepare`.
   */
  readonly createPresentation: (
    files: GameFiles,
  ) => Presentation<TView, HTMLElement>
  /**
   * Which keys, pointers, gamepads and tilt drive which declared inputs. Kept
   * in a file that touches no DOM, so `vbz check` can read it.
   */
  readonly capture: CaptureMapping
}

/**
 * The page module, for the entry's default export:
 *
 * ```ts
 * import createGame, { MANIFEST } from "cw2:sim"
 * export default definePageModule({ createGame, manifest: MANIFEST, createPresentation, capture })
 * ```
 */
export function definePageModule<TView, TConfig>(
  parts: PageModuleParts<TView, TConfig>,
): PageModule {
  const { manifest } = parts
  const manifestHash = hashCanonical(manifest as unknown as PlainValue)
  return {
    contract: PAGE_MODULE_CONTRACT,
    manifestHash,
    needsMotion: parts.capture.tilt !== undefined,
    tickHz: manifest.session.tickHz,
    seats: seatsOf(manifest),
    servedConfig: servedOrNull(manifest),
    check: () => problemsOf(parts, manifestHash),
    requestMotion: () => requestMotion(),
    prepare: (element, options) =>
      preparedGame(
        parts,
        manifestHash,
        element,
        getReady(parts, element, options, true),
      ),
    mount: (element, options) => mount(parts, manifestHash, element, options),
  }
}

/**
 * Every declared setting at its default, or null when one is required and
 * has none, which only a page naming a config can play.
 */
function servedOrNull(manifest: Manifest): PlainValue | null {
  try {
    return servedConfig(manifest) as PlainValue
  } catch {
    return null
  }
}

function problemsOf<TView, TConfig>(
  parts: PageModuleParts<TView, TConfig>,
  manifestHash: string,
): PageModuleProblem[] {
  const problems: PageModuleProblem[] = []
  try {
    const carried = parts.createGame().manifest as PlainValue
    if (hashCanonical(carried) !== manifestHash) {
      problems.push({
        code: PAGE_MODULE_PROBLEM.MODULE,
        message:
          "the manifest the page module was given is not the one its rules code carries; pass the rules code's own MANIFEST",
      })
    }
  } catch (error) {
    problems.push({
      code: PAGE_MODULE_PROBLEM.MODULE,
      message: `the rules code's game could not be made or its manifest read: ${String(error)}`,
    })
  }
  try {
    for (const problem of checkCapture(parts.capture, parts.manifest)) {
      problems.push({ code: PAGE_MODULE_PROBLEM.CAPTURE, message: problem })
    }
  } catch (error) {
    problems.push({
      code: PAGE_MODULE_PROBLEM.CAPTURE,
      message: `the input mapping could not be checked: ${String(error)}`,
    })
  }
  return problems
}

/** An engine error by its mark, from whichever copy threw it; anything else by its text. */
export function mountErrorOf(error: unknown): MountError {
  if (isClockworkError(error)) {
    return { code: error.code, message: error.message }
  }
  return { code: MOUNT_ERROR.UNEXPECTED, message: String(error) }
}

function argInvalid(detail: string): MountError {
  return mountErrorOf(new ClockworkError("E_ARG_INVALID", { detail }))
}

function contextFor(
  element: HTMLElement,
  given: Partial<PresentationContext> | undefined,
): PresentationContext {
  return {
    random: given?.random ?? Math.random,
    assets: given?.assets ?? new Map(),
    // A canvas mounted at the engine's default of 1 is blurred on every
    // screen that is not.
    devicePixelRatio:
      given?.devicePixelRatio ??
      element.ownerDocument.defaultView?.devicePixelRatio ??
      1,
    theme: given?.theme ?? "light",
  }
}

/** A handle on a run that never started: every call is safe and does nothing. */
function inert(options: RunMount): MountHandle {
  return {
    remote: null,
    // Read as it arrived: a refused watch may have come with no inputs.
    recorded: () => (options.mode === "watch" ? (options.inputs ?? []) : []),
    stop: () => {},
    destroy: () => {},
  }
}

/** What a run needs of a game that got ready: where its packs come from. */
interface Ready {
  /** Fetches a demand pack from the files folder. */
  readonly loader: PackLoader
  /** The start packs, fetched and checked. */
  readonly packs: ReadonlyMap<string, PackBytes>
}

/**
 * A game getting ready in an element: its presentation mounted and prepared,
 * its start packs fetched and checked. Neither promise rejects.
 */
interface Readiness {
  /** What `PreparedGame.ready` answers: null once ready, or why not. */
  readonly ready: Promise<MountError | null>
  /** The same, carrying what a run needs once it is ready. */
  readonly outcome: Promise<Ready | MountError>
  /** Whether it was asked to draw: a presentation, or none at all. */
  readonly draws: boolean
  /** Null when nothing is drawn. Mounted and prepared once `ready` is null. */
  readonly presentation: Presentation<unknown, HTMLElement> | null
  readonly context: PresentationContext
  /** Takes the presentation down, once. */
  release(): void
}

function isReady(outcome: Ready | MountError): outcome is Ready {
  return "loader" in outcome
}

function getReady<TView, TConfig>(
  parts: PageModuleParts<TView, TConfig>,
  element: HTMLElement,
  options: PrepareOptions,
  draw: boolean,
): Readiness {
  const context = contextFor(element, options.presentationContext)
  let released = false
  let presentation: Presentation<TView, HTMLElement> | null = null
  const release = () => {
    if (released) return
    released = true
    try {
      presentation?.unmount()
    } catch {
      // A presentation that fails to come down has nothing left to say.
    }
  }
  const failed = (error: MountError): Readiness => {
    release()
    return {
      ready: Promise.resolve(error),
      outcome: Promise.resolve(error),
      draws: draw,
      presentation: null,
      context,
      release,
    }
  }

  let files: GameFiles
  try {
    files = gameFiles(options.files)
  } catch (error) {
    return failed(argInvalid(String((error as Error).message ?? error)))
  }
  const loader = fetchPackLoader({
    manifest: parts.manifest,
    url: (pack) => files.url(pack.path),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })

  let drawing: Promise<void> = Promise.resolve()
  if (draw) {
    try {
      presentation = parts.createPresentation(files)
      presentation.mount(element, context)
      drawing = Promise.resolve(presentation.prepare?.(element, context))
    } catch (error) {
      drawing = Promise.reject(error)
    }
  }
  const drawn = drawing.then(
    () => null,
    (error: unknown) =>
      // The engine's own code for a presentation that cannot draw, carrying
      // what the presentation said.
      mountErrorOf(
        new ClockworkError("E_PRESENTATION_FAILED", {
          detail: error instanceof Error ? error.message : String(error),
          cause: error,
        }),
      ),
  )
  const fetched: Promise<Ready | MountError> = loadPacks(
    parts.manifest,
    loader,
    "start",
  )
    .then((packs) => {
      // Checked here as well as when the run's session is built, so a pack
      // whose bytes are wrong is found before a run is asked for.
      PackSet.verify(parts.manifest.assets, packs)
      return { loader, packs }
    })
    .catch((error: unknown) => mountErrorOf(error))
  const outcome = Promise.all([drawn, fetched]).then(([failure, packed]) => {
    const settled = failure ?? packed
    if (!isReady(settled)) release()
    return settled
  })
  return {
    ready: outcome.then((settled) => (isReady(settled) ? null : settled)),
    outcome,
    draws: draw,
    get presentation() {
      return presentation as Presentation<unknown, HTMLElement> | null
    },
    context,
    release,
  }
}

/** What a page may not ask of a run, before anything is built. */
function refusalOf(
  manifest: Manifest,
  manifestHash: string,
  options: RunMount,
  drawn: boolean,
): MountError | null {
  if (options.expect.manifestHash !== manifestHash) {
    return {
      code: MOUNT_ERROR.WRONG_GAME,
      message: `this page module is manifest ${manifestHash}, and the run was issued for ${options.expect.manifestHash}`,
    }
  }
  if (!TICK_RATES.some((rate) => rate === options.tickHz)) {
    return {
      code: MOUNT_ERROR.TICK_RATE_UNSUPPORTED,
      message: `the run's tick rate is ${options.tickHz}`,
    }
  }
  if (options.tickHz !== manifest.session.tickHz) {
    return {
      code: MOUNT_ERROR.WRONG_GAME,
      message: `the run ticks at ${options.tickHz} Hz and this game at ${manifest.session.tickHz}`,
    }
  }
  // The page is built separately from this module, so every field is read
  // as it arrived rather than as its type says.
  const given = options as unknown as Readonly<Record<string, unknown>>
  if (options.mode === "play") {
    const seated = seatsRefusal(seatsOf(manifest), given.seats)
    if (seated !== null) return seated
    if (given.maxTicks !== undefined) {
      return argInvalid(
        "a played run has no step limit; maxTicks is where a watched run stops",
      )
    }
    if (given.draw !== undefined) {
      return argInvalid("a played run is drawn; draw is for a watched run")
    }
    if (options.scripted !== "ignore" && options.scripted !== "record") {
      return argInvalid(
        `scripted must be "ignore" or "record", not ${JSON.stringify(given.scripted)}: say whether an event a script made is recorded`,
      )
    }
    return null
  }
  if (options.mode !== "watch") {
    return argInvalid(
      `mode must be "play" or "watch", not ${JSON.stringify(given.mode)}`,
    )
  }
  if (given.seats !== undefined) {
    return {
      code: MOUNT_ERROR.SEATS_UNEXPECTED,
      message:
        "a watched run replays its recording's merged log, every seat's inputs, and takes no seats",
    }
  }
  if (!Array.isArray(given.inputs)) {
    return argInvalid("watching a run needs the run's inputs")
  }
  if (!Number.isSafeInteger(options.maxTicks) || options.maxTicks < 1) {
    return argInvalid(
      `maxTicks must be a whole number above 0, where the watched run stops, not ${String(given.maxTicks)}`,
    )
  }
  if (given.draw !== undefined && typeof given.draw !== "boolean") {
    return argInvalid(
      `draw must be true or false, not ${JSON.stringify(given.draw)}`,
    )
  }
  // `prepare` always draws, and `mount` with `draw: false` gets a game
  // ready without drawing for that run alone, so the one mismatch a page can
  // make is a prepared game watched without drawing.
  if ((options.draw ?? true) !== drawn) {
    return argInvalid(
      "this game was prepared to draw, so it cannot be watched with draw: false",
    )
  }
  return null
}

/**
 * What a played run's `seats` may not be, for a game of `seats` seats: given
 * for a game of one, missing for a game of more, or not a seat it has.
 */
function seatsRefusal(seats: number, given: unknown): MountError | null {
  if (given === undefined) {
    if (seats === 1) return null
    return {
      code: MOUNT_ERROR.SEATS_REQUIRED,
      message: `this game has ${seats} seats, so a played run says which one this page plays in seats.local, or null to follow the match`,
    }
  }
  if (seats === 1) {
    return {
      code: MOUNT_ERROR.SEATS_UNEXPECTED,
      message: "this game has one seat, so a played run takes no seats",
    }
  }
  if (typeof given !== "object" || given === null) {
    return argInvalid(
      `seats must be { local, onLocalInputs }, not ${JSON.stringify(given)}`,
    )
  }
  const { local, onLocalInputs } = given as Readonly<Record<string, unknown>>
  if (
    local !== null &&
    !(
      Number.isInteger(local) &&
      (local as number) >= 0 &&
      (local as number) < seats
    )
  ) {
    return argInvalid(
      `seats.local must be null or a seat from 0 to ${seats - 1}, not ${JSON.stringify(local)}`,
    )
  }
  if (onLocalInputs !== undefined && typeof onLocalInputs !== "function") {
    return argInvalid("seats.onLocalInputs must be a function")
  }
  if (local === null && onLocalInputs !== undefined) {
    return argInvalid(
      "seats.onLocalInputs is for a page that plays a seat; a page that follows the match records nothing to send",
    )
  }
  return null
}

/**
 * Where a page hands the run the other seats' inputs: the engine's feed,
 * with every refusal answered as plain data rather than thrown.
 */
function remoteOf(feed: RemoteInputFeed): MountedRemote {
  const attempt = (call: () => void): MountError | null => {
    try {
      call()
      return null
    } catch (error) {
      return mountErrorOf(error)
    }
  }
  return {
    append: (events) => attempt(() => feed.append(events)),
    confirm: (throughTick) => attempt(() => feed.confirm(throughTick)),
  }
}

/** `prepare` and the prepared game's `mount`, in one call. */
function mount<TView, TConfig>(
  parts: PageModuleParts<TView, TConfig>,
  manifestHash: string,
  element: HTMLElement,
  options: MountOptions,
): MountHandle {
  const draw = options.mode === "play" || options.draw !== false
  // Refused first, so a run the page got wrong mounts nothing at all.
  const refused = refusalOf(parts.manifest, manifestHash, options, draw)
  if (refused !== null) {
    options.handlers.onError(refused)
    return inert(options)
  }
  const prepared = preparedGame(
    parts,
    manifestHash,
    element,
    getReady(parts, element, options, draw),
  )
  return prepared.mount(options)
}

function preparedGame<TView, TConfig>(
  parts: PageModuleParts<TView, TConfig>,
  manifestHash: string,
  element: HTMLElement,
  readiness: Readiness,
): PreparedGame {
  let mounted: MountHandle | null = null
  return {
    ready: readiness.ready,
    mount(options) {
      if (mounted !== null) {
        options.handlers.onError(
          argInvalid(
            "a prepared game plays one run; prepare it again for another",
          ),
        )
        return inert(options)
      }
      const refused = refusalOf(
        parts.manifest,
        manifestHash,
        options,
        readiness.draws,
      )
      if (refused !== null) {
        options.handlers.onError(refused)
        return inert(options)
      }
      mounted = runOnceReady(parts, element, readiness, options)
      return mounted
    },
    release() {
      mounted?.destroy()
      readiness.release()
    },
  }
}

/**
 * Plays `options` in `element` once the game is ready: the host is built,
 * the devices attached and the clock started only then, so no tick runs and
 * nothing is recorded before the game can be drawn.
 */
function runOnceReady<TView, TConfig>(
  parts: PageModuleParts<TView, TConfig>,
  element: HTMLElement,
  readiness: Readiness,
  options: RunMount,
): MountHandle {
  const { handlers } = options
  const { manifest } = parts
  let host: GameHost<TView, HTMLElement, TConfig> | null = null
  let capture: InputCapture | null = null
  let stopping: TerminalReason | null = null
  let destroyed = false
  // Made with the run rather than with its host, so the other seats' inputs
  // that arrive while the game gets ready are kept for its first ticks.
  const seated = options.mode === "play" ? options.seats : undefined
  const feed =
    seated === undefined ? null : new RemoteInputFeed(manifest.inputs)

  const release = (): void => {
    capture?.detach()
    capture = null
  }

  /** The presentation as `prepare` left it: mounted and ready to draw. */
  const shown = readiness.presentation
  const presentation: Presentation<TView, HTMLElement> | undefined =
    shown === null
      ? undefined
      : {
          mount: () => {},
          render: (view, previous, alpha, dtMs) =>
            shown.render(view, previous, alpha, dtMs),
          unmount: () => readiness.release(),
        }

  const start = (ready: Ready): void => {
    let built: GameHost<TView, HTMLElement, TConfig>
    try {
      built = new GameHost<TView, HTMLElement, TConfig>({
        module: parts.createGame(),
        manifest,
        seed: options.seed,
        config: options.config as TConfig,
        ...(presentation === undefined
          ? {}
          : { presentation, container: element }),
        // One a second of play, which is where the platform's replay compares
        // them. A fixed count is right at one tick rate only.
        checkpointEvery: manifest.session.tickHz,
        presentationContext: readiness.context,
        packs: { preloaded: ready.packs, loader: ready.loader },
        ...(options.scheduler === undefined
          ? {}
          : { scheduler: options.scheduler }),
        ...(options.mode === "watch"
          ? {
              inputs: new RecordedInputSource(options.inputs),
              maxTicks: options.maxTicks,
            }
          : {}),
        ...(seated === undefined || feed === null
          ? {}
          : {
              seats: {
                local: seated.local,
                remote: feed,
                ...(seated.onLocalInputs === undefined
                  ? {}
                  : { onLocalInputs: seated.onLocalInputs }),
              },
            }),
        onCheckpoint: (checkpoint) =>
          handlers.onCheckpoint({
            tick: checkpoint.tick,
            hash: checkpoint.hash,
          }),
        onFrame: (frame) =>
          handlers.onFrame({
            tick: frame.tick,
            counters: { ...built.counters() },
            waitingForSeat: frame.waitingForSeat,
          }),
        onEnded: (result) => {
          release()
          handlers.onEnded({
            tick: result.endTick,
            reason: result.terminal,
            counters: { ...result.counters },
            recording: built.recording(
              options.mode === "watch" ? options.inputs : undefined,
            ),
          })
        },
        onError: (error) => {
          release()
          handlers.onError(mountErrorOf(error))
        },
      })
    } catch (error) {
      readiness.release()
      handlers.onError(mountErrorOf(error))
      return
    }
    host = built
    // Stopped while it got ready: it ends at tick 0, and says so.
    if (stopping !== null) {
      built.stop(stopping)
      return
    }
    const live = built.live
    try {
      // A replay has no live queue, so a key pressed by somebody watching has
      // nowhere to go.
      if (live !== null && options.mode === "play") {
        capture = new InputCapture({
          ...parts.capture,
          manifest,
          queue: live,
          element,
          scripted: options.scripted,
          ...(handlers.onNotice === undefined
            ? {}
            : {
                onNotice: (notice) => {
                  handlers.onNotice?.(notice)
                },
              }),
          ...(options.environment === undefined
            ? {}
            : { environment: options.environment }),
        })
        capture.attach()
      }
      // Ready already, so the clock starts before this returns.
      void built.start()
    } catch (error) {
      release()
      built.destroy()
      readiness.release()
      handlers.onError(mountErrorOf(error))
    }
  }

  void readiness.outcome.then((outcome) => {
    if (destroyed) return
    if (!isReady(outcome)) {
      handlers.onError(outcome)
      return
    }
    start(outcome)
  })

  return {
    remote: feed === null ? null : remoteOf(feed),
    recorded: () => {
      if (host === null) return options.mode === "watch" ? options.inputs : []
      // A seated run's log is the merged one, which only the host keeps.
      if (feed !== null) return host.recording().inputs
      return (
        host.live?.recorded() ??
        (options.mode === "watch" ? options.inputs : [])
      )
    },
    stop: (reason = "abandoned") => {
      if (host !== null) host.stop(reason)
      else stopping ??= reason
    },
    destroy: () => {
      destroyed = true
      release()
      host?.destroy()
      readiness.release()
    },
  }
}
