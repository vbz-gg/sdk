/**
 * A page module, driven the way a studio's page drives one: a real engine
 * host on a clock the test moves, a presentation that records what it was
 * asked, and keys dispatched on a stand-in window.
 */

import { describe, expect, test } from "bun:test"
import {
  hashCanonical,
  type InputEvent,
  type PlainValue,
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
    readonly manifest?: typeof MANIFEST
  } = {},
) {
  const drawn: Drawn[] = []
  const game = definePageModule<View, Config>({
    createGame: overrides.createGame ?? (() => new Probe()),
    manifest: overrides.manifest ?? MANIFEST,
    createPresentation: () => {
      const presentation = new Drawn()
      drawn.push(presentation)
      return presentation
    },
    capture: overrides.capture ?? KEYS,
  })
  return { game, drawn }
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

function options(
  extra: Partial<MountOptions> & Pick<MountOptions, "handlers">,
): MountOptions {
  return {
    mode: "play",
    seed: "seed-1",
    config: { endAt: 120 },
    tickHz: 60,
    maxTicks: 600,
    expect: { manifestHash: HASH },
    ...extra,
  }
}

describe("what a page module says about itself", () => {
  test("its contract, its manifest's hash, and whether it reads tilt", () => {
    const { game } = moduleOf()
    expect(game.contract).toBe(PAGE_MODULE_CONTRACT)
    expect(game.contract).toBe(1)
    expect(game.manifestHash).toBe(HASH)
    expect(game.needsMotion).toBe(false)
    const tilting = moduleOf({
      capture: { tilt: { x: "aimX" } },
      manifest: MANIFEST,
    }).game
    expect(tilting.needsMotion).toBe(true)
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

  test("a data pack the rules code reads is refused, as the platform refuses one", () => {
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
    expect(problems.map((p) => p.code)).toEqual(["E_SIM_PACKS"])
  })
})

describe("playing a run", () => {
  test("each handler hears its part, and the end carries the recording", () => {
    const { game, drawn } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const keys = devices()
    const handle = game.mount(
      stage(2),
      options({ handlers, scheduler, environment: keys }),
    )
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
  test("capture stops listening when the run ends, and when it is destroyed", () => {
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
    handle.destroy()
    expect(destroyed.listening()).toBe(0)
    // Destroying is not ending: nothing is reported, and what was drawn goes.
    expect(seen.ended).toEqual([])
    expect(drawn.at(-1)?.unmounted).toBe(true)
  })

  test("a player leaving ends the run where it stands, as abandoned", () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const handle = game.mount(
      stage(),
      options({ handlers, scheduler, environment: devices() }),
    )
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

  test("a run stops at the manifest's own cap whatever it was issued", () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    game.mount(
      stage(),
      options({
        handlers,
        scheduler,
        environment: devices(),
        config: { endAt: 10_000 },
        maxTicks: 50_000,
      }),
    )
    scheduler.run(700, FRAME_MS)
    expect(seen.ended[0]).toMatchObject({ tick: 600, reason: "timeout" })
  })
})

describe("watching a run", () => {
  const LOG: InputEvent[] = [
    { tick: 5, code: "left", value: 1 },
    { tick: 6, code: "left", value: 0 },
    { tick: 20, code: "left", value: 1 },
  ]

  /** Watching an abandoned run stops where its player left it. */
  test("it replays the log to the cap it is given, and hears no key", () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    const scheduler = new ManualScheduler()
    const keys = devices()
    const handle = game.mount(
      stage(),
      options({
        mode: "watch",
        inputs: LOG,
        maxTicks: 30,
        handlers,
        scheduler,
        environment: keys,
      }),
    )
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
    const handle = game.mount(stage(), options({ mode: "watch", handlers }))
    expect(seen.errors.map((e) => e.code)).toEqual(["E_ARG_INVALID"])
    expect(drawn).toEqual([])
    expect(handle.recorded()).toEqual([])
    handle.stop()
    handle.destroy()
  })

  test("a log the engine cannot replay arrives as its own code", () => {
    const { game } = moduleOf()
    const { seen, handlers } = listener()
    game.mount(
      stage(),
      options({
        mode: "watch",
        inputs: [
          { tick: 9, code: "left", value: 1 },
          { tick: 2, code: "left", value: 1 },
        ],
        handlers,
      }),
    )
    expect(seen.errors.map((e) => e.code)).toEqual(["E_INPUT_UNSORTED"])
  })
})

describe("what a mount refuses before a tick runs", () => {
  function refused(extra: Partial<MountOptions>): string[] {
    const { game, drawn } = moduleOf()
    const { seen, handlers } = listener()
    game.mount(stage(), options({ handlers, ...extra }))
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

  test("a cap that is not a whole number above 0", () => {
    for (const maxTicks of [0, -1, 1.5, Number.NaN]) {
      expect(refused({ maxTicks })).toEqual(["E_ARG_INVALID"])
    }
  })

  /** The engine requires a way to tell the player about a blocked controller. */
  test("a gamepad mapped with no one to tell about it", () => {
    const { game, drawn } = moduleOf({
      capture: { gamepads: { any: { buttons: { 0: "left" } } } },
    })
    const { seen, handlers } = listener()
    const { onNotice: _, ...without } = handlers
    game.mount(stage(), options({ handlers: without, environment: devices() }))
    expect(seen.errors.map((e) => e.code)).toEqual(["E_ARG_INVALID"])
    expect(drawn[0]?.context).toBeNull()
  })
})

describe("what goes wrong while it plays", () => {
  test("a device notice reaches the page and the run goes on", () => {
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
    scheduler.run(3, FRAME_MS)
    expect(seen.notices).toEqual(["E_GAMEPAD_BLOCKED"])
    expect(seen.errors).toEqual([])
    expect(seen.frames.length).toBe(3)
  })

  test("a game that throws while it is made arrives as unexpected, with its message", () => {
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
    expect(seen.errors).toEqual([
      { code: "E_UNEXPECTED", message: "Error: cannot make it" },
    ])
    expect(handle.recorded()).toEqual([])
  })

  test("a game that throws in a tick ends the run, and capture stops", () => {
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
    scheduler.run(10, FRAME_MS)
    expect(seen.errors).toHaveLength(1)
    expect(seen.errors[0]?.message).toContain("the game broke")
    expect(seen.ended).toEqual([])
    expect(keys.listening()).toBe(0)
  })

  test("a presentation that fails to mount is reported, and the run never starts", () => {
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
    expect(seen.errors).toEqual([
      { code: "E_UNEXPECTED", message: "Error: no canvas" },
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
