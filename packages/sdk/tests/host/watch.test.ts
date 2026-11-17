/**
 * Watching a settled run: its own version's module, its own inputs, and a
 * replay that stops where the platform's stopped.
 */

import { describe, expect, test } from "bun:test"
import {
  hashCanonical,
  type InputEvent,
  type PlainValue,
} from "@clockwork2/engine"
import { ManualScheduler } from "@clockwork2/engine/host"
import type { WatchedRun } from "../../src/api/index"
import type { MountedEnd } from "../../src/game/contract"
import { definePageModule } from "../../src/game/define"
import {
  type GameAddress,
  type GameMountOptions,
  type LoadedGame,
  loadGame,
} from "../../src/host/load"
import { watchRun } from "../../src/host/watch"
import { PlatformClientError, PlatformRefusal } from "../../src/platform/errors"
import { Drawn, FRAME_MS, MANIFEST, Probe } from "../game/subject"

const HASH = hashCanonical(MANIFEST as unknown as PlainValue)

const INPUTS: InputEvent[] = [
  { tick: 3, code: "left", value: 1 },
  { tick: 4, code: "left", value: 0 },
  { tick: 30, code: "left", value: 1 },
]

/** What a promise was refused with, which has to be a client error. */
async function caught(promise: Promise<unknown>): Promise<PlatformClientError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof PlatformClientError) return error
    throw error
  }
  throw new Error("nothing was refused")
}

const WATCHED: WatchedRun = {
  sessionId: "s-7",
  gameSlug: "probe",
  gameTitle: "Probe",
  gameVersionId: "v-1",
  day: "2026-11-11",
  counters: { presses: 2 },
  endTick: 40,
  tickHz: 60,
  seed: "seed-7",
  config: { endAt: 300 },
  inputs: INPUTS,
  presentUrl: "https://bundles.example/g/g-1/present/v1.js",
  manifestHash: HASH,
  filesUrl: "https://bundles.example/g/g-1/t/f1/",
  replayTicks: 40,
}

/** Lets every promise already settled run: a game gets ready in them. */
const settle = () => Bun.sleep(0)

const element = {
  ownerDocument: { defaultView: null },
} as unknown as HTMLElement

/** The real module, on a clock the test moves. */
function realGame(scheduler: ManualScheduler): {
  readonly load: (address: GameAddress) => Promise<LoadedGame>
  readonly asked: GameAddress[]
} {
  const module = definePageModule({
    createGame: () => new Probe(),
    manifest: MANIFEST,
    createPresentation: () => new Drawn(),
    capture: { keys: { ArrowLeft: "left" } },
  })
  const asked: GameAddress[] = []
  return {
    asked,
    load: async (address) => {
      asked.push(address)
      return await loadGame(address, {
        importModule: async () => ({
          default: {
            ...module,
            mount: (target: HTMLElement, options: GameMountOptions) =>
              module.mount(target, {
                ...options,
                files: address.filesUrl,
                scheduler,
              }),
          },
        }),
      })
    },
  }
}

/** A loaded game that hands what it was mounted with to `seen`. */
function recording(seen: (options: GameMountOptions) => void): LoadedGame {
  const handle = { recorded: () => [], stop() {}, destroy() {} }
  return {
    presentUrl: WATCHED.presentUrl,
    manifestHash: HASH,
    filesUrl: WATCHED.filesUrl,
    contract: 2,
    needsMotion: false,
    tickHz: 60,
    servedConfig: {},
    requestMotion: async () => ({ granted: true }),
    prepare: () => ({
      ready: Promise.resolve(null),
      mount: () => handle,
      release() {},
    }),
    mount: (_target, options) => {
      seen(options)
      return handle
    },
  }
}

const reading = (run: WatchedRun | Error) => ({
  watch: async (sessionId: string) => {
    expect(sessionId).toBe("s-7")
    if (run instanceof Error) throw run
    return run
  },
})

describe("watching a run", () => {
  /** An abandoned run replays to where its player left it, and no further. */
  test("it replays the run's own inputs to its replay ticks", async () => {
    const scheduler = new ManualScheduler()
    const game = realGame(scheduler)
    const ended: MountedEnd[] = []
    const watched = await watchRun(element, {
      client: reading(WATCHED),
      runId: "s-7",
      load: game.load,
      handlers: {
        onEnded: (end) => ended.push(end),
      },
    })
    expect(game.asked).toEqual([
      {
        presentUrl: WATCHED.presentUrl,
        manifestHash: HASH,
        filesUrl: WATCHED.filesUrl,
      },
    ])
    await settle()
    scheduler.run(60, FRAME_MS)
    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatchObject({
      tick: 40,
      reason: "timeout",
      counters: { presses: 2 },
    })
    expect(watched.handle.recorded()).toEqual(INPUTS)
    expect(watched.run).toBe(WATCHED)
    watched.destroy()
  })

  test("the mount is told the run's seed, config, rate, where to stop and hash", async () => {
    let given: GameMountOptions | null = null
    await watchRun(element, {
      client: reading(WATCHED),
      runId: "s-7",
      load: async () =>
        recording((options) => {
          given = options
          options.handlers.onCheckpoint({ tick: 0, hash: "h" })
          options.handlers.onNotice?.({
            code: "E_GAMEPAD_UNMAPPED",
            detail: "",
          })
          options.handlers.onError({ code: "E_UNEXPECTED", message: "x" })
          options.handlers.onFrame({ tick: 1, counters: {} })
          options.handlers.onEnded({
            tick: 1,
            reason: "timeout",
            counters: {},
            recording: {} as never,
          })
        }),
    })
    expect(given).toMatchObject({
      mode: "watch",
      seed: "seed-7",
      config: { endAt: 300 },
      tickHz: 60,
      maxTicks: 40,
      inputs: WATCHED.inputs,
      expect: { manifestHash: HASH },
    })
  })

  test("a failure after it is mounted reaches the handler", async () => {
    const errors: string[] = []
    const scheduler = new ManualScheduler()
    await watchRun(element, {
      client: reading({ ...WATCHED, tickHz: 30 }),
      runId: "s-7",
      load: realGame(scheduler).load,
      handlers: { onError: (error) => errors.push(error.code) },
    })
    await settle()
    expect(errors).toEqual(["E_WRONG_GAME"])
  })

  test("a run with nothing to replay is refused before anything loads", async () => {
    const scheduler = new ManualScheduler()
    const game = realGame(scheduler)
    const error = await caught(
      watchRun(element, {
        client: reading({ ...WATCHED, endTick: null, replayTicks: null }),
        runId: "s-7",
        load: game.load,
      }),
    )
    expect(error.code).toBe("E_NOTHING_TO_WATCH")
    expect(game.asked).toEqual([])
  })

  test("a run the platform will not show is its refusal", async () => {
    const refusal = new PlatformRefusal(404, {
      error: "E_NO_SESSION",
      message: "no such run",
    })
    await expect(
      watchRun(element, { client: reading(refusal), runId: "s-7" }),
    ).rejects.toBe(refusal)
  })

  /** With no loader given, it is loadGame, which checks the module is the run's. */
  test("the run's module is loaded with loadGame by default", async () => {
    const error = await caught(
      watchRun(element, {
        client: reading({
          ...WATCHED,
          presentUrl: "http://example.invalid/x.js",
        }),
        runId: "s-7",
      }),
    )
    expect(error.code).toBe("E_GAME_UNLOADABLE")
  })
})
