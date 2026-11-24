/**
 * A game played on a page with no platform: the real page module, loaded as
 * a page loads one, played through its own `mount` with no client at all,
 * and a run that can never pass for a platform run's.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import {
  hashCanonical,
  type Manifest,
  type PlainValue,
  type Recording,
} from "@clockwork2/engine"
import {
  type CaptureEnvironment,
  ManualScheduler,
  MOTION_REFUSALS,
  type MotionAccess,
} from "@clockwork2/engine/host"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import type { StartedRun } from "../../src/api/index"
import type {
  MountOptions,
  PageModule,
  PrepareOptions,
  RunMount,
} from "../../src/game/contract"
import { definePageModule } from "../../src/game/define"
import { type LoadedGame, loadGame } from "../../src/host/load"
import {
  type LocalEnd,
  type LocalError,
  type LocalRecording,
  localAddress,
  localSeed,
  playLocal,
} from "../../src/host/local"
import type { PlatformClient } from "../../src/platform/client"
import {
  CLIENT_ERROR,
  type PlatformClientError,
} from "../../src/platform/errors"
import { turnsModule } from "../game/match"
import {
  type Config,
  Drawn,
  devices,
  FRAME_MS,
  MANIFEST,
  Probe,
  type View,
} from "../game/subject"

beforeAll(() => {
  GlobalRegistrator.register({ url: "https://a-game.example/play" })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let stage: HTMLElement

beforeEach(() => {
  document.body.replaceChildren()
  stage = document.createElement("div")
  const button = document.createElement("button")
  document.body.append(button, stage)
  button.focus()
})

const settle = () => Bun.sleep(0)

const ADDRESS = {
  presentUrl: "https://a-game.example/game/present.js",
  filesUrl: "https://a-game.example/game/files/",
}

/** A page module of `manifest`, whose tilt is answered with `tilt`. */
function moduleOf(
  manifest: Manifest = MANIFEST,
  tilt?: MotionAccess,
): PageModule {
  const module = definePageModule<View, Config>({
    createGame: () => Object.assign(new Probe(), { manifest }) as Probe,
    manifest,
    createPresentation: () => new Drawn(),
    capture:
      tilt === undefined
        ? { keys: { ArrowLeft: "left" } }
        : { keys: { ArrowLeft: "left" }, tilt: { x: "aimX" } },
  })
  if (tilt === undefined) return module
  return { ...module, requestMotion: async () => tilt }
}

/** The module, loaded as a page loads one, with its runs on the test's clock. */
async function loaded(
  module: PageModule,
  scheduler: ManualScheduler,
  keys: CaptureEnvironment,
): Promise<LoadedGame> {
  const devices = { scheduler, environment: keys }
  return await loadGame(
    { ...ADDRESS, manifestHash: module.manifestHash },
    {
      importModule: async () => ({
        default: {
          ...module,
          prepare: (element: HTMLElement, options: PrepareOptions) => {
            const prepared = module.prepare(element, options)
            return {
              ready: prepared.ready,
              mount: (run: RunMount) => prepared.mount({ ...run, ...devices }),
              release: () => prepared.release(),
            }
          },
          mount: (element: HTMLElement, options: MountOptions) =>
            module.mount(element, { ...options, ...devices }),
        },
      }),
    },
  )
}

/** Everything a local run reported. */
function listener() {
  const seen = {
    ended: [] as LocalEnd[],
    errors: [] as LocalError[],
    frames: 0,
  }
  return {
    seen,
    handlers: {
      onEnded: (ended: LocalEnd) => seen.ended.push(ended),
      onError: (error: LocalError) => seen.errors.push(error),
      onFrame: () => {
        seen.frames += 1
      },
    },
  }
}

describe("a local run's seed", () => {
  test("always starts local:, whatever the page passes", () => {
    const hex = "a".repeat(64)
    expect(localSeed("course-1")).toBe("local:course-1")
    // A seed the platform issued is 64 hex characters: never one played here.
    expect(localSeed(hex)).toBe(`local:${hex}`)
    expect(localSeed(hex)).not.toBe(hex)
    // A seed a page kept from a local run plays the same course again.
    expect(localSeed("local:course-1")).toBe("local:course-1")
  })

  test("is played as given, or fresh when the page gives none", async () => {
    const scheduler = new ManualScheduler()
    const game = await loaded(moduleOf(), scheduler, devices())
    const { seen, handlers } = listener()
    const given = playLocal(stage, {
      game,
      seed: "a".repeat(64),
      scripted: "ignore",
      ...handlers,
    })
    expect(given.seed).toBe(`local:${"a".repeat(64)}`)
    const fresh = playLocal(stage, {
      game,
      scripted: "ignore",
      freshSeed: () => "f00d",
      ...handlers,
    })
    expect(fresh.seed).toBe("local:f00d")
    // The browser's own generator, 128 bits of it, by default.
    const made = playLocal(stage, { game, scripted: "ignore", ...handlers })
    expect(made.seed).toMatch(/^local:[0-9a-f]{32}$/)
    await settle()
    given.end()
    expect(seen.ended[0]?.recording?.seed).toBe(`local:${"a".repeat(64)}`)
  })
})

describe("playing a local run", () => {
  /** Nothing of the platform is reached: there is no client to reach it with. */
  test("plays the whole run, asks nothing of any server, and hands back the recording", async () => {
    const real = globalThis.fetch
    const asked: string[] = []
    globalThis.fetch = ((input: string | URL | Request) => {
      asked.push(String(input))
      throw new Error("a local run made a request")
    }) as unknown as typeof fetch
    try {
      const scheduler = new ManualScheduler()
      const keys = devices()
      const game = await loaded(moduleOf(), scheduler, keys)
      const { seen, handlers } = listener()
      playLocal(stage, {
        game,
        seed: "s",
        config: { endAt: 2_000 },
        scripted: "ignore",
        title: "Probe",
        ...handlers,
      })
      expect(document.activeElement).toBe(stage)
      expect(stage.getAttribute("aria-label")).toBe("Probe")
      await settle()
      keys.press("ArrowLeft", true)
      scheduler.run(2, FRAME_MS)
      keys.press("ArrowLeft", false)
      // Past the 600 ticks a contract-1 module would have stopped at.
      scheduler.run(2_100, FRAME_MS)
      expect(seen.errors).toEqual([])
      expect(seen.ended).toHaveLength(1)
      const ended = seen.ended[0] as LocalEnd
      expect(ended).toMatchObject({ tick: 2_000, reason: "completed" })
      expect(ended.recording?.inputs).toHaveLength(2)
      expect(ended.recording?.seed).toBe("local:s")
      expect(ended.recording?.config).toEqual({ endAt: 2_000 })
      expect(asked).toEqual([])
    } finally {
      globalThis.fetch = real
    }
  })

  test("plays the module's served config unless the page names one", async () => {
    const configured: Manifest = {
      ...MANIFEST,
      params: { endAt: { type: "int", label: "End", default: 40 } },
    }
    const game = await loaded(
      moduleOf(configured),
      new ManualScheduler(),
      devices(),
    )
    expect(
      playLocal(stage, { game, scripted: "ignore", onEnded() {} }).config,
    ).toEqual({ endAt: 40 })
    expect(
      playLocal(stage, {
        game,
        config: { endAt: 7 },
        scripted: "ignore",
        onEnded() {},
      }).config,
    ).toEqual({ endAt: 7 })
  })

  test("the player leaving ends the run where it stands, with its recording", async () => {
    const scheduler = new ManualScheduler()
    const game = await loaded(moduleOf(), scheduler, devices())
    const { seen, handlers } = listener()
    const run = playLocal(stage, { game, scripted: "ignore", ...handlers })
    await settle()
    scheduler.run(30, FRAME_MS)
    run.end()
    expect(seen.ended[0]).toMatchObject({ tick: 30, reason: "abandoned" })
    expect(run.recorded()).toEqual([])
  })

  test("taken down, it reports nothing more", async () => {
    const scheduler = new ManualScheduler()
    const game = await loaded(moduleOf(), scheduler, devices())
    const { seen, handlers } = listener()
    const run = playLocal(stage, { game, scripted: "ignore", ...handlers })
    await settle()
    run.destroy()
    scheduler.run(400, FRAME_MS)
    expect(seen).toMatchObject({ ended: [], errors: [] })
  })
})

describe("a local match of a game of turns", () => {
  /**
   * Two pages, each playing its own seat of one match on the same seed,
   * each handing the other what its seat recorded through `remote`.
   */
  test("two pages playing a seat each reach the same recording", async () => {
    const clocks = [new ManualScheduler(), new ManualScheduler()]
    const keys = [devices(), devices()]
    const module = turnsModule()
    const games = [
      await loaded(module, clocks[0] as ManualScheduler, keys[0] as never),
      await loaded(module, clocks[1] as ManualScheduler, keys[1] as never),
    ]
    expect(games.map((game) => game.seats)).toEqual([2, 2])
    const seen = [listener(), listener()]
    const runs: ReturnType<typeof playLocal>[] = []
    for (const seat of [0, 1]) {
      runs.push(
        playLocal(stage, {
          game: games[seat] as LoadedGame,
          seed: "match-1",
          scripted: "ignore",
          seats: {
            local: seat,
            onLocalInputs: (events, through) => {
              const other = runs[1 - seat]?.remote
              other?.append(events)
              other?.confirm(through)
            },
          },
          ...(seen[seat]?.handlers as ReturnType<typeof listener>["handlers"]),
        }),
      )
    }
    expect(runs.every((run) => run.remote !== null)).toBe(true)
    await settle()
    for (let frame = 0; frame < 3_000; frame += 1) {
      if (seen.every((one) => one.seen.ended.length > 0)) break
      for (const seat of [0, 1]) {
        const press = frame % 20 === seat * 7
        if (press) keys[seat]?.press("Space", true)
        clocks[seat]?.advance(FRAME_MS)
        if (press) keys[seat]?.press("Space", false)
      }
    }
    const [first, second] = seen.map((one) => one.seen)
    expect(first?.errors).toEqual([])
    expect(second?.errors).toEqual([])
    const recording = first?.ended[0]?.recording
    expect(recording?.seed).toBe("local:match-1")
    expect(recording?.counters.shots).toBe(6)
    expect(recording?.inputs.length).toBeGreaterThan(4)
    expect(second?.ended[0]?.recording).toMatchObject({
      inputs: recording?.inputs,
      checkpoints: recording?.checkpoints,
      endTick: recording?.endTick,
    })
    expect(runs[0]?.recorded()).toEqual(recording?.inputs)
  })

  test("a game of turns played with no seats is refused, and a game of one seat has no remote", async () => {
    const turns = await loaded(turnsModule(), new ManualScheduler(), devices())
    const { seen, handlers } = listener()
    const refused = playLocal(stage, {
      game: turns,
      scripted: "ignore",
      ...handlers,
    })
    expect(seen.errors.map((error) => error.code)).toEqual(["E_SEATS_REQUIRED"])
    expect(refused.remote).toBeNull()
    const alone = await loaded(moduleOf(), new ManualScheduler(), devices())
    expect(
      playLocal(stage, { game: alone, scripted: "ignore", onEnded() {} })
        .remote,
    ).toBeNull()
  })
})

describe("what a local run refuses", () => {
  /** A module that cannot say its tick rate, and stops at its manifest's cap. */
  test("a contract-1 module, by name", () => {
    const old = {
      contract: 1,
      tickHz: null,
      servedConfig: null,
    } as unknown as LoadedGame
    let thrown: unknown
    try {
      playLocal(stage, { game: old, scripted: "ignore", onEnded() {} })
    } catch (error) {
      thrown = error
    }
    expect((thrown as PlatformClientError).code).toBe(
      "E_LOCAL_PLAY_UNSUPPORTED",
    )
  })

  test("no config, for a game with a setting nobody could serve", async () => {
    const unserved: Manifest = {
      ...MANIFEST,
      params: { endAt: { type: "int", label: "End" } },
    }
    const game = await loaded(
      moduleOf(unserved),
      new ManualScheduler(),
      devices(),
    )
    expect(game.servedConfig).toBeNull()
    expect(() =>
      playLocal(stage, { game, scripted: "ignore", onEnded() {} }),
    ).toThrow(CLIENT_ERROR.E_CONFIG_REQUIRED)
    expect(() =>
      playLocal(stage, {
        game,
        config: { endAt: 5 },
        scripted: "ignore",
        onEnded() {},
      }),
    ).not.toThrow()
  })

  /** A game steered by tilt is not played without it, on its own page either. */
  test("a tilt game asks first, and starts nothing without a grant", async () => {
    const tilting: Manifest = MANIFEST
    const refused: MotionAccess = {
      granted: false,
      code: MOTION_REFUSALS.DENIED,
      detail: "the player said no",
    }
    const scheduler = new ManualScheduler()
    const game = await loaded(moduleOf(tilting, refused), scheduler, devices())
    expect(game.needsMotion).toBe(true)
    const { seen, handlers } = listener()
    const run = playLocal(stage, { game, scripted: "ignore", ...handlers })
    expect(run.motion).not.toBeNull()
    await settle()
    scheduler.run(10, FRAME_MS)
    expect(seen.errors).toEqual([
      { code: "E_MOTION_DENIED", message: CLIENT_ERROR.E_MOTION_DENIED },
    ])
    expect(seen.frames).toBe(0)

    const granted = await loaded(
      moduleOf(tilting, { granted: true }),
      scheduler,
      devices(),
    )
    const played = listener()
    playLocal(stage, { game: granted, scripted: "ignore", ...played.handlers })
    await settle()
    await settle()
    scheduler.run(10, FRAME_MS)
    expect(played.seen.errors).toEqual([])
    expect(played.seen.frames).toBe(10)
  })

  /**
   * The player leaves while the tilt prompt is open, and the page starts the
   * next run in the same element. The page hears at once that the first
   * ended, as a run of no ticks with nothing recorded, and whatever the
   * first prompt answers later, the first run mounts nothing there, takes
   * no focus and reports nothing more: the element is the second run's.
   */
  test("ended while its tilt prompt is open, it ends at tick 0 at once and leaves the element to the next run", async () => {
    for (const answer of [
      { granted: true },
      { granted: false, code: MOTION_REFUSALS.DENIED, detail: "no" },
    ] as const) {
      document.body.replaceChildren(stage)
      stage.replaceChildren()
      const scheduler = new ManualScheduler()
      let grant: (access: MotionAccess) => void = () => {}
      const asking: PageModule = {
        ...moduleOf(MANIFEST, { granted: true }),
        requestMotion: () =>
          new Promise<MotionAccess>((resolve) => {
            grant = resolve
          }),
      }
      const game = await loaded(asking, scheduler, devices())
      const first = listener()
      const run = playLocal(stage, {
        game,
        scripted: "ignore",
        title: "First",
        ...first.handlers,
      })
      run.end()
      // Heard in the same turn, before anything is awaited.
      expect(first.seen.ended).toEqual([
        { tick: 0, reason: "abandoned", counters: {}, recording: null },
      ])
      // Ending it again says nothing more.
      run.end()
      await settle()

      // The next run, in the same element, on a game that asks for nothing.
      const next = await loaded(moduleOf(), scheduler, devices())
      const second = listener()
      playLocal(stage, {
        game: next,
        scripted: "ignore",
        title: "Second",
        ...second.handlers,
      })
      await settle()
      const drawn = stage.childElementCount
      const elsewhere = document.createElement("button")
      document.body.append(elsewhere)
      elsewhere.focus()

      grant(answer)
      await settle()
      await settle()
      scheduler.run(10, FRAME_MS)
      expect(first.seen.ended).toHaveLength(1)
      expect(first.seen).toMatchObject({ errors: [], frames: 0 })
      expect(run.recorded()).toEqual([])
      // Nothing of the first run's reached the element or took focus.
      expect(stage.childElementCount).toBe(drawn)
      expect(stage.getAttribute("aria-label")).toBe("Second")
      expect(document.activeElement).toBe(elsewhere)
      expect(second.seen.errors).toEqual([])
      expect(second.seen.frames).toBe(10)
    }
  })

  /** Taken down instead, it says nothing at all, then or later. */
  test("destroyed while its tilt prompt is open, it reports nothing", async () => {
    let grant: (access: MotionAccess) => void = () => {}
    const asking: PageModule = {
      ...moduleOf(MANIFEST, { granted: true }),
      requestMotion: () =>
        new Promise<MotionAccess>((resolve) => {
          grant = resolve
        }),
    }
    const game = await loaded(asking, new ManualScheduler(), devices())
    const { seen, handlers } = listener()
    const run = playLocal(stage, { game, scripted: "ignore", ...handlers })
    run.destroy()
    run.end()
    grant({ granted: true })
    await settle()
    await settle()
    expect(seen).toMatchObject({ ended: [], errors: [], frames: 0 })
    expect(stage.childElementCount).toBe(0)
  })

  /**
   * The engine's own request never fails, and a module built from other code
   * can. What failed is said in its own words, as the harness shows it.
   */
  test("a tilt request that fails says so in its own words, and starts nothing", async () => {
    for (const [reason, said] of [
      [new Error("the sensor broke"), "the sensor broke"],
      ["no sensor", "no sensor"],
    ] as const) {
      const scheduler = new ManualScheduler()
      const failing: PageModule = {
        ...moduleOf(MANIFEST, { granted: true }),
        requestMotion: () => Promise.reject(reason),
      }
      const game = await loaded(failing, scheduler, devices())
      const { seen, handlers } = listener()
      playLocal(stage, { game, scripted: "ignore", ...handlers })
      await settle()
      scheduler.run(10, FRAME_MS)
      expect(seen.errors).toEqual([{ code: "E_UNEXPECTED", message: said }])
      expect(seen.frames).toBe(0)
    }
  })
})

/**
 * Compile-time holds, run as tests so a reader finds them: each fails to
 * compile rather than to pass. The platform refuses a local recording too,
 * by its seed, which `tests/harness/stand-in.test.ts` holds.
 */
describe("a local recording and the platform client", () => {
  test("submit takes neither a local run's recording nor one made by hand", () => {
    const neverCalled = (
      client: Pick<PlatformClient, "submit">,
      run: StartedRun,
      local: LocalRecording,
      plain: Recording,
    ) => {
      // @ts-expect-error a local run's recording is not a platform run's
      void client.submit(run, local)
      // @ts-expect-error nor is a recording that did not come from a Run
      void client.submit(run, plain)
    }
    expect(typeof neverCalled).toBe("function")
  })
})

test("the served config and the manifest hash come from the module, not the page", async () => {
  const game = await loaded(moduleOf(), new ManualScheduler(), devices())
  expect(game.manifestHash).toBe(
    hashCanonical(MANIFEST as unknown as PlainValue),
  )
  expect(game.tickHz).toBe(60)
  expect(game.servedConfig).toEqual({})
})

describe("the build a page plays locally", () => {
  const BUILD = {
    name: "Probe",
    present: "present.js",
    sim: "sim.js",
    manifest: "manifest.json",
    manifestHash: "h",
    files: "files/",
    listing: "files.json",
    filesSha256: "f".repeat(64),
  }

  test("is found beside its game.json, wherever that is served", () => {
    expect(
      localAddress(BUILD, "https://host.example/play/game/game.json"),
    ).toEqual({
      presentUrl: "https://host.example/play/game/present.js",
      manifestHash: "h",
      filesUrl: "https://host.example/play/game/files/",
    })
  })

  test("a game.json that is not what vbz build writes is refused, naming the field", () => {
    for (const [build, field] of [
      [null, "name"],
      [{ ...BUILD, present: 1 }, "present"],
      [{ ...BUILD, filesSha256: undefined }, "filesSha256"],
    ] as const) {
      let thrown: unknown
      try {
        localAddress(build, "https://host.example/game.json")
      } catch (error) {
        thrown = error
      }
      expect((thrown as PlatformClientError).code).toBe("E_GAME_UNLOADABLE")
      expect((thrown as PlatformClientError).cause).toMatchObject({
        problem: expect.stringContaining(field),
      })
    }
  })
})
