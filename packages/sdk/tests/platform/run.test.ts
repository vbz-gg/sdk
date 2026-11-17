/**
 * The run driver, against a mount that reports what a page module would and
 * a client that answers as the platform would. What it has to get right is
 * what reaches the platform, and in what order.
 */

import { describe, expect, test } from "bun:test"
import type { InputEvent, Recording } from "@clockwork2/engine"
import type { RunChunk, RunResult, StartedRun } from "../../src/api/index"
import type {
  MountHandle,
  MountHandlers,
  PlayMount,
} from "../../src/game/contract"
import { PlatformClientError, PlatformRefusal } from "../../src/platform/errors"
import { RUN_PHASE, Run, type RunState } from "../../src/platform/run"
import { settle } from "./fake-page"

const RUN: StartedRun = {
  sessionId: "s-1",
  mode: "ranked",
  day: "2026-11-11",
  rankedRunsLeft: 2,
  seed: "seed-1",
  config: { speed: 1 },
  game: {
    id: "v-1",
    presentUrl: "https://bundles.example/g/g-1/present/p.js",
    manifestHash: "mh-1",
    filesUrl: "https://bundles.example/g/g-1/t/f/",
    manifest: { id: "lane-runner" },
    tickHz: 60,
  },
  limits: { chunkBytes: 1_048_576, runBytes: 27_262_976 },
  token: "t-run",
  expiresIn: 7_776_000,
}

const RESULT: RunResult = {
  sessionId: "s-1",
  mode: "ranked",
  day: "2026-11-11",
  state: "settled",
  committed: true,
  replay: { fault: null, code: null, counters: { motes: 4 }, endTick: 300 },
}

const RECORDING = { format: "cw2-recording", v: 1 } as unknown as Recording

type Outcome = "ok" | "unreachable" | "refused" | "failed"

function failure(outcome: Exclude<Outcome, "ok">): Error {
  if (outcome === "unreachable") return new PlatformClientError("E_UNREACHABLE")
  if (outcome === "failed") {
    return new PlatformRefusal(500, {
      error: "E_INTERNAL",
      message: "something went wrong",
    })
  }
  return new PlatformRefusal(400, {
    error: "E_CHUNKS_INCOMPLETE",
    message: "what was committed does not reach the end of the run",
  })
}

const wireBytes = (body: unknown) =>
  new TextEncoder().encode(JSON.stringify(body)).byteLength

function tooLarge(code: "E_BODY_TOO_LARGE" | "E_RUN_TOO_LARGE"): Error {
  return new PlatformRefusal(413, { error: code, message: "over the cap" })
}

/**
 * A client that records each call, answers from a script per kind, and
 * holds a run's chunks and recording to its byte caps as the platform does.
 */
function fakeClient(script: {
  chunks?: Outcome[]
  submits?: Outcome[]
  result?: RunResult | Error
}) {
  const order: string[] = []
  const chunks: RunChunk[] = []
  const chunkOutcomes = [...(script.chunks ?? [])]
  const submitOutcomes = [...(script.submits ?? [])]
  // The run's byte caps, held as the platform holds them.
  let committed = 0
  return {
    order,
    chunks,
    committed: () => committed,
    client: {
      async sendChunk(run: StartedRun, chunk: RunChunk) {
        expect(run.token).toBe("t-run")
        order.push(`chunk ${chunk.seq}`)
        const outcome = chunkOutcomes.shift() ?? "ok"
        if (outcome !== "ok") throw failure(outcome)
        const bytes = wireBytes(chunk)
        if (bytes > run.limits.chunkBytes) throw tooLarge("E_BODY_TOO_LARGE")
        if (committed + bytes > run.limits.runBytes) {
          throw tooLarge("E_RUN_TOO_LARGE")
        }
        committed += bytes
        chunks.push(chunk)
        return { seq: chunk.seq, throughTick: chunk.throughTick }
      },
      async submit(run: StartedRun, recording: unknown) {
        order.push(`submit ${JSON.stringify(recording)}`)
        const outcome = submitOutcomes.shift() ?? "ok"
        if (outcome !== "ok") throw failure(outcome)
        if (wireBytes({ recording }) > run.limits.runBytes) {
          throw tooLarge("E_RUN_TOO_LARGE")
        }
        return { sessionId: run.sessionId, recordingSha256: "r" }
      },
      async awaitResult(sessionId: string, options?: { token?: string }) {
        expect(options?.token).toBe("t-run")
        order.push(`result ${sessionId}`)
        if (script.result instanceof Error) throw script.result
        return script.result ?? RESULT
      },
    },
  }
}

/**
 * A page module's mount, as the run sees it: what it was asked, the log it
 * is recording, and a `stop` that ends the run as a real one does, at once.
 */
class FakeGame implements MountHandle {
  options: PlayMount | null = null
  readonly log: InputEvent[] = []
  readonly calls: string[] = []
  tick = 0

  get handlers(): MountHandlers {
    if (this.options === null) throw new Error("not mounted")
    return this.options.handlers
  }

  mount = (options: PlayMount): MountHandle => {
    this.options = options
    return this
  }

  recorded(): readonly InputEvent[] {
    return this.log
  }

  stop(reason = "abandoned"): void {
    this.calls.push(`stop ${reason}`)
    this.handlers.onEnded({
      tick: this.tick,
      reason: reason as "abandoned",
      counters: {},
      recording: RECORDING,
    })
  }

  destroy(): void {
    this.calls.push("destroy")
  }

  /** The game reaching `tick`, with what it recorded on the way. */
  frame(tick: number, counters: Record<string, number> = {}): void {
    this.tick = tick
    this.handlers.onFrame({ tick, counters })
  }

  press(tick: number): void {
    this.log.push({ tick, code: "left", value: 1 })
  }

  end(tick: number, counters: Record<string, number> = { motes: 4 }): void {
    this.tick = tick
    this.handlers.onEnded({
      tick,
      reason: "completed",
      counters,
      recording: RECORDING,
    })
  }
}

function start(
  script: Parameters<typeof fakeClient>[0] = {},
  run: StartedRun = RUN,
  extra: { chunkSeconds?: number; retryDelayMs?: number } = {},
) {
  const game = new FakeGame()
  const fake = fakeClient(script)
  const states: RunState[] = []
  const driver = new Run({
    client: fake.client,
    onState: (state) => states.push(state),
    retryDelayMs: extra.retryDelayMs ?? 1,
    ...(extra.chunkSeconds === undefined
      ? {}
      : { chunkSeconds: extra.chunkSeconds }),
  })
  expect(driver.current.phase).toBe(RUN_PHASE.LOADING)
  driver.play(run, game.mount)
  return { game, driver, states, ...fake }
}

/** A run that played 300 ticks with two presses, ended, and submitted. */
async function playedThrough(ready: ReturnType<typeof start>) {
  const { game } = ready
  game.press(42)
  game.handlers.onCheckpoint({ tick: 60, hash: "h60" })
  game.frame(120, { motes: 1 })
  game.press(200)
  game.end(300)
  await settle()
}

describe("before a tick runs", () => {
  /**
   * No step limit: the run goes until the game or the player ends it. And a
   * ranked run's inputs come from the player's devices alone.
   */
  test("the game is mounted with the run's seed, config, rate and hash, and no step limit", () => {
    const { game, states, driver } = start()
    expect(game.options).toEqual({
      mode: "play",
      seed: "seed-1",
      config: { speed: 1 },
      tickHz: 60,
      scripted: "ignore",
      expect: { manifestHash: "mh-1" },
      handlers: expect.any(Object),
    })
    expect(states.map((s) => s.phase)).toEqual([RUN_PHASE.PLAYING])
    expect(driver.current.phase).toBe(RUN_PHASE.PLAYING)
    expect(driver.started).toBe(RUN)
  })

  /** A module serving another version would play a different game on this seed. */
  test("a mount the game refuses fails the run with the game's code", () => {
    const states: RunState[] = []
    const driver = new Run({
      client: fakeClient({}).client,
      onState: (state) => states.push(state),
    })
    driver.play(RUN, (options) => {
      options.handlers.onError({
        code: "E_WRONG_GAME",
        message: "this page module is manifest mh-2",
      })
      return { recorded: () => [], stop() {}, destroy() {} }
    })
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_WRONG_GAME",
      detail: "this page module is manifest mh-2",
    })
  })

  test("a mount that throws rather than reporting fails the run", () => {
    const states: RunState[] = []
    const driver = new Run({
      client: fakeClient({}).client,
      onState: (state) => states.push(state),
    })
    driver.play(RUN, () => {
      throw new TypeError("not a page module this release built")
    })
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_UNEXPECTED",
      detail: "TypeError: not a page module this release built",
    })
    driver.end()
    expect(driver.current.phase).toBe(RUN_PHASE.FAILED)
  })

  test("a run refused while it loads fails with the refusal's code, once", () => {
    const states: RunState[] = []
    const driver = new Run({
      client: fakeClient({}).client,
      onState: (state) => states.push(state),
    })
    driver.refuse(
      new PlatformRefusal(409, {
        error: "E_RANKED_PAUSED",
        message: "ranked play is paused",
      }),
    )
    driver.refuse(new PlatformClientError("E_UNREACHABLE"))
    const game = new FakeGame()
    driver.play(RUN, game.mount)
    expect(game.options).toBeNull()
    expect(states).toEqual([
      {
        phase: RUN_PHASE.FAILED,
        errorCode: "E_RANKED_PAUSED",
        detail: "ranked play is paused",
        refusalDetail: null,
        result: null,
      },
    ])
  })

  /**
   * A game that cannot get ready says so as plain data, the module's classes
   * not being the page's: a pack that never arrived, in the engine's words.
   */
  test("a game's own failure before it plays fails the run with its code and words", () => {
    const states: RunState[] = []
    const driver = new Run({
      client: fakeClient({}).client,
      onState: (state) => states.push(state),
    })
    driver.refuse({
      code: "E_PACK_NOT_DELIVERED",
      message: "packs/level.json answered 404",
    })
    expect(states).toEqual([
      {
        phase: RUN_PHASE.FAILED,
        errorCode: "E_PACK_NOT_DELIVERED",
        detail: "packs/level.json answered 404",
        refusalDetail: null,
        result: null,
      },
    ])
  })

  /** So a page can say when a bar ends, which the sentence alone does not. */
  test("a refusal's own detail reaches the state, and nothing else's does", () => {
    const states: RunState[] = []
    const driver = new Run({
      client: fakeClient({}).client,
      onState: (state) => states.push(state),
    })
    driver.refuse(
      new PlatformRefusal(403, {
        error: "E_PLAYER_BARRED",
        message: "barred",
        detail: { until: "2026-11-17T09:00:00.000Z" },
      }),
    )
    expect(states[0]?.errorCode).toBe("E_PLAYER_BARRED")
    expect(states[0]?.refusalDetail).toEqual({
      until: "2026-11-17T09:00:00.000Z",
    })

    const other: RunState[] = []
    const client = new Run({
      client: fakeClient({}).client,
      onState: (state) => other.push(state),
    })
    client.refuse(new PlatformClientError("E_UNREACHABLE"))
    expect(other[0]?.refusalDetail).toBeNull()
  })

  test("a client error carries what it was about into the detail", () => {
    const states: RunState[] = []
    const driver = new Run({
      client: fakeClient({}).client,
      onState: (state) => states.push(state),
    })
    driver.refuse(
      new PlatformClientError("E_GAME_UNLOADABLE", {
        cause: { url: "https://bundles.example/x.js" },
      }),
    )
    expect(states.at(-1)?.detail).toContain(
      '"url":"https://bundles.example/x.js"',
    )
    const other = new Run({
      client: fakeClient({}).client,
      onState: (state) => states.push(state),
    })
    other.refuse(
      new PlatformClientError("E_UNEXPECTED", { cause: new TypeError("boom") }),
    )
    expect(states.at(-1)?.detail).toContain("TypeError: boom")
    const third = new Run({
      client: fakeClient({}).client,
      onState: (state) => states.push(state),
    })
    third.refuse(new PlatformClientError("E_UNEXPECTED", { cause: "plain" }))
    expect(states.at(-1)?.detail).toContain(": plain")
  })

  test("a run that already plays is not played again", () => {
    const { driver } = start()
    const second = new FakeGame()
    driver.play(RUN, second.mount)
    expect(second.options).toBeNull()
  })
})

describe("committing the run as it goes", () => {
  /**
   * One chunk every two seconds of play: often enough that a closed tab loses
   * little, rare enough that a run is a few hundred requests at most.
   */
  test("a chunk goes every two seconds of play, ending one tick short", async () => {
    const { game, chunks } = start()
    game.handlers.onCheckpoint({ tick: 0, hash: "h0" })
    game.press(42)
    game.frame(60)
    game.frame(119)
    expect(chunks).toEqual([])
    game.frame(120, { motes: 2 })
    game.handlers.onCheckpoint({ tick: 120, hash: "h120" })
    game.press(150)
    game.frame(240)
    await settle()
    expect(
      chunks.map((c) => [
        c.seq,
        c.throughTick,
        c.checkpoints.length,
        c.inputs.length,
      ]),
    ).toEqual([
      [0, 119, 1, 1],
      [1, 239, 1, 1],
    ])
    expect(chunks[0]?.inputs).toEqual([{ tick: 42, code: "left", value: 1 }])
    expect(chunks[0]?.counters).toEqual({ motes: 2 })
  })

  test("the interval is the run's own rate times the seconds asked", async () => {
    const { game, chunks } = start(
      {},
      { ...RUN, game: { ...RUN.game, tickHz: 30 } },
      { chunkSeconds: 1 },
    )
    game.press(3)
    game.frame(29)
    game.frame(30)
    await settle()
    expect(chunks.map((c) => c.throughTick)).toEqual([29])
  })

  test("an interval with nothing new sends nothing", async () => {
    const { game, chunks } = start()
    game.frame(120)
    game.frame(240)
    await settle()
    expect(chunks).toEqual([])
  })

  test("a chunk that got no answer goes again, unchanged, before the next", async () => {
    const { game, order, chunks } = start({
      chunks: ["unreachable", "ok", "ok"],
    })
    game.press(10)
    game.frame(120)
    await settle()
    game.press(130)
    game.frame(240)
    await settle()
    expect(order).toEqual(["chunk 0", "chunk 0", "chunk 1"])
    expect(chunks.map((c) => c.seq)).toEqual([0, 1])
  })

  /**
   * After a refusal the platform has taken nothing of that body, and the
   * next chunk would build on it. An honest page stops there.
   */
  test("after a refused chunk nothing more is sent, and the run fails with its code", async () => {
    const { game, order, states } = start({ chunks: ["refused"] })
    game.press(10)
    game.frame(120)
    await settle()
    game.press(130)
    game.frame(240)
    game.end(300)
    await settle()
    expect(order).toEqual(["chunk 0"])
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_CHUNKS_INCOMPLETE",
    })
    // The game is stopped where it stands, so nobody plays on into nothing.
    expect(game.calls).toEqual(["stop abandoned"])
  })

  test("a chunk over the run's byte cap is cut between ticks, in order", async () => {
    const small = { ...RUN, limits: { chunkBytes: 400, runBytes: 1_000_000 } }
    const { game, chunks } = start({}, small)
    for (let tick = 1; tick <= 20; tick += 1) game.press(tick)
    game.handlers.onCheckpoint({ tick: 60, hash: "h60" })
    game.frame(120)
    await settle()
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, at) => at))
    for (const chunk of chunks) {
      expect(
        new TextEncoder().encode(JSON.stringify(chunk)).byteLength,
      ).toBeLessThanOrEqual(400)
    }
    expect(chunks.flatMap((c) => c.inputs)).toEqual(game.log)
    expect(chunks.at(-1)?.throughTick).toBe(119)
    expect(chunks.at(-1)?.checkpoints).toEqual([{ tick: 60, hash: "h60" }])
  })

  /** What the platform would refuse whole is ended before it gets there. */
  test("a run about to outgrow what the platform takes ends as abandoned", async () => {
    const tight = { ...RUN, limits: { chunkBytes: 1_000, runBytes: 1_500 } }
    const { game, chunks, order, states } = start({}, tight)
    for (let tick = 1; tick <= 20; tick += 1) game.press(tick)
    game.frame(120)
    await settle()
    expect(game.calls).toEqual(["stop abandoned"])
    expect(order.at(-2)).toBe(`submit ${JSON.stringify(RECORDING)}`)
    expect(chunks.at(-1)?.throughTick).toBe(120)
    expect(states.at(-1)?.phase).toBe(RUN_PHASE.DONE)
  })
})

describe("staying inside what the platform takes", () => {
  /**
   * A chunk the cap cannot take is refused, and a refusal fails the run. One
   * commit can be several pieces, so the room is checked before each piece,
   * and a run that cannot send the next one ends where its chunks reach,
   * as a player leaving it: the platform settles it from what it committed.
   */
  test("a commit cut into pieces past the run's cap ends the run where its chunks reach", async () => {
    const tight = { ...RUN, limits: { chunkBytes: 300, runBytes: 1_300 } }
    const { game, chunks, order, states, committed } = start({}, tight)
    for (let tick = 1; tick <= 5; tick += 1) game.press(tick)
    game.frame(120)
    for (let tick = 121; tick <= 160; tick += 1) game.press(tick)
    game.frame(240)
    await settle()
    expect(states.map((state) => state.errorCode)).not.toContain(
      "E_RUN_TOO_LARGE",
    )
    expect(committed()).toBeLessThanOrEqual(1_300)
    expect(game.calls).toEqual(["stop abandoned"])
    // Nothing past the last chunk the platform took was claimed.
    expect(order.some((call) => call.startsWith("submit"))).toBe(false)
    expect(chunks.at(-1)?.throughTick).toBeLessThan(240)
    expect(order.at(-1)).toBe("result s-1")
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.DONE,
      result: RESULT,
    })
  })

  test("a last commit past the run's cap sends what fits, and submits nothing", async () => {
    const tight = { ...RUN, limits: { chunkBytes: 300, runBytes: 1_000 } }
    const { game, chunks, order, states, committed } = start({}, tight)
    for (let tick = 1; tick <= 40; tick += 1) game.press(tick)
    game.end(50)
    await settle()
    expect(states.map((state) => state.phase)).not.toContain(RUN_PHASE.FAILED)
    expect(chunks.length).toBeGreaterThan(0)
    expect(committed()).toBeLessThanOrEqual(1_000)
    expect(chunks.at(-1)?.throughTick).toBeLessThan(50)
    expect(order.some((call) => call.startsWith("submit"))).toBe(false)
    expect(states.at(-1)?.phase).toBe(RUN_PHASE.DONE)
  })

  /** A recording is a body of its own, held to the same cap. */
  test("a recording too large to submit is not sent, and the chunks settle the run", async () => {
    const { game, order, states } = start(
      {},
      { ...RUN, limits: { chunkBytes: 1_000, runBytes: 2_000 } },
    )
    game.press(10)
    game.handlers.onEnded({
      tick: 20,
      reason: "completed",
      counters: {},
      recording: { pad: "x".repeat(2_000) } as unknown as Recording,
    })
    await settle()
    expect(order).toEqual(["chunk 0", "result s-1"])
    expect(states.at(-1)?.phase).toBe(RUN_PHASE.DONE)
  })
})

describe("the end of the run", () => {
  test("the last chunk reaches the end, then the recording, then the result", async () => {
    const ready = start()
    await playedThrough(ready)
    expect(ready.order).toEqual([
      "chunk 0",
      "chunk 1",
      `submit ${JSON.stringify(RECORDING)}`,
      "result s-1",
    ])
    expect(ready.chunks.map((c) => c.throughTick)).toEqual([119, 300])
    expect(ready.chunks.at(-1)?.counters).toEqual({ motes: 4 })
    expect(ready.states.map((s) => s.phase)).toEqual([
      RUN_PHASE.PLAYING,
      RUN_PHASE.SUBMITTING,
      RUN_PHASE.REPLAYING,
      RUN_PHASE.DONE,
    ])
    expect(ready.states.at(-1)?.result).toEqual(RESULT)
  })

  test("a run that ends with nothing since the last chunk still marks its end", async () => {
    const ready = start()
    ready.game.press(10)
    ready.game.frame(120)
    ready.game.end(120)
    await settle()
    expect(ready.chunks.map((c) => c.throughTick)).toEqual([119, 120])
  })

  test("a second end is not a second submit", async () => {
    const ready = start()
    ready.game.end(10)
    ready.game.end(10)
    await settle()
    expect(
      ready.order.filter((call) => call.startsWith("submit")),
    ).toHaveLength(1)
  })

  test("a final chunk that got no answer goes before the recording", async () => {
    const ready = start({ chunks: ["ok", "unreachable", "ok"] })
    await playedThrough(ready)
    expect(ready.order).toEqual([
      "chunk 0",
      "chunk 1",
      "chunk 1",
      `submit ${JSON.stringify(RECORDING)}`,
      "result s-1",
    ])
  })

  test("a final chunk still unsent holds the recording back", async () => {
    // Sent with the recording first, the platform would find the chunks short
    // of the end and refuse the run for good.
    const ready = start({ chunks: ["ok", "unreachable", "unreachable", "ok"] })
    await playedThrough(ready)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ready.order).toEqual([
      "chunk 0",
      "chunk 1",
      "chunk 1",
      "chunk 1",
      `submit ${JSON.stringify(RECORDING)}`,
      "result s-1",
    ])
  })

  test("a final chunk that never arrives fails the run, and nothing is submitted", async () => {
    const ready = start({
      chunks: ["ok", ...Array<Outcome>(6).fill("unreachable")],
    })
    await playedThrough(ready)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ready.order.some((call) => call.startsWith("submit"))).toBe(false)
    expect(ready.states.at(-1)?.errorCode).toBe("E_UNREACHABLE")
  })

  test("a submit that got no answer, or that the platform failed, goes again", async () => {
    const ready = start({ submits: ["unreachable", "failed", "ok"] })
    await playedThrough(ready)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(
      ready.order.filter((call) => call.startsWith("submit")),
    ).toHaveLength(3)
    expect(ready.states.at(-1)?.phase).toBe(RUN_PHASE.DONE)
  })

  test("a submit the platform refuses fails the run with its code", async () => {
    const ready = start({ submits: ["refused"] })
    await playedThrough(ready)
    expect(ready.states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_CHUNKS_INCOMPLETE",
    })
  })

  test("a submit that never gets an answer fails after its attempts", async () => {
    const ready = start({
      submits: [
        "unreachable",
        "unreachable",
        "unreachable",
        "unreachable",
        "unreachable",
      ],
    })
    await playedThrough(ready)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(
      ready.order.filter((call) => call.startsWith("submit")),
    ).toHaveLength(5)
    expect(ready.states.at(-1)?.errorCode).toBe("E_UNREACHABLE")
  })

  test("a result the platform refuses fails the run", async () => {
    const ready = start({
      result: new PlatformRefusal(401, {
        error: "E_SIGN_IN_REQUIRED",
        message: "sign in",
      }),
    })
    await playedThrough(ready)
    expect(ready.states.at(-1)?.errorCode).toBe("E_SIGN_IN_REQUIRED")
  })

  test("an error that is neither kind still ends the run, naming it", async () => {
    const ready = start({ result: new TypeError("a bug") })
    await playedThrough(ready)
    expect(ready.states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_UNEXPECTED",
      detail: "TypeError: a bug",
    })
  })

  test("the game's own error fails the run, with the engine's code and what it said", () => {
    const { game, states } = start()
    game.handlers.onError({
      code: "E_BANNED_API",
      message: "E_BANNED_API@12 a banned global was used",
    })
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_BANNED_API",
      detail: "E_BANNED_API@12 a banned global was used",
    })
  })

  test("a device notice reaches the page and stops nothing", () => {
    const notices: string[] = []
    const game = new FakeGame()
    const driver = new Run({
      client: fakeClient({}).client,
      onNotice: (notice) => notices.push(notice.code),
    })
    driver.play(RUN, game.mount)
    game.handlers.onNotice?.({ code: "E_GAMEPAD_BLOCKED", detail: "policy" })
    expect(notices).toEqual(["E_GAMEPAD_BLOCKED"])
    expect(driver.current.phase).toBe(RUN_PHASE.PLAYING)
  })
})

describe("after a failure", () => {
  test("nothing more is sent, and the failure is the last state", async () => {
    const { game, states, order } = start()
    game.handlers.onError({ code: "E_UNEXPECTED", message: "tick threw" })
    game.press(150)
    game.handlers.onCheckpoint({ tick: 180, hash: "h" })
    game.frame(200)
    game.end(300)
    await settle()
    expect(order).toEqual([])
    expect(states.at(-1)?.errorCode).toBe("E_UNEXPECTED")
  })

  test("destroying a run waiting to resend a submit stops it at once", async () => {
    const ready = start({ submits: ["unreachable", "ok"] }, RUN, {
      retryDelayMs: 60_000,
    })
    await playedThrough(ready)
    ready.driver.destroy()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(
      ready.order.filter((call) => call.startsWith("submit")),
    ).toHaveLength(1)
    expect(ready.game.calls).toEqual(["destroy"])
  })
})

describe("leaving", () => {
  test("leaving ends the run where it stands, and it is submitted", async () => {
    const ready = start()
    ready.game.press(30)
    ready.game.tick = 45
    ready.driver.end()
    await settle()
    expect(ready.game.calls).toEqual(["stop abandoned"])
    expect(ready.order).toEqual([
      "chunk 0",
      `submit ${JSON.stringify(RECORDING)}`,
      "result s-1",
    ])
    expect(ready.chunks[0]?.throughTick).toBe(45)
  })

  test("destroying stops everything, and nothing after it is sent or told", async () => {
    const ready = start()
    ready.driver.destroy()
    const seen = ready.states.length
    ready.game.press(10)
    ready.game.frame(120)
    ready.game.end(130)
    await settle()
    expect(ready.game.calls).toEqual(["destroy"])
    expect(ready.order).toEqual([])
    expect(ready.states).toHaveLength(seen)
  })

  /** Before it plays there is nothing to submit, so leaving stops it. */
  test("leaving a run still loading stops it, and it never plays", () => {
    const states: RunState[] = []
    const driver = new Run({
      client: fakeClient({}).client,
      onState: (state) => states.push(state),
    })
    driver.end()
    const game = new FakeGame()
    driver.play(RUN, game.mount)
    expect(game.options).toBeNull()
    expect(states).toEqual([])
    // Ending a run that failed before it played does nothing more.
    const failed = new Run({ client: fakeClient({}).client })
    failed.refuse(new PlatformClientError("E_UNREACHABLE"))
    failed.end()
    expect(failed.current.phase).toBe(RUN_PHASE.FAILED)
  })
})
