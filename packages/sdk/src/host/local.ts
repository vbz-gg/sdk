/**
 * A game played on a page with no platform at all: a story, free play, an
 * endless session, a page that is never online.
 *
 * It is the same game build a ranked run plays, loaded with `loadGame` and
 * played through the module's own `mount`. It asks nothing of the platform:
 * no client, no page key, no sign-in, no lock across tabs and no request,
 * and it hands the page the run's recording when the run ends.
 *
 * A local run can never pass for a ranked or practice run. Its seed always
 * starts `local:`, and every seed the platform issues is 64 hex characters,
 * so the platform refuses its recording as one played on a seed it did not
 * pin; and its recording has a type of its own, which the platform client's
 * submit does not take.
 */

import type { InputEvent, PlainValue, Recording } from "@clockwork2/engine"
import type {
  CaptureEnvironment,
  MotionAccess,
  Scheduler,
  ScriptedEvents,
} from "@clockwork2/engine/host"
import type {
  MountError,
  MountedEnd,
  MountHandle,
  MountHandlers,
} from "../game/contract.js"
import {
  type ClientErrorCode,
  PlatformClientError,
} from "../platform/errors.js"
import { focusGame } from "./focus.js"
import type { GameAddress, LoadedGame, PagePrepareOptions } from "./load.js"
import { motionRefusal } from "./motion.js"

/** What every local run's seed starts with. */
export const LOCAL_SEED_PREFIX = "local:"

/**
 * A local run's recording. The brand exists at compile time alone: the
 * platform client's `submit` takes a platform run's own recording, which a
 * local one is not.
 */
export type LocalRecording = Recording & {
  readonly "vbz:local-recording": true
}

/** How a local run ended, with its recording. */
export interface LocalEnd extends Omit<MountedEnd, "recording"> {
  readonly recording: LocalRecording
}

/** Why a local run did not start, or stopped: the module's code, or the client's. */
export interface LocalError {
  readonly code: MountError["code"] | ClientErrorCode
  readonly message: string
}

export interface LocalPlayOptions {
  /** The module `loadGame` loaded. It has to speak contract 2 or later. */
  readonly game: LoadedGame
  /**
   * A seed of the page's own, for a course it wants again; a fresh one by
   * default. Either way the run plays `local:` and it, so it is never one
   * the platform issued.
   */
  readonly seed?: string
  /**
   * The config to play: the module's served config, every declared setting
   * at its default, unless the page names another.
   */
  readonly config?: PlainValue
  /**
   * Whether the device helpers record an event a script dispatched, the
   * engine's switch: `"ignore"` hears the player's devices alone, as a ranked
   * run does; `"record"` lets a page drive its game from a script.
   */
  readonly scripted: ScriptedEvents
  /** Once, when the run ends, with its recording. */
  readonly onEnded: (ended: LocalEnd) => void
  /**
   * Once, for a run that did not start, such as a tilt game without tilt, or
   * one that stopped on a failure.
   */
  readonly onError?: (error: LocalError) => void
  readonly onFrame?: MountHandlers["onFrame"]
  readonly onCheckpoint?: MountHandlers["onCheckpoint"]
  /** Something about a device to tell the player, which stops nothing. */
  readonly onNotice?: MountHandlers["onNotice"]
  /** The game element's label, for a screen reader. */
  readonly title?: string
  readonly presentationContext?: PagePrepareOptions["presentationContext"]
  /** For a test: the frame clock. */
  readonly scheduler?: Scheduler
  /** For a test: the devices. */
  readonly environment?: CaptureEnvironment
  /** For a test: fetches a data pack. */
  readonly fetch?: PagePrepareOptions["fetch"]
  /** For a test: a fresh seed. 128 random bits from the browser by default. */
  readonly freshSeed?: () => string
}

export interface LocalRun {
  /** The seed the run plays: `local:` and the page's seed or a fresh one. */
  readonly seed: string
  readonly config: PlainValue
  /**
   * The answer to the tilt request the call made, or null when none was
   * made. Anything but a grant has already reached `onError`.
   */
  readonly motion: Promise<MotionAccess> | null
  /** The inputs recorded so far. */
  recorded(): readonly InputEvent[]
  /** The player leaving: the run ends where it stands, and `onEnded` follows. */
  end(): void
  /** Takes everything down, and reports nothing more. */
  destroy(): void
}

/**
 * `dist/game.json`, which `vbz build` writes beside the build so a page can
 * load it from a plain static host, `dist/` served as it is. Every path is
 * relative to the file itself.
 *
 * The page module imports `cw2:sim` and its files as `cw2:files/<path>`, as
 * built, and the page maps both with an import map naming `sim` and `files`
 * where it serves them, so the page module's bytes are the ones the platform
 * would store before its rewrite.
 */
export interface LocalBuild {
  /** The game's name, from its manifest. */
  readonly name: string
  /** The page module. */
  readonly present: string
  /** The rules code: where the page's import map points `cw2:sim`. */
  readonly sim: string
  /** The manifest as built. */
  readonly manifest: string
  /** The engine's canonical hash of the manifest, which the page module must report. */
  readonly manifestHash: string
  /** The files folder, ending in `/`: where the import map points `cw2:files/`. */
  readonly files: string
  /** The folder's listing. */
  readonly listing: string
  /** The folder's name: the SHA-256 of its listing. */
  readonly filesSha256: string
}

/** The fields of a `LocalBuild`, each a string. */
const LOCAL_BUILD_FIELDS = [
  "name",
  "present",
  "sim",
  "manifest",
  "manifestHash",
  "files",
  "listing",
  "filesSha256",
] as const satisfies ReadonlyArray<keyof LocalBuild>

/**
 * Where the build a `game.json` at `url` describes is, as `loadGame` takes
 * it: its page module, its manifest hash and its files folder, each resolved
 * against the file. Anything that is not what `vbz build` writes is
 * `E_GAME_UNLOADABLE`, naming the field.
 */
export function localAddress(build: unknown, url: string): GameAddress {
  const given =
    typeof build === "object" && build !== null
      ? (build as Readonly<Record<string, unknown>>)
      : {}
  for (const field of LOCAL_BUILD_FIELDS) {
    if (typeof given[field] !== "string") {
      throw new PlatformClientError("E_GAME_UNLOADABLE", {
        cause: {
          url,
          problem: `${field} is not what vbz build writes in game.json`,
        },
      })
    }
  }
  const read = given as unknown as LocalBuild
  return {
    presentUrl: new URL(read.present, url).href,
    manifestHash: read.manifestHash,
    filesUrl: new URL(read.files, url).href,
  }
}

/**
 * The seed a local run plays: `local:` and `seed`. A seed that already
 * starts with it is kept as it is, so a page can play a course it kept
 * again; a seed the platform issued never does.
 */
export function localSeed(seed: string): string {
  return seed.startsWith(LOCAL_SEED_PREFIX)
    ? seed
    : `${LOCAL_SEED_PREFIX}${seed}`
}

/** 128 random bits, in hex, from the browser's own generator. */
function randomSeed(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Plays a local run of `options.game` in `element`.
 *
 * Call it from a click when the game reads tilt: it asks for tilt first,
 * before anything is awaited, because iOS grants it only there, and a game
 * steered by tilt starts no run without it, the refusal arriving at
 * `onError` in the client's sentence. Throws a `PlatformClientError` for a
 * call it cannot play at all: a contract-1 module
 * (`E_LOCAL_PLAY_UNSUPPORTED`), or no config to play
 * (`E_CONFIG_REQUIRED`).
 */
export function playLocal(
  element: HTMLElement,
  options: LocalPlayOptions,
): LocalRun {
  const { game } = options
  const tickHz = game.tickHz
  if (game.contract < 2 || tickHz === null) {
    throw new PlatformClientError("E_LOCAL_PLAY_UNSUPPORTED", {
      cause: { contract: game.contract },
    })
  }
  const config = options.config ?? game.servedConfig
  if (config === null) throw new PlatformClientError("E_CONFIG_REQUIRED")
  const seed = localSeed(options.seed ?? (options.freshSeed ?? randomSeed)())

  // First, in the click's own turn, before anything is awaited.
  const motion = game.needsMotion ? game.requestMotion() : null
  motion?.catch(() => {})

  let handle: MountHandle | null = null
  let stopped = false
  let destroyed = false
  const failed = (error: LocalError) => {
    if (!destroyed) options.onError?.(error)
  }

  const start = (): void => {
    focusGame(element, options.title)
    handle = game.mount(element, {
      mode: "play",
      seed,
      config,
      tickHz,
      scripted: options.scripted,
      expect: { manifestHash: game.manifestHash },
      handlers: {
        onCheckpoint: (checkpoint) => options.onCheckpoint?.(checkpoint),
        onFrame: (frame) => options.onFrame?.(frame),
        onEnded: (ended) => {
          if (destroyed) return
          options.onEnded({
            ...ended,
            recording: ended.recording as LocalRecording,
          })
        },
        onError: failed,
        ...(options.onNotice === undefined
          ? {}
          : { onNotice: options.onNotice }),
      },
      ...(options.presentationContext === undefined
        ? {}
        : { presentationContext: options.presentationContext }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.scheduler === undefined
        ? {}
        : { scheduler: options.scheduler }),
      ...(options.environment === undefined
        ? {}
        : { environment: options.environment }),
    })
  }

  if (motion === null) start()
  else {
    motion.then(
      (access) => {
        if (stopped || destroyed) return
        // A game steered by tilt is not played without it.
        const refused = motionRefusal(access)
        if (refused === null) start()
        else failed({ code: refused.code, message: refused.message })
      },
      (error: unknown) => {
        if (stopped || destroyed) return
        failed({
          code: "E_UNEXPECTED",
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }

  return {
    seed,
    config,
    motion,
    recorded: () => handle?.recorded() ?? [],
    end: () => {
      stopped = true
      handle?.stop("abandoned")
    },
    destroy: () => {
      stopped = true
      destroyed = true
      handle?.destroy()
    },
  }
}
