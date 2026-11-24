/**
 * Seated play through the page module: two pages playing one match of the
 * two-seat fixture, each mounting its own seat and wired to the other
 * through `onLocalInputs` and `remote`, a page that follows the match, and
 * the merged log watched afterwards with no seats at all.
 *
 * Nothing here builds a `GameHost`: every page mounts the module, as a
 * studio's page or a game's own page does, and passes it plain data.
 */

import { describe, expect, test } from "bun:test"
import type { InputEvent } from "@clockwork2/engine"
import { ManualScheduler } from "@clockwork2/engine/host"
import type {
  MountError,
  MountHandle,
  MountOptions,
} from "../../src/game/contract"
import { definePageModule } from "../../src/game/define"
import {
  FILES,
  FRAME_MS,
  type MatchPage,
  matchPage,
  playMatch,
  SEED,
  seatsOfTicks,
  stage,
  turnsModule,
} from "./match"
import { Drawn, devices, MANIFEST as ONE_SEAT, Probe } from "./subject"

const settle = () => Bun.sleep(0)

describe("a page module says how many seats its game has", () => {
  test("two for the turns fixture, one for a game played alone", () => {
    expect(turnsModule().seats).toBe(2)
    const alone = definePageModule({
      createGame: () => new Probe(),
      manifest: ONE_SEAT,
      createPresentation: () => new Drawn(),
      capture: {},
    })
    expect(alone.seats).toBe(1)
  })
})

describe("two pages playing one match", () => {
  test("reach the same checkpoints and the same merged log, and a follower does too", async () => {
    const { a, b, follower, pressed } = await playMatch()
    for (const page of [a, b, follower]) {
      expect(page.heard.errors).toEqual([])
      expect(page.heard.ended).toHaveLength(1)
    }
    const end = a.heard.ended[0] as {
      tick: number
      inputs: readonly InputEvent[]
    }
    expect(b.heard.ended[0]).toEqual(end)
    expect(follower.heard.ended[0]).toEqual(end)
    expect(b.heard.checkpoints).toEqual(a.heard.checkpoints)
    expect(follower.heard.checkpoints).toEqual(a.heard.checkpoints)
    // Each page's own `recorded()` is the merged log too.
    expect(a.handle.recorded()).toEqual(end.inputs)
    expect(follower.handle.recorded()).toEqual(end.inputs)

    // Not trivially equal: both seats played, the turn passed six times or
    // more, and every input sits on a tick of its own seat's turn.
    const seats = seatsOfTicks(end.inputs, end.tick)
    let changes = 0
    for (let tick = 1; tick < seats.length; tick += 1) {
      if (seats[tick] !== seats[tick - 1]) changes += 1
    }
    expect(changes).toBeGreaterThanOrEqual(5)
    const sentBy = (page: MatchPage) =>
      page.heard.sent.flatMap((call) => call.events)
    const fromA = sentBy(a)
    const fromB = sentBy(b)
    expect(fromA.length).toBeGreaterThan(5)
    expect(fromB.length).toBeGreaterThan(5)
    expect(fromA.every((event) => seats[event.tick] === 0)).toBe(true)
    expect(fromB.every((event) => seats[event.tick] === 1)).toBe(true)
    expect([...fromA, ...fromB].sort((x, y) => x.tick - y.tick)).toEqual([
      ...end.inputs,
    ])
    // The presses made on the other seat's turn were dropped, not recorded.
    expect(fromA.length).toBeLessThan(pressed.a * 2)
    expect(fromB.length).toBeLessThan(pressed.b * 2)
    // A page that follows sends nothing.
    expect(follower.heard.sent).toEqual([])
  })

  test("a page whose opponent stalls waits for that seat, then catches up", async () => {
    const { a, b } = await playMatch({ stallB: 120 })
    expect(a.heard.errors).toEqual([])
    expect(a.heard.ended[0]).toEqual(b.heard.ended[0])
    expect(a.heard.checkpoints).toEqual(b.heard.checkpoints)
    // A's frames said whose inputs it was waiting for, and nothing else.
    const waits = a.heard.waits.filter((seat) => seat !== null)
    expect(waits.length).toBeGreaterThan(20)
    expect(new Set(waits)).toEqual(new Set([1]))
  })

  /** A watched run replays the merged log as any log: no seats, no remote. */
  test("the merged log watched afterwards, with no seats, reaches the same checkpoints", async () => {
    const { a } = await playMatch()
    const end = a.heard.ended[0] as {
      tick: number
      inputs: readonly InputEvent[]
    }
    const checkpoints: Array<{ tick: number; hash: string }> = []
    const errors: MountError[] = []
    const scheduler = new ManualScheduler()
    const module = turnsModule()
    const handle = module.mount(stage(), {
      mode: "watch",
      seed: SEED,
      config: {},
      tickHz: 60,
      inputs: end.inputs,
      maxTicks: Math.max(end.tick, 1),
      expect: { manifestHash: module.manifestHash },
      files: FILES,
      scheduler,
      handlers: {
        onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
        onFrame: () => {},
        onEnded: () => {},
        onError: (error) => errors.push(error),
      },
    })
    expect(handle.remote).toBeNull()
    await settle()
    scheduler.run(end.tick + 10, FRAME_MS)
    expect(errors).toEqual([])
    expect(checkpoints).toEqual(a.heard.checkpoints)
    expect(handle.recorded()).toEqual(end.inputs)
  })

  test("inputs that arrive while the game gets ready are kept for its first ticks", async () => {
    const early = matchPage(1, () => {})
    // Before a tick has run, and before the game is ready.
    expect(
      early.handle.remote?.append([{ tick: 2, code: "shoot", value: 1 }]),
    ).toBeNull()
    expect(early.handle.remote?.confirm(10)).toBeNull()
    await settle()
    early.scheduler.run(8, FRAME_MS)
    expect(early.handle.recorded()).toEqual([
      { tick: 2, code: "shoot", value: 1 },
    ])
    expect(early.heard.errors).toEqual([])
  })

  test("a game prepared before the run plays a seat as a mounted one does", async () => {
    const module = turnsModule()
    const prepared = module.prepare(stage(), { files: FILES })
    expect(await prepared.ready).toBeNull()
    const sent: number[] = []
    const errors: MountError[] = []
    const scheduler = new ManualScheduler()
    const handle = prepared.mount({
      mode: "play",
      seed: SEED,
      config: {},
      tickHz: 60,
      scripted: "ignore",
      seats: {
        local: 0,
        onLocalInputs: (_events, through) => sent.push(through),
      },
      expect: { manifestHash: module.manifestHash },
      scheduler,
      environment: devices(),
      handlers: {
        onCheckpoint: () => {},
        onFrame: () => {},
        onEnded: () => {},
        onError: (error) => errors.push(error),
      },
    })
    expect(handle.remote).not.toBeNull()
    await settle()
    scheduler.run(5, FRAME_MS)
    // Seat 0 acts first, so its page runs a tick each frame and says so.
    expect(sent).toEqual([0, 1, 2, 3, 4])
    expect(errors).toEqual([])
    handle.destroy()
  })
})

describe("the remote answers in plain data", () => {
  async function mounted(): Promise<MatchPage> {
    const page = matchPage(1, () => {})
    await settle()
    return page
  }

  test("a refused append keeps nothing, and the run goes on", async () => {
    const page = await mounted()
    const remote = page.handle.remote
    if (remote === null) throw new Error("a seated run has a remote")
    const refusals = [
      remote.append([
        { tick: 4, code: "shoot", value: 1 },
        { tick: 3, code: "shoot", value: 0 },
      ]),
      remote.append([{ tick: 3, code: "jump", value: 1 }]),
      remote.append([{ tick: 3, code: "shoot", value: 7 }]),
    ]
    expect(refusals.map((refusal) => refusal?.code)).toEqual([
      "E_INPUT_UNSORTED",
      "E_INPUT_UNDECLARED",
      "E_INPUT_UNDECLARED",
    ])
    for (const refusal of refusals) {
      // Plain data, which a page holding no engine can read.
      expect(Object.keys(refusal ?? {}).sort()).toEqual(["code", "message"])
    }
    expect(remote.confirm(20)).toBeNull()
    expect(remote.append([{ tick: 5, code: "shoot", value: 1 }])?.code).toBe(
      "E_INPUT_RANGE",
    )
    expect(remote.confirm(10)?.code).toBe("E_ARG_INVALID")
    expect(remote.confirm(Number.NaN)?.code).toBe("E_ARG_INVALID")
    page.scheduler.run(10, FRAME_MS)
    expect(page.heard.errors).toEqual([])
    expect(page.handle.recorded()).toEqual([])
  })

  test("something that is not a list of inputs is refused, not thrown", async () => {
    const page = await mounted()
    const remote = page.handle.remote
    const answer = remote?.append("shoot" as unknown as readonly InputEvent[])
    expect(answer?.code).toMatch(/^E_/)
  })

  /** The page plays seat 0's ticks itself, so the feed may not carry one. */
  test("an input the other seat sent for this seat's tick ends the run with the engine's code", async () => {
    const page = matchPage(0, () => {})
    await settle()
    expect(
      page.handle.remote?.append([{ tick: 1, code: "shoot", value: 1 }]),
    ).toBeNull()
    page.handle.remote?.confirm(400)
    page.scheduler.run(400, FRAME_MS)
    expect(page.heard.errors.map((error) => error.code)).toEqual([
      "E_INPUT_SEAT",
    ])
  })
})

describe("what a mount refuses about seats before anything is built", () => {
  function refusedTurns(extra: Record<string, unknown>): {
    codes: string[]
    handle: MountHandle
  } {
    const module = turnsModule()
    const errors: MountError[] = []
    const handle = module.mount(stage(), {
      mode: "play",
      seed: SEED,
      config: {},
      tickHz: 60,
      scripted: "ignore",
      expect: { manifestHash: module.manifestHash },
      files: FILES,
      handlers: {
        onCheckpoint: () => {},
        onFrame: () => {},
        onEnded: () => {},
        onError: (error: MountError) => errors.push(error),
      },
      ...extra,
    } as unknown as MountOptions)
    return { codes: errors.map((error) => error.code), handle }
  }

  test("a game of two seats played with no seats", () => {
    const { codes, handle } = refusedTurns({})
    expect(codes).toEqual(["E_SEATS_REQUIRED"])
    expect(handle.remote).toBeNull()
    expect(handle.recorded()).toEqual([])
  })

  test("a seat the game does not have, or seats that are not seats", () => {
    for (const local of [2, -1, 1.5, "0", undefined]) {
      expect(refusedTurns({ seats: { local } }).codes).toEqual([
        "E_ARG_INVALID",
      ])
    }
    for (const seats of [null, 1, "0"]) {
      expect(refusedTurns({ seats }).codes).toEqual(["E_ARG_INVALID"])
    }
    expect(
      refusedTurns({ seats: { local: 0, onLocalInputs: "send" } }).codes,
    ).toEqual(["E_ARG_INVALID"])
  })

  /** A page that follows records nothing, so a sender given to it would never be called. */
  test("a page that follows given somewhere to send its inputs", () => {
    expect(
      refusedTurns({ seats: { local: null, onLocalInputs: () => {} } }).codes,
    ).toEqual(["E_ARG_INVALID"])
  })

  test("a watched run given seats", () => {
    expect(
      refusedTurns({
        mode: "watch",
        inputs: [],
        maxTicks: 60,
        scripted: undefined,
        seats: { local: 0 },
      }).codes,
    ).toEqual(["E_SEATS_UNEXPECTED"])
  })

  test("a game of one seat given seats", () => {
    const module = definePageModule({
      createGame: () => new Probe(),
      manifest: ONE_SEAT,
      createPresentation: () => new Drawn(),
      capture: {},
    })
    const errors: MountError[] = []
    const handle = module.mount(stage(), {
      mode: "play",
      seed: "seed-1",
      config: {},
      tickHz: 60,
      scripted: "ignore",
      seats: { local: 0 },
      expect: { manifestHash: module.manifestHash },
      files: FILES,
      handlers: {
        onCheckpoint: () => {},
        onFrame: () => {},
        onEnded: () => {},
        onError: (error) => errors.push(error),
      },
    })
    expect(errors.map((error) => error.code)).toEqual(["E_SEATS_UNEXPECTED"])
    expect(handle.remote).toBeNull()
  })
})
