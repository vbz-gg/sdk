/**
 * A page module, driven the way a studio's page drives one: a real engine
 * host on a clock the test moves, a presentation that records what it was
 * asked, and keys dispatched on a stand-in window.
 */

import { describe, expect, test } from "bun:test"
import {
  hashCanonical,
  type InputEvent,
  type Manifest,
  type PlainValue,
  type Presentation,
} from "@clockwork2/engine"
import {
  type CaptureEnvironment,
  type CaptureMapping,
  ManualScheduler,
  MOTION_REFUSALS,
} from "@clockwork2/engine/host"
import {
  type MountError,
  type MountedCheckpoint,
  type MountedEnd,
  type MountedFrame,
  type MountOptions,
  PAGE_MODULE_CONTRACT,
  type PlayMount,
  type PrepareOptions,
  type WatchMount,
} from "../../src/game/contract"
import { definePageModule, mountErrorOf } from "../../src/game/define"
import {
  type Config,
  Drawn,
  devices,
  FRAME_MS,
  MANIFEST,
  Probe,
  type View,
} from "./subject"

const KEYS: CaptureMapping = { keys: { ArrowLeft: "left" } }
const HASH = hashCanonical(MANIFEST as unknown as PlainValue)
const FILES = "https://files.test/g/game/t/folder/"

/** Lets every promise already settled run its handlers: a game gets ready in them. */
const settle = () => Bun.sleep(0)

/** An element as far as a mount reads one, at a pixel ratio of the test's choosing. */
function stage(devicePixelRatio?: number): HTMLElement {
  return {
    ownerDocument: {
      defaultView: devicePixelRatio === undefined ? null : { devicePixelRatio },
    },
  } as unknown as HTMLElement
}

function moduleOf(
  overrides: {
    readonly capture?: CaptureMapping
    readonly createGame?: () => Probe
    readonly manifest?: Manifest
    readonly presentation?: () => Presentation<View, HTMLElement>
  } = {},
) {
  const drawn: Drawn[] = []
  const folders: string[] = []
  const game = definePageModule<View, Config>({
    createGame: overrides.createGame ?? (() => new Probe()),
    manifest: overrides.manifest ?? MANIFEST,
    createPresentation: (files) => {
      folders.push(files.base)
      if (overrides.presentation !== undefined) return overrides.presentation()
      const presentation = new Drawn()
      drawn.push(presentation)
      return presentation
    },
    capture: overrides.capture ?? KEYS,
  })
  return { game, drawn, folders }
}

/** Everything a mount reported, in order. */
function listener() {
  const seen = {
    checkpoints: [] as MountedCheckpoint[],
    frames: [] as MountedFrame[],
    ended: [] as MountedEnd[],
    errors: [] as MountError[],
    notices: [] as string[],
  }
  return {
    seen,
    handlers: {
      onCheckpoint: (checkpoint: MountedCheckpoint) =>
        seen.checkpoints.push(checkpoint),
      onFrame: (frame: MountedFrame) => seen.frames.push(frame),
      onEnded: (ended: MountedEnd) => seen.ended.push(ended),
      onError: (error: MountError) => seen.errors.push(error),
      onNotice: (notice: { code: string }) => seen.notices.push(notice.code),
    },
  }
}

/**
 * A played run, which hears the player's devices alone, as a ranked run
 * does: an event a script made is not recorded.
 */
function options(
  extra: Partial<PlayMount & PrepareOptions> & Pick<MountOptions, "handlers">,
): MountOptions {
  return {
    mode: "play",
    seed: "seed-1",
    config: { endAt: 120 },
    tickHz: 60,
    scripted: "ignore",
    expect: { manifestHash: HASH },
    files: FILES,
    ...extra,
  }
}

/** A watched run of `inputs`, stopping at `maxTicks`. */
function watching(
  extra: Partial<WatchMount & PrepareOptions> & Pick<MountOptions, "handlers">,
): MountOptions {
  return {
    mode: "watch",
    seed: "seed-1",
    config: { endAt: 120 },
    tickHz: 60,
    inputs: [],
    maxTicks: 30,
    expect: { manifestHash: HASH },
    files: FILES,
    ...extra,
  }
}

describe("what a page module says about itself", () => {
  test("its contract, its manifest's hash, and whether it reads tilt", () => {
    const { game } = moduleOf()
    expect(game.contract).toBe(PAGE_MODULE_CONTRACT)
    expect(game.contract).toBe(2)
    expect(game.manifestHash).toBe(HASH)
    expect(game.needsMotion).toBe(false)
    const tilting = moduleOf({
      capture: { tilt: { x: "aimX" } },
      manifest: MANIFEST,
    }).game
    expect(tilting.needsMotion).toBe(true)
  })

  /** What a page needs to start a run with no engine of its own. */
  test("its tick rate, and the config a platform serves", () => {
    const configured: Manifest = {
      ...MANIFEST,
      params: {
        endAt: { type: "int", label: "End", default: 90 },
        name: { type: "string", label: "Name", optional: true },
      },
    }
    const { game } = moduleOf({ manifest: configured })
    expect(game.tickHz).toBe(60)
    expect(game.servedConfig).toEqual({ endAt: 90 })
    expect(moduleOf().game.servedConfig).toEqual({})
  })

  /** A setting nobody could serve: only a page naming a config can play it. */
  test("a required setting with no default serves no config", () => {
    const unserved: Manifest = {
      ...MANIFEST,
      params: { endAt: { type: "int", label: "End" } },
    }
    expect(moduleOf({ manifest: unserved }).game.servedConfig).toBeNull()
  })

  /** It is the engine's own, so the page asks with the module's engine. */
  test("asking for tilt answers with one of the engine's refusals here", async () => {
    const { game } = moduleOf({ capture: { tilt: { x: "aimX" } } })
    const access = await game.requestMotion()
    expect(access.granted).toBe(false)
    if (access.granted) return
    expect(Object.values(MOTION_REFUSALS)).toContain(access.code)
  })
})

describe("a page module's own check", () => {
  test("a module whose parts agree has nothing to say", () => {
    expect(moduleOf().game.check()).toEqual([])
  })

  /** The upload's manifest is the rules code's; a page module given another lies. */
  test("a manifest that is not the rules code's is a module problem", () => {
    const other = { ...MANIFEST, name: "Not Probe" }
    const problems = moduleOf({ manifest: other }).game.check()
    expect(problems.map((p) => p.code)).toEqual(["E_GAME_MODULE_INVALID"])
  })

  test("a rules code that cannot make a game is a module problem", () => {
    const problems = moduleOf({
      createGame: () => {
        throw new Error("no game here")
      },
    }).game.check()
    expect(problems).toEqual([
      {
        code: "E_GAME_MODULE_INVALID",
        message: expect.stringContaining("no game here"),
      },
    ])
  })

  /** Found before a run is started, so a mistake never spends one. */
  test("a mapping naming an undeclared input is a capture problem, each named", () => {
    const problems = moduleOf({
      capture: { keys: { ArrowLeft: "left", ArrowUp: "jump", KeyZ: "fire" } },
    }).game.check()
    expect(problems.map((p) => p.code)).toEqual([
      "E_CAPTURE_INVALID",
      "E_CAPTURE_INVALID",
    ])
    expect(problems[0]?.message).toContain('"jump"')
  })

  test("a mapping that cannot be checked at all is still an answer, not a throw", () => {
    const broken = { ...MANIFEST, inputs: null } as unknown as typeof MANIFEST
    const problems = moduleOf({ manifest: broken }).game.check()
    expect(problems.map((p) => p.code)).toContain("E_CAPTURE_INVALID")
  })

  /** The module fetches its packs from its files folder now. */
  test("a data pack the rules code reads is no problem", () => {
    const packed = {
      ...MANIFEST,
      assets: [
        {
          path: "level.json",
          sha256: "a".repeat(64),
          bytes: 10,
          requiredForSim: true,
          license: "CC0",
        },
      ],
    }
    const problems = moduleOf({
      manifest: packed,
      createGame: () =>
        Object.assign(new Probe(), { manifest: packed }) as Probe,
    }).game.check()
    expect(problems).toEqual([])
  })
})

describe("playing a run", () => {
  test("each handler hears its part, and the end carries the recording", async () => {
    const { game, drawn, folders } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const keys = devices()
    const handle = game.mount(
      stage(2),
      options({ handlers, scheduler, environment: keys }),
    )
    // The presentation is handed the version's files folder.
    expect(folders).toEqual([FILES])
    await settle()
    // The checkpoint the run starts from is pinned before a frame runs.
    expect(seen.checkpoints).toEqual([{ tick: 0, hash: expect.any(String) }])
    expect(drawn[0]?.context?.devicePixelRatio).toBe(2)

    scheduler.run(30, FRAME_MS)
    keys.press("ArrowLeft", true)
    scheduler.run(1, FRAME_MS)
    keys.press("ArrowLeft", false)
    scheduler.run(100, FRAME_MS)

    expect(seen.frames.at(0)).toEqual({ tick: 1, counters: { presses: 0 } })
    expect(seen.frames.at(-1)?.counters).toEqual({ presses: 1 })
    expect(handle.recorded()).toEqual([
      { tick: 30, code: "left", value: 1 },
      { tick: 31, code: "left", value: 0 },
    ])
    // One a second, at the game's own rate, and one where it ended.
    expect(seen.checkpoints.map((c) => c.tick)).toEqual([0, 60, 120, 120])
    expect(seen.ended).toHaveLength(1)
    const ended = seen.ended[0] as MountedEnd
    expect(ended).toMatchObject({
      tick: 120,
      reason: "completed",
      counters: { presses: 1 },
    })
    expect(ended.recording.inputs).toEqual(handle.recorded())
    expect(ended.recording.manifestHash).toBe(HASH)
    expect(ended.recording.seed).toBe("seed-1")
    expect(ended.recording.checkpoints).toEqual(seen.checkpoints)
    expect(seen.errors).toEqual([])
  })

  /** Keys are taken page-wide, so they stop with the run. */
  test("capture stops listening when the run ends, and when it is destroyed", async () => {
    const { game, drawn } = moduleOf()
    const scheduler = new ManualScheduler()
    const ended = devices()
    game.mount(
      stage(),
      options({
        handlers: listener().handlers,
        scheduler,
        environment: ended,
      }),
    )
    await settle()
    expect(ended.listening()).toBeGreaterThan(0)
    scheduler.run(130, FRAME_MS)
    expect(ended.listening()).toBe(0)

    const destroyed = devices()
    const { seen, handlers } = listener()
    const handle = game.mount(
      stage(),
      options({
        handlers,
        scheduler: new ManualScheduler(),
        environment: destroyed,
      }),
    )
    await settle()
    handle.destroy()
    expect(destroyed.listening()).toBe(0)
    // Destroying is not ending: nothing is reported, and what was drawn goes.
    expect(seen.ended).toEqual([])
    expect(drawn.at(-1)?.unmounted).toBe(true)
  })

  test("a player leaving ends the run where it stands, as abandoned", async () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const handle = game.mount(
      stage(),
      options({ handlers, scheduler, environment: devices() }),
    )
    await settle()
    scheduler.run(45, FRAME_MS)
    handle.stop()
    handle.stop()
    expect(seen.ended).toHaveLength(1)
    expect(seen.ended[0]).toMatchObject({ tick: 45, reason: "abandoned" })
  })

  test("the pixel ratio is the page's own unless the page says otherwise", () => {
    const { game, drawn } = moduleOf()
    game.mount(
      stage(),
      options({ handlers: listener().handlers, environment: devices() }),
    )
    game.mount(
      stage(3),
      options({
        handlers: listener().handlers,
        environment: devices(),
        presentationContext: { devicePixelRatio: 1.5, theme: "dark" },
      }),
    )
    expect(drawn[0]?.context?.devicePixelRatio).toBe(1)
    expect(drawn[1]?.context).toMatchObject({
      devicePixelRatio: 1.5,
      theme: "dark",
    })
  })

  /** Contract 1 stopped a run at its manifest's cap; no run has one now. */
  test("a played run has no step limit: it runs until the game ends it", async () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    game.mount(
      stage(),
      options({
        handlers,
        scheduler,
        environment: devices(),
        config: { endAt: 5_000 },
      }),
    )
    await settle()
    // Far past the 600 ticks contract 1 would have stopped it at.
    scheduler.run(4_000, FRAME_MS)
    expect(seen.ended).toEqual([])
    expect(seen.frames.at(-1)?.tick).toBeGreaterThan(4_000)
    scheduler.run(1_000, FRAME_MS)
    expect(seen.ended[0]).toMatchObject({ tick: 5_000, reason: "completed" })
  })

  /**
   * A ranked run takes its inputs from the player's devices alone: a key a
   * script on the page dispatched is not the player's.
   */
  test("an event a script made is not recorded when the page says to ignore it", async () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const keys = devices()
    const handle = game.mount(
      stage(),
      options({ handlers, scheduler, environment: keys, scripted: "ignore" }),
    )
    await settle()
    scheduler.run(5, FRAME_MS)
    keys.press("ArrowLeft", true, true)
    scheduler.run(5, FRAME_MS)
    expect(handle.recorded()).toEqual([])
    expect(seen.errors).toEqual([])
  })

  /** A game on its own page may drive itself from a script, if its page says so. */
  test("an event a script made is recorded when the page says to record it", async () => {
    const { game } = moduleOf()
    const scheduler = new ManualScheduler()
    const keys = devices()
    const handle = game.mount(
      stage(),
      options({
        handlers: listener().handlers,
        scheduler,
        environment: keys,
        scripted: "record",
      }),
    )
    await settle()
    scheduler.run(5, FRAME_MS)
    keys.press("ArrowLeft", true, true)
    scheduler.run(1, FRAME_MS)
    expect(handle.recorded()).toEqual([{ tick: 5, code: "left", value: 1 }])
  })
})

describe("getting ready before a run", () => {
  /** A presentation that waits until the test says it can draw, or cannot. */
  function waiting() {
    let resolve: () => void = () => {}
    let reject: (error: Error) => void = () => {}
    const presentation = Object.assign(new Drawn(), {
      prepared: 0,
      prepare(): Promise<void> {
        presentation.prepared += 1
        return new Promise<void>((yes, no) => {
          resolve = yes
          reject = no
        })
      },
    })
    return {
      presentation,
      ready: () => resolve(),
      fail: (message: string) => reject(new Error(message)),
    }
  }

  /** null3d compiles its renderer before it can draw: nothing runs before then. */
  test("the clock starts only once the presentation can draw", async () => {
    const drawing = waiting()
    const { game } = moduleOf({ presentation: () => drawing.presentation })
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const keys = devices()
    game.mount(stage(), options({ handlers, scheduler, environment: keys }))
    await settle()
    scheduler.run(20, FRAME_MS)
    expect(drawing.presentation.prepared).toBe(1)
    expect(seen.checkpoints).toEqual([])
    expect(seen.frames).toEqual([])
    // Nothing the player does before the game can draw is heard.
    expect(keys.listening()).toBe(0)
    drawing.ready()
    await settle()
    scheduler.run(10, FRAME_MS)
    expect(seen.frames.at(-1)?.tick).toBe(10)
    // Mounted once, by the module, not again by the host.
    expect(drawing.presentation.mounts).toBe(1)
  })

  test("a presentation that cannot draw fails the run before tick 0, with the engine's code", async () => {
    const drawing = waiting()
    const { game } = moduleOf({ presentation: () => drawing.presentation })
    const { seen, handlers } = listener()
    const keys = devices()
    game.mount(stage(), options({ handlers, environment: keys }))
    drawing.fail("no usable GPU path")
    await settle()
    expect(seen.errors).toEqual([
      {
        code: "E_PRESENTATION_FAILED",
        message: expect.stringContaining("no usable GPU path"),
      },
    ])
    expect(seen.checkpoints).toEqual([])
    expect(keys.listening()).toBe(0)
    expect(drawing.presentation.unmounted).toBe(true)
  })

  /** What `playRun` does before it asks the platform for a run. */
  test("a page learns the game can draw here before it plays anything", async () => {
    const drawing = waiting()
    const { game } = moduleOf({ presentation: () => drawing.presentation })
    const prepared = game.prepare(stage(), { files: FILES })
    let answer: MountError | null | "waiting" = "waiting"
    void prepared.ready.then((ready) => {
      answer = ready
    })
    await settle()
    expect(answer).toBe("waiting")
    drawing.ready()
    await settle()
    expect(answer).toBeNull()

    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const { files: _, ...run } = options({
      handlers,
      scheduler,
      environment: devices(),
    })
    prepared.mount(run)
    await settle()
    scheduler.run(5, FRAME_MS)
    expect(seen.frames.at(-1)?.tick).toBe(5)
    expect(drawing.presentation.mounts).toBe(1)

    // A prepared game plays one run.
    const again = listener()
    prepared.mount({ ...run, handlers: again.handlers })
    expect(again.seen.errors.map((e) => e.code)).toEqual(["E_ARG_INVALID"])
  })

  test("a device that cannot draw says so in ready, and nothing is drawn after", async () => {
    const drawing = waiting()
    const { game } = moduleOf({ presentation: () => drawing.presentation })
    const prepared = game.prepare(stage(), { files: FILES })
    drawing.fail("no usable GPU path")
    expect((await prepared.ready)?.code).toBe("E_PRESENTATION_FAILED")
    expect(drawing.presentation.unmounted).toBe(true)
  })

  test("a page that will not play after all takes the presentation down", async () => {
    const { game, drawn } = moduleOf()
    const prepared = game.prepare(stage(), { files: FILES })
    expect(await prepared.ready).toBeNull()
    prepared.release()
    expect(drawn[0]?.unmounted).toBe(true)
  })

  /** A run already asked for has to end, so its page can submit what it has. */
  test("a run stopped while it gets ready ends at tick 0 once it is", async () => {
    const drawing = waiting()
    const { game } = moduleOf({ presentation: () => drawing.presentation })
    const { seen, handlers } = listener()
    const handle = game.mount(stage(), options({ handlers }))
    handle.stop("abandoned")
    expect(seen.ended).toEqual([])
    drawing.ready()
    await settle()
    expect(seen.ended).toHaveLength(1)
    expect(seen.ended[0]).toMatchObject({ tick: 0, reason: "abandoned" })
    expect(seen.ended[0]?.recording.inputs).toEqual([])
  })

  test("a run destroyed while it gets ready reports nothing", async () => {
    const drawing = waiting()
    const { game } = moduleOf({ presentation: () => drawing.presentation })
    const { seen, handlers } = listener()
    const handle = game.mount(stage(), options({ handlers }))
    handle.destroy()
    drawing.ready()
    await settle()
    expect(seen).toMatchObject({ ended: [], errors: [], frames: [] })
    expect(drawing.presentation.unmounted).toBe(true)
  })

  test("a files folder that is not an absolute address ending in / is refused", async () => {
    for (const files of ["/g/x/t/y/", "https://files.test/g/x/t/y"]) {
      const { game } = moduleOf()
      const { seen, handlers } = listener()
      game.mount(stage(), options({ handlers, files }))
      await settle()
      expect(seen.errors.map((e) => e.code)).toEqual(["E_ARG_INVALID"])
    }
  })
})

describe("data packs, from the files folder", () => {
  const BYTES = new TextEncoder().encode(`{"rocks":3}`)
  const SHA = new Bun.CryptoHasher("sha256").update(BYTES).digest("hex")

  function packed(bytes = BYTES.byteLength): Manifest {
    return {
      ...MANIFEST,
      assets: [
        {
          path: "packs/level.json",
          sha256: SHA,
          bytes,
          requiredForSim: true,
          license: "CC0",
        },
      ],
    }
  }

  function served(body: Uint8Array | null) {
    const asked: string[] = []
    const fetch = async (input: string) => {
      asked.push(input)
      return body === null
        ? new Response("missing", { status: 404 })
        : new Response(new Blob([body as Uint8Array<ArrayBuffer>]))
    }
    return { asked, fetch }
  }

  function packedModule(manifest: Manifest) {
    return moduleOf({
      manifest,
      createGame: () => Object.assign(new Probe(), { manifest }) as Probe,
    })
  }

  test("a start pack is fetched from the folder by its path before the run starts", async () => {
    const manifest = packed()
    const { game } = packedModule(manifest)
    const { asked, fetch } = served(BYTES)
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    game.mount(
      stage(),
      options({
        handlers,
        scheduler,
        fetch,
        environment: devices(),
        expect: {
          manifestHash: hashCanonical(manifest as unknown as PlainValue),
        },
      }),
    )
    await settle()
    scheduler.run(3, FRAME_MS)
    expect(asked).toEqual([`${FILES}packs/level.json`])
    expect(seen.errors).toEqual([])
    expect(seen.frames.at(-1)?.tick).toBe(3)
  })

  test("a pack that does not arrive fails the run before tick 0", async () => {
    const manifest = packed()
    const { game } = packedModule(manifest)
    const prepared = game.prepare(stage(), {
      files: FILES,
      fetch: served(null).fetch,
    })
    expect((await prepared.ready)?.code).toBe("E_PACK_NOT_DELIVERED")
  })

  test("a pack whose bytes are not the ones declared fails before a run is asked for", async () => {
    const manifest = packed()
    const { game } = packedModule(manifest)
    const prepared = game.prepare(stage(), {
      files: FILES,
      fetch: served(new TextEncoder().encode(`{"rocks":4}`)).fetch,
    })
    expect((await prepared.ready)?.code).toBe("E_PACK_HASH_MISMATCH")
  })
})

describe("watching a run", () => {
  const LOG: InputEvent[] = [
    { tick: 5, code: "left", value: 1 },
    { tick: 6, code: "left", value: 0 },
    { tick: 20, code: "left", value: 1 },
  ]

  /** Watching an abandoned run stops where its player left it. */
  test("it replays the log to where it is told to stop, and hears no key", async () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const keys = devices()
    const handle = game.mount(
      stage(),
      watching({
        inputs: LOG,
        maxTicks: 30,
        handlers,
        scheduler,
        environment: keys,
      }),
    )
    await settle()
    expect(keys.listening()).toBe(0)
    keys.press("ArrowLeft", true)
    scheduler.run(40, FRAME_MS)
    expect(seen.ended[0]).toMatchObject({
      tick: 30,
      reason: "timeout",
      counters: { presses: 2 },
    })
    expect(handle.recorded()).toEqual(LOG)
    expect(seen.ended[0]?.recording.inputs).toEqual(LOG)
  })

  test("watching with no inputs is refused before anything is built", () => {
    const { game, drawn } = moduleOf()
    const { seen, handlers } = listener()
    const { inputs: _, ...without } = watching({ handlers }) as WatchMount &
      PrepareOptions
    const handle = game.mount(stage(), without as MountOptions)
    expect(seen.errors.map((e) => e.code)).toEqual(["E_ARG_INVALID"])
    expect(drawn).toEqual([])
    expect(handle.recorded()).toEqual([])
    handle.stop()
    handle.destroy()
  })

  test("a log the engine cannot replay arrives as its own code", async () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    game.mount(
      stage(),
      watching({
        inputs: [
          { tick: 9, code: "left", value: 1 },
          { tick: 2, code: "left", value: 1 },
        ],
        handlers,
      }),
    )
    await settle()
    expect(seen.errors.map((e) => e.code)).toEqual(["E_INPUT_UNSORTED"])
  })

  /**
   * The platform's page-module check runs in a browser with no GPU, and
   * compares checkpoints, which nothing drawn can change.
   */
  test("without drawing, no presentation is made and the checkpoints still come", async () => {
    const { game, drawn, folders } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    game.mount(
      stage(),
      watching({
        inputs: LOG,
        maxTicks: 120,
        draw: false,
        handlers,
        scheduler,
      }),
    )
    await settle()
    scheduler.run(130, FRAME_MS)
    expect(drawn).toEqual([])
    expect(folders).toEqual([])
    expect(seen.checkpoints.map((c) => c.tick)).toEqual([0, 60, 120, 120])
    expect(seen.ended[0]).toMatchObject({ tick: 120, counters: { presses: 2 } })
  })

  test("a game prepared to draw cannot be watched without drawing", async () => {
    const { game } = moduleOf()
    const prepared = game.prepare(stage(), { files: FILES })
    await prepared.ready
    const { seen, handlers } = listener()
    const { files: _, ...run } = watching({
      inputs: LOG,
      draw: false,
      handlers,
    })
    prepared.mount(run as WatchMount)
    expect(seen.errors.map((e) => e.code)).toEqual(["E_ARG_INVALID"])
  })
})

describe("what a mount refuses before a tick runs", () => {
  function refused(extra: Record<string, unknown>): string[] {
    const { game, drawn } = moduleOf()
    const { seen, handlers } = listener()
    game.mount(stage(), {
      ...options({ handlers }),
      ...extra,
    } as unknown as MountOptions)
    expect(drawn).toEqual([])
    return seen.errors.map((e) => e.code)
  }

  /** A module serving another version would play a different game on this seed. */
  test("a run issued for another manifest", () => {
    expect(refused({ expect: { manifestHash: "other" } })).toEqual([
      "E_WRONG_GAME",
    ])
  })

  test("a tick rate the engine does not run at, and one the game does not", () => {
    expect(refused({ tickHz: 50 })).toEqual(["E_TICK_RATE_UNSUPPORTED"])
    expect(refused({ tickHz: 30 })).toEqual(["E_WRONG_GAME"])
  })

  test("a watched run's stop that is not a whole number above 0", () => {
    for (const maxTicks of [0, -1, 1.5, Number.NaN, undefined]) {
      expect(
        refused({ mode: "watch", inputs: [], maxTicks, scripted: undefined }),
      ).toEqual(["E_ARG_INVALID"])
    }
  })

  /** No run has a step limit; a page asking for one is asking for contract 1. */
  test("a step limit, or no drawing, on a played run", () => {
    expect(refused({ maxTicks: 600 })).toEqual(["E_ARG_INVALID"])
    expect(refused({ draw: false })).toEqual(["E_ARG_INVALID"])
  })

  /** The engine asks every page to say, rather than recording scripted events by default. */
  test("a played run that does not say what to do with a scripted event", () => {
    for (const scripted of [undefined, "maybe"]) {
      expect(refused({ scripted })).toEqual(["E_ARG_INVALID"])
    }
  })

  test("a mode that is neither", () => {
    expect(refused({ mode: "replay" })).toEqual(["E_ARG_INVALID"])
  })

  /** The engine requires a way to tell the player about a blocked controller. */
  test("a gamepad mapped with no one to tell about it", async () => {
    const { game, drawn } = moduleOf({
      capture: { gamepads: { any: { buttons: { 0: "left" } } } },
    })
    const { seen, handlers } = listener()
    const { onNotice: _, ...without } = handlers
    game.mount(stage(), options({ handlers: without, environment: devices() }))
    await settle()
    expect(seen.errors.map((e) => e.code)).toEqual(["E_ARG_INVALID"])
    expect(drawn[0]?.unmounted).toBe(true)
  })
})

describe("what goes wrong while it plays", () => {
  test("a device notice reaches the page and the run goes on", async () => {
    const { game } = moduleOf({
      capture: { gamepads: { any: { buttons: { 0: "left" } } } },
    })
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const blocked: CaptureEnvironment = {
      ...devices(),
      gamepads: () => {
        throw new Error("the page forbids gamepads")
      },
    }
    game.mount(stage(), options({ handlers, scheduler, environment: blocked }))
    await settle()
    scheduler.run(3, FRAME_MS)
    expect(seen.notices).toEqual(["E_GAMEPAD_BLOCKED"])
    expect(seen.errors).toEqual([])
    expect(seen.frames.length).toBe(3)
  })

  test("a game that throws while it is made arrives as unexpected, with its message", async () => {
    let made = 0
    const { game } = moduleOf({
      createGame: () => {
        made += 1
        if (made > 0) throw new Error("cannot make it")
        return new Probe()
      },
    })
    const { seen, handlers } = listener()
    const handle = game.mount(stage(), options({ handlers }))
    await settle()
    expect(seen.errors).toEqual([
      { code: "E_UNEXPECTED", message: "Error: cannot make it" },
    ])
    expect(handle.recorded()).toEqual([])
  })

  test("a game that throws in a tick ends the run, and capture stops", async () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const keys = devices()
    game.mount(
      stage(),
      options({
        handlers,
        scheduler,
        environment: keys,
        config: { throwAt: 3 },
      }),
    )
    await settle()
    scheduler.run(10, FRAME_MS)
    expect(seen.errors).toHaveLength(1)
    expect(seen.errors[0]?.message).toContain("the game broke")
    expect(seen.ended).toEqual([])
    expect(keys.listening()).toBe(0)
  })

  test("a presentation that fails to mount is reported, and the run never starts", async () => {
    const game = definePageModule<View, Config>({
      createGame: () => new Probe(),
      manifest: MANIFEST,
      createPresentation: () => ({
        mount: () => {
          throw new Error("no canvas")
        },
        render: () => {},
        unmount: () => {},
      }),
      capture: KEYS,
    })
    const { seen, handlers } = listener()
    const keys = devices()
    game.mount(stage(), options({ handlers, environment: keys }))
    await settle()
    expect(seen.errors).toEqual([
      {
        code: "E_PRESENTATION_FAILED",
        message: expect.stringContaining("no canvas"),
      },
    ])
    expect(keys.listening()).toBe(0)
  })
})

describe("reading an engine error", () => {
  /**
   * A page holds two copies of the engine, the page module's and the rules
   * code's, so an error is read by the engine's mark and never by its class.
   */
  test("an error from another copy of the engine is read by its mark", () => {
    const foreign = Object.assign(new Error("E_BANNED_API from elsewhere"), {
      code: "E_BANNED_API",
      [Symbol.for("clockwork2.error")]: true,
    })
    expect(mountErrorOf(foreign)).toEqual({
      code: "E_BANNED_API",
      message: "E_BANNED_API from elsewhere",
    })
  })

  test("a mark with a code the engine does not have is not trusted", () => {
    const forged = Object.assign(new Error("nope"), {
      code: "E_MADE_UP",
      [Symbol.for("clockwork2.error")]: true,
    })
    expect(mountErrorOf(forged).code).toBe("E_UNEXPECTED")
    expect(mountErrorOf("a string").code).toBe("E_UNEXPECTED")
  })
})
