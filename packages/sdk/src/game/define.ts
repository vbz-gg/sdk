/**
 * A game's page module: its presentation, its input mapping and the host that
 * plays them, behind the contract in `contract.ts`.
 *
 * This file is bundled into every page module, with the game's own engine, so
 * the engine that plays a run on a studio's page is always the one the game
 * was built and checked with. The page never builds a `GameHost`: it imports
 * the module and calls `mount`.
 *
 * Nothing here touches the browser when the module loads, and nothing here
 * imports anything by a computed name, because the platform refuses a page
 * module with a dynamic import before it stores a byte.
 */

import {
  type GameModule,
  hashCanonical,
  isClockworkError,
  type Manifest,
  type PlainValue,
  type Presentation,
  type PresentationContext,
  RecordedInputSource,
} from "@clockwork2/engine"
import {
  type CaptureMapping,
  checkCapture,
  GameHost,
  InputCapture,
  requestMotion,
} from "@clockwork2/engine/host"
import { TICK_RATES } from "@clockwork2/engine/manifest"
import {
  MOUNT_ERROR,
  type MountError,
  type MountErrorCode,
  type MountHandle,
  type MountOptions,
  PAGE_MODULE_CONTRACT,
  PAGE_MODULE_PROBLEM,
  type PageModule,
  type PageModuleProblem,
} from "./contract.js"

/** What a game's page module entry hands `definePageModule`. */
export interface PageModuleParts<TView, TConfig> {
  /** The rules code's default export: a fresh game per call. */
  readonly createGame: () => GameModule<TView, TConfig>
  /** The rules code's `MANIFEST`. */
  readonly manifest: Manifest
  /**
   * A fresh presentation per call. It must fill the element it is mounted
   * in, stretched the same way on both axes, because a pointer's position is
   * measured across that element.
   */
  readonly createPresentation: () => Presentation<TView, HTMLElement>
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
    check: () => problemsOf(parts, manifestHash),
    requestMotion: () => requestMotion(),
    mount: (element, options) => mount(parts, manifestHash, element, options),
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
  if ((parts.manifest.assets ?? []).some((asset) => asset.requiredForSim)) {
    problems.push({
      code: PAGE_MODULE_PROBLEM.PACKS,
      message:
        "the manifest declares a data pack the rules code reads, which the platform cannot store or replay yet",
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
function inert(options: MountOptions): MountHandle {
  return {
    recorded: () => options.inputs ?? [],
    stop: () => {},
    destroy: () => {},
  }
}

function mount<TView, TConfig>(
  parts: PageModuleParts<TView, TConfig>,
  manifestHash: string,
  element: HTMLElement,
  options: MountOptions,
): MountHandle {
  const { handlers } = options
  const { manifest } = parts
  const refuse = (code: MountErrorCode, message: string): MountHandle => {
    handlers.onError({ code, message })
    return inert(options)
  }

  if (options.expect.manifestHash !== manifestHash) {
    return refuse(
      MOUNT_ERROR.WRONG_GAME,
      `this page module is manifest ${manifestHash}, and the run was issued for ${options.expect.manifestHash}`,
    )
  }
  if (!TICK_RATES.some((rate) => rate === options.tickHz)) {
    return refuse(
      MOUNT_ERROR.TICK_RATE_UNSUPPORTED,
      `the run's tick rate is ${options.tickHz}`,
    )
  }
  if (options.tickHz !== manifest.session.tickHz) {
    return refuse(
      MOUNT_ERROR.WRONG_GAME,
      `the run ticks at ${options.tickHz} Hz and this game at ${manifest.session.tickHz}`,
    )
  }
  if (!Number.isSafeInteger(options.maxTicks) || options.maxTicks < 1) {
    return refuse(
      "E_ARG_INVALID",
      `maxTicks must be a whole number above 0, not ${options.maxTicks}`,
    )
  }
  if (options.mode === "watch" && options.inputs === undefined) {
    return refuse("E_ARG_INVALID", "watching a run needs the run's inputs")
  }

  let capture: InputCapture | null = null
  const release = (): void => {
    capture?.detach()
    capture = null
  }

  let host: GameHost<TView, HTMLElement, TConfig>
  try {
    host = new GameHost<TView, HTMLElement, TConfig>({
      module: parts.createGame(),
      manifest,
      seed: options.seed,
      config: options.config as TConfig,
      presentation: parts.createPresentation(),
      container: element,
      // One a second of play, which is where the platform's replay compares
      // them. A fixed count is right at one tick rate only.
      checkpointEvery: manifest.session.tickHz,
      maxTicks: Math.min(options.maxTicks, manifest.session.maxTicks),
      presentationContext: contextFor(element, options.presentationContext),
      ...(options.scheduler === undefined
        ? {}
        : { scheduler: options.scheduler }),
      ...(options.mode === "watch"
        ? { inputs: new RecordedInputSource(options.inputs ?? []) }
        : {}),
      onCheckpoint: (checkpoint) =>
        handlers.onCheckpoint({ tick: checkpoint.tick, hash: checkpoint.hash }),
      onFrame: (frame) =>
        handlers.onFrame({
          tick: frame.tick,
          counters: { ...host.counters() },
        }),
      onEnded: (result) => {
        release()
        handlers.onEnded({
          tick: result.endTick,
          reason: result.terminal,
          counters: { ...result.counters },
          recording: host.recording(options.inputs),
        })
      },
      onError: (error) => {
        release()
        handlers.onError(mountErrorOf(error))
      },
    })
  } catch (error) {
    handlers.onError(mountErrorOf(error))
    return inert(options)
  }

  const live = host.live
  try {
    // A replay has no live queue, so a key pressed by somebody watching has
    // nowhere to go.
    if (live !== null) {
      capture = new InputCapture({
        ...parts.capture,
        manifest,
        queue: live,
        element,
        ...(handlers.onNotice === undefined
          ? {}
          : { onNotice: (notice) => handlers.onNotice?.(notice) }),
        ...(options.environment === undefined
          ? {}
          : { environment: options.environment }),
      })
      capture.attach()
    }
    host.start()
  } catch (error) {
    release()
    host.destroy()
    handlers.onError(mountErrorOf(error))
    return inert(options)
  }

  return {
    recorded: () => live?.recorded() ?? options.inputs ?? [],
    stop: (reason = "abandoned") => host.stop(reason),
    destroy: () => {
      release()
      host.destroy()
    },
  }
}
