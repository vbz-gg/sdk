/**
 * The stand-in for the platform, driven by the page's own client over real
 * HTTP: a player signed in through its window, a run started, committed in
 * chunks, submitted and settled, read back to watch, and the board. And the
 * refusals a page has to handle, each with the code the platform answers it
 * with, so a page built against the stand-in handles what production sends.
 */

import { afterEach, describe, expect, test } from "bun:test"
import {
  hashCanonical,
  type PlainValue,
  type Recording,
} from "@clockwork2/engine"
import { ManualScheduler } from "@clockwork2/engine/host"
import type { RunChunk } from "../../src/api/index"
import { MAX_CHUNK_BYTES, MAX_RUN_BYTES } from "../../src/build/limits"
import type { MountHandlers } from "../../src/game/contract"
import { definePageModule } from "../../src/game/define"
import { LOOPBACK } from "../../src/harness/servers"
import {
  LOCAL_PLAYER,
  type RunningStandIn,
  STAND_IN_LIMITS,
  STAND_IN_PAGE_KEY,
  STAND_IN_STATUS,
  type StandInOptions,
  startStandIn,
} from "../../src/harness/stand-in"
import { createPlatformClient } from "../../src/platform/client"
import { PlatformRefusal } from "../../src/platform/errors"
import { RUN_PHASE, Run, type RunState } from "../../src/platform/run"
import {
  type Config,
  Drawn,
  devices,
  FRAME_MS,
  MANIFEST,
  Probe,
  type View,
} from "../game/subject"
import { FakePage, settle } from "../platform/fake-page"

const GAME_ID = "00000000-0000-4000-8000-000000000000"
const PRESENT = `http://127.0.0.1:1/g/${GAME_ID}/present/${"a".repeat(64)}.js`
const FILES = `http://127.0.0.1:1/g/${GAME_ID}/t/${"b".repeat(64)}/`
const HASH = hashCanonical(MANIFEST as unknown as PlainValue)

/** What the platform answers for a run a reader may not have, or that does not exist. */
const NOT_THERE = ["E_NOT_FOUND", 404, "there is nothing there"]

const MISSING_RUN = "00000000-0000-4000-8000-0000000000ff"

let running: RunningStandIn | null = null

afterEach(async () => {
  await running?.stop()
  running = null
})

/** A page on the site's origin, whose `fetch` is the network, as a browser's is. */
function pageAt(origin: string): FakePage {
  const page = new FakePage()
  Object.defineProperty(page, "origin", { value: origin })
  page.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    fetch(input, {
      ...init,
      // A browser adds this to every cross-origin request; Bun's fetch does not.
      headers: { ...(init?.headers as Record<string, string>), origin },
    })) as typeof fetch
  return page
}

function standIn(extra: Partial<StandInOptions> = {}) {
  const page = pageAt("http://127.0.0.1:4310")
  const started = startStandIn({
    manifest: MANIFEST,
    presentUrl: PRESENT,
    filesUrl: FILES,
    gameId: GAME_ID,
    siteOrigin: page.origin,
    seed: "harness",
    listen: LOOPBACK,
    ...extra,
  })
  running = started
  const client = createPlatformClient({
    apiOrigin: started.apiOrigin,
    signInOrigin: started.signInOrigin,
    pageKey: STAND_IN_PAGE_KEY,
    environment: page,
  })
  return { page, client, started }
}

/** Signs the local player in through the stand-in's own window. */
async function signIn(made: ReturnType<typeof standIn>) {
  const signing = made.client.signIn()
  await settle()
  const href = made.page.popup?.location.href ?? ""
  expect(href.startsWith(`${made.started.signInOrigin}/authorize?`)).toBe(true)
  const html = await (await fetch(href)).text()
  const hand =
    /<script type="application\/json" id="hand">(.*?)<\/script>/s.exec(html)
  const parsed = JSON.parse(hand?.[1] ?? "null") as {
    origin: string
    message: unknown
  }
  // The window posts to the page that opened it, and to that origin alone.
  expect(parsed.origin).toBe(made.page.origin)
  made.page.post({
    origin: made.started.signInOrigin,
    source: made.page.popup,
    data: parsed.message,
  })
  return await signing
}

/**
 * The status the platform answers each code the stand-in answers, as
 * vbz-gg/platform's `apps/api/src/errors.ts` has them: its
 * `SESSION_REFUSAL_STATUS` for a run's refusals, and for the rest the status
 * its routes throw them with (a malformed body, a missing or unknown key, no
 * such route, a body over its cap, a page key from a page its game does not
 * allow, and a sign-in that cannot be traded).
 */
const PLATFORM_STATUS: Readonly<Record<string, number>> = {
  E_BAD_REQUEST: 400,
  E_SIGNIN_GRANT_INVALID: 400,
  E_UNAUTHORIZED: 401,
  E_SIGN_IN_REQUIRED: 401,
  E_ORIGIN_NOT_ALLOWED: 403,
  E_PLAYER_BARRED: 403,
  E_NOT_FOUND: 404,
  E_NO_SESSION: 404,
  E_RANKED_PAUSED: 409,
  E_SESSION_CLOSED: 409,
  E_CHUNK_CONFLICT: 409,
  E_CHUNK_NOT_FORWARD: 400,
  E_CHUNKS_INCOMPLETE: 400,
  E_BODY_TOO_LARGE: 413,
  E_RUN_TOO_LARGE: 413,
  E_INPUT_UNDECLARED: 400,
  E_INPUT_RANGE: 400,
  E_INPUT_BUDGET: 400,
  E_RECORDING_MALFORMED: 400,
}

/** Holds a refusal's status to the platform's for its code. */
function expectPlatformStatus(code: string, status: number): void {
  const platform = PLATFORM_STATUS[code]
  if (platform === undefined) {
    throw new Error(`${code} is not a code the platform answers a page with`)
  }
  expect(`${code} ${status}`).toBe(`${code} ${platform}`)
}

/** A refusal, which arrives with the platform's status for its code. */
async function refusalOf(work: Promise<unknown>): Promise<PlatformRefusal> {
  try {
    await work
  } catch (error) {
    if (error instanceof PlatformRefusal) {
      expectPlatformStatus(error.code, error.status)
      return error
    }
    throw error
  }
  throw new Error("expected a refusal")
}

/** A refusal read off the wire, held to the platform's status for its code. */
async function refusedCode(response: Response): Promise<string> {
  const { error } = (await response.json()) as { error: string }
  expectPlatformStatus(error, response.status)
  return error
}

/** A run of the probe game with two presses, as its page records it. */
async function played(seed: string): Promise<Recording> {
  const keys = devices()
  const scheduler = new ManualScheduler()
  const game = definePageModule<View, Config>({
    createGame: () => new Probe(),
    manifest: MANIFEST,
    createPresentation: () => new Drawn(),
    capture: { keys: { ArrowLeft: "left" } },
  })
  let recording: Recording | null = null
  const handle = game.mount(
    { ownerDocument: { defaultView: null } } as unknown as HTMLElement,
    {
      mode: "play",
      seed,
      config: {},
      tickHz: 60,
      scripted: "ignore",
      files: FILES,
      expect: { manifestHash: HASH },
      handlers: {
        onCheckpoint: () => {},
        onFrame: () => {},
        onEnded: (end) => {
          recording = end.recording
        },
        onError: (error) => {
          throw new Error(error.message)
        },
      },
      scheduler,
      environment: keys,
    },
  )
  // The game gets ready before its clock starts.
  await Bun.sleep(0)
  scheduler.run(1, FRAME_MS)
  for (let press = 0; press < 2; press += 1) {
    keys.press("ArrowLeft", true)
    scheduler.run(4, FRAME_MS)
    keys.press("ArrowLeft", false)
    scheduler.run(10, FRAME_MS)
  }
  handle.stop("abandoned")
  const made = recording as Recording | null
  if (made === null) throw new Error("the run never ended")
  return made
}

function chunkOf(recording: Recording, seq = 0): RunChunk {
  return {
    seq,
    throughTick: recording.endTick,
    checkpoints: recording.checkpoints,
    inputs: recording.inputs,
  }
}

describe("signing in", () => {
  test("the window hands the page a code, which trades for the local player", async () => {
    const made = standIn()
    const player = await signIn(made)
    expect(player).toEqual(LOCAL_PLAYER)
    expect(made.client.player()).toEqual(LOCAL_PLAYER)
  })

  test("a code trades once, and only with the verifier that answers its challenge", async () => {
    const made = standIn()
    await signIn(made)
    const trade = (code: string, verifier: string) =>
      made.client.request("POST /v1/oauth/token", {
        body: { code, codeVerifier: verifier, clientId: STAND_IN_PAGE_KEY },
      })
    const refused = await refusalOf(trade("not-a-code", "x"))
    expect(refused.code).toBe("E_SIGNIN_GRANT_INVALID")
    expect(refused.status).toBe(400)
  })

  test("a window asked by another page, or with no challenge, hands nothing", async () => {
    const made = standIn()
    const base = `${made.started.signInOrigin}/authorize?client_id=${STAND_IN_PAGE_KEY}&state=s&code_challenge_method=S256`
    for (const query of [
      `${base}&redirect_uri=https://elsewhere.example&code_challenge=c`,
      `${base}&redirect_uri=${made.page.origin}`,
      `${made.started.signInOrigin}/authorize?client_id=vbz_pk_other&redirect_uri=${made.page.origin}&state=s&code_challenge=c&code_challenge_method=S256`,
      `${made.started.signInOrigin}/authorize?client_id=${STAND_IN_PAGE_KEY}&redirect_uri=${made.page.origin}&code_challenge=c&code_challenge_method=S256`,
    ]) {
      const response = await fetch(query)
      expect(response.status).toBe(400)
      expect(await response.text()).not.toContain('id="hand"')
    }
    expect((await fetch(`${made.started.signInOrigin}/`)).status).toBe(404)
  })
})

describe("the game and a run", () => {
  test("the game names the build as the version both modes play, on the day's line", async () => {
    const made = standIn()
    const game = await made.client.game()
    expect(game.game.id).toBe(GAME_ID)
    expect(game.game.title).toBe(MANIFEST.name)
    expect(game.today?.ranked).toBe("open")
    expect(game.today?.line).toBe("1.0")
    expect(game.today?.version?.presentUrl).toBe(PRESENT)
    expect(game.today?.version?.manifestHash).toBe(HASH)
    expect(game.practiceVersion).toEqual(game.today?.version ?? null)
  })

  /**
   * The whole of what a page does with a run, through the client's own Run:
   * the recording committed in chunks, submitted, and settled.
   */
  test("a run plays through the client's Run to a settled result", async () => {
    const made = standIn()
    await signIn(made)
    const started = await made.client.startRun()
    expect(started.seed).toBe("harness")
    expect(started.limits).toEqual(STAND_IN_LIMITS)
    expect(started.game.manifestHash).toBe(HASH)

    const states: RunState[] = []
    const run = new Run({
      client: made.client,
      onState: (state) => states.push(state),
    })
    const recording = await played(started.seed)
    run.play(started, (options) => {
      // The mount a page module would make, reporting what it played.
      for (const checkpoint of recording.checkpoints) {
        options.handlers.onCheckpoint(checkpoint)
      }
      options.handlers.onEnded({
        tick: recording.endTick,
        reason: recording.terminal,
        counters: recording.counters,
        recording,
      })
      return {
        recorded: () => recording.inputs,
        stop: () => {},
        destroy: () => {},
      }
    })
    for (let i = 0; i < 20 && run.current.phase !== RUN_PHASE.DONE; i += 1) {
      await settle()
    }
    expect(run.current.phase).toBe(RUN_PHASE.DONE)
    expect(run.current.result?.replay?.counters).toEqual({ presses: 2 })
    expect(states.map((state) => state.phase)).toEqual([
      RUN_PHASE.PLAYING,
      RUN_PHASE.SUBMITTING,
      RUN_PHASE.REPLAYING,
      RUN_PHASE.DONE,
    ])

    // Read back, it replays to where the run stopped.
    const watched = await made.client.watch(started.sessionId)
    expect(watched.inputs).toEqual(recording.inputs)
    expect(watched.replayTicks).toBe(recording.endTick)
    expect(watched.presentUrl).toBe(PRESENT)
    expect(watched.filesUrl).toBe(FILES)

    // And the board holds it, as the reader's own row.
    const board = await made.client.board()
    expect(board.rows.map((row) => row.sessionId)).toEqual([started.sessionId])
    expect(board.you?.sessionId).toBe(started.sessionId)
    expect(board.rankBy).toEqual(["presses"])
  })

  /**
   * A chunk over the cap goes in pieces, and each piece has to carry the
   * checkpoints of its own ticks: one carried past a piece that already
   * reached its tick is refused, and the run fails there.
   */
  test("a run whose chunks are cut into pieces still settles", async () => {
    const made = standIn()
    await signIn(made)
    const started = await made.client.startRun()
    const recording = await played(started.seed)
    // Something to cut, and checkpoints on both sides of a cut.
    expect(recording.inputs.length).toBeGreaterThanOrEqual(4)
    expect(recording.checkpoints.length).toBeGreaterThanOrEqual(2)
    const sent: RunChunk[] = []
    const run = new Run({
      client: {
        ...made.client,
        sendChunk: (to, chunk) => {
          sent.push(chunk)
          return made.client.sendChunk(to, chunk)
        },
      },
    })
    let handlers: MountHandlers | null = null
    run.play(
      { ...started, limits: { ...started.limits, chunkBytes: 260 } },
      (options) => {
        handlers = options.handlers
        return {
          recorded: () => recording.inputs,
          stop: () => {},
          destroy: () => {},
        }
      },
    )
    // The game, having played: its checkpoints, then its end.
    const game = handlers as MountHandlers | null
    if (game === null) throw new Error("the run mounted nothing")
    for (const checkpoint of recording.checkpoints) {
      game.onCheckpoint(checkpoint)
    }
    game.onEnded({
      tick: recording.endTick,
      reason: recording.terminal,
      counters: recording.counters,
      recording,
    })
    for (let i = 0; i < 20 && run.current.phase !== RUN_PHASE.DONE; i += 1) {
      if (run.current.phase === RUN_PHASE.FAILED) break
      await settle()
    }
    expect(run.current).toMatchObject({
      phase: RUN_PHASE.DONE,
      errorCode: null,
    })
    expect(sent.length).toBeGreaterThan(1)
    expect(sent.flatMap((chunk) => chunk.checkpoints)).toEqual([
      ...recording.checkpoints,
    ])
  })

  test("a practice run settles and never reaches the board", async () => {
    const lines: string[] = []
    const made = standIn({ log: (line) => lines.push(line) })
    await signIn(made)
    const started = await made.client.startRun({ practice: true })
    expect(started.mode).toBe("practice")
    const recording = await played(started.seed)
    await made.client.submit(started, recording)
    const result = await made.client.result(started.sessionId)
    expect(result.state).toBe("settled")
    expect((await made.client.board()).rows).toEqual([])
    // The terminal says the result is the page's own, unreplayed.
    expect(lines.join("\n")).toContain("unreplayed")
  })

  test("a refresh before anything is committed is the same run; after, a new one", async () => {
    const made = standIn()
    await signIn(made)
    const first = await made.client.startRun()
    expect((await made.client.startRun()).sessionId).toBe(first.sessionId)
    const recording = await played(first.seed)
    await made.client.sendChunk(first, chunkOf(recording))
    const second = await made.client.startRun()
    expect(second.sessionId).not.toBe(first.sessionId)
    const closed = await made.client.result(first.sessionId)
    expect(closed).toMatchObject({
      state: "expired",
      committed: true,
      replay: null,
    })
    expect(
      (await refusalOf(made.client.sendChunk(first, chunkOf(recording, 1))))
        .code,
    ).toBe("E_SESSION_CLOSED")
  })

  test("the board reads as nobody without a token, and has no row before a run", async () => {
    const made = standIn()
    const board = await made.client.board({ period: "all" })
    expect(board).toMatchObject({
      period: "all",
      from: null,
      total: 0,
      rows: [],
      you: null,
    })
    expect((await made.client.board({ period: "week" })).from).not.toBeNull()
  })
})

describe("the refusals a page has to handle", () => {
  test("every refusal the stand-in answers carries the platform's status, and it answers no other", () => {
    expect<Readonly<Record<string, number>>>(STAND_IN_STATUS).toEqual(
      PLATFORM_STATUS,
    )
  })

  test("a ranked start on a paused day is E_RANKED_PAUSED, and practice still starts", async () => {
    const made = standIn({ ranked: "paused" })
    await signIn(made)
    const game = await made.client.game()
    expect(game.today).toMatchObject({ ranked: "paused", version: null })
    expect(game.practiceVersion?.presentUrl).toBe(PRESENT)
    const refused = await refusalOf(made.client.startRun())
    expect(refused.code).toBe("E_RANKED_PAUSED")
    expect((await made.client.startRun({ practice: true })).mode).toBe(
      "practice",
    )
  })

  test("a barred player's start says when the bar ends", async () => {
    const made = standIn({ barredUntil: "2026-11-17T09:00:00.000Z" })
    await signIn(made)
    const refused = await refusalOf(made.client.startRun())
    expect(refused.code).toBe("E_PLAYER_BARRED")
    expect(refused.detail).toEqual({ until: "2026-11-17T09:00:00.000Z" })
  })

  test("a run route with no player, a wrong key or another page is refused by name", async () => {
    const made = standIn()
    const refused = await refusalOf(
      made.client.request("POST /v1/runs", { body: {}, token: "stale" }),
    )
    expect(refused.code).toBe("E_SIGN_IN_REQUIRED")

    const call = (headers: Record<string, string>) =>
      fetch(`${made.started.apiOrigin}/v1/game`, { headers })
    const wrongKey = await call({
      origin: made.page.origin,
      "x-vbz-key": "vbz_pk_other",
    })
    expect(await refusedCode(wrongKey)).toBe("E_UNAUTHORIZED")
    const elsewhere = await call({
      origin: "https://elsewhere.example",
      "x-vbz-key": STAND_IN_PAGE_KEY,
    })
    expect(await refusedCode(elsewhere)).toBe("E_ORIGIN_NOT_ALLOWED")
    // Another page gets no CORS answer, so its browser reads nothing.
    expect(elsewhere.headers.get("access-control-allow-origin")).toBeNull()
    const missing = await fetch(`${made.started.apiOrigin}/v1/nowhere`, {
      headers: { origin: made.page.origin },
    })
    expect(await refusedCode(missing)).toBe("E_NOT_FOUND")
  })

  test("a preflight from the site is answered, naming the headers a page sends", async () => {
    const made = standIn()
    const response = await fetch(`${made.started.apiOrigin}/v1/runs`, {
      method: "OPTIONS",
      headers: { origin: made.page.origin },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      made.page.origin,
    )
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "x-vbz-key",
    )
    expect(response.headers.get("vary")).toBe(
      "Origin, Authorization, x-vbz-key",
    )
  })

  test("a chunk is taken once, never rewritten, never reaching back, and held to the manifest", async () => {
    const made = standIn()
    await signIn(made)
    const run = await made.client.startRun()
    const recording = await played(run.seed)
    const first = {
      ...chunkOf(recording),
      throughTick: 30,
      inputs: recording.inputs.filter((i) => i.tick <= 30),
      checkpoints: [],
    }
    expect(await made.client.sendChunk(run, first)).toEqual({
      seq: 0,
      throughTick: 30,
    })
    // The same body again is the same answer.
    expect(await made.client.sendChunk(run, first)).toEqual({
      seq: 0,
      throughTick: 30,
    })
    const codes = async (chunk: RunChunk) =>
      (await refusalOf(made.client.sendChunk(run, chunk))).code
    expect(await codes({ ...first, inputs: [] })).toBe("E_CHUNK_CONFLICT")
    expect(await codes({ ...first, seq: 1, throughTick: 20, inputs: [] })).toBe(
      "E_CHUNK_NOT_FORWARD",
    )
    expect(
      await codes({
        seq: 1,
        throughTick: 40,
        checkpoints: [],
        inputs: [{ tick: 35, code: "jump", value: 1 }],
      }),
    ).toBe("E_INPUT_UNDECLARED")
    // The engine names a value outside its declared range as undeclared,
    // and keeps E_INPUT_RANGE for an input at a tick the chunk does not cover.
    expect(
      await codes({
        seq: 1,
        throughTick: 40,
        checkpoints: [],
        inputs: [{ tick: 35, code: "left", value: 7 }],
      }),
    ).toBe("E_INPUT_UNDECLARED")
    expect(
      await codes({
        seq: 1,
        throughTick: 40,
        checkpoints: [],
        inputs: [{ tick: 20, code: "left", value: 1 }],
      }),
    ).toBe("E_INPUT_RANGE")
    expect(
      await codes({
        seq: 1,
        throughTick: 40,
        checkpoints: [],
        // Out of order: the engine's E_INPUT_UNSORTED, which no public code
        // names, so it arrives as the platform answers any other bad log.
        inputs: [
          { tick: 36, code: "left", value: 1 },
          { tick: 35, code: "left", value: 0 },
        ],
      }),
    ).toBe("E_RECORDING_MALFORMED")
    // A checkpoint at or below the tick an earlier chunk reached, as the
    // platform refuses one: that chunk already committed its tick.
    expect(
      await codes({
        seq: 1,
        throughTick: 40,
        checkpoints: [{ tick: 30, hash: "h30" }],
        inputs: [],
      }),
    ).toBe("E_CHUNK_NOT_FORWARD")
    expect(
      await codes({ seq: 1, throughTick: 40 } as unknown as RunChunk),
    ).toBe("E_BAD_REQUEST")
    const huge = {
      seq: 1,
      throughTick: 40,
      checkpoints: [],
      inputs: [],
      counters: { pad: 0 },
      note: "x".repeat(STAND_IN_LIMITS.chunkBytes),
    }
    expect(await codes(huge as unknown as RunChunk)).toBe("E_BODY_TOO_LARGE")
    expect(
      (
        await refusalOf(
          made.client.sendChunk({ ...run, sessionId: "nope" }, first),
        )
      ).code,
    ).toBe("E_NO_SESSION")
  })

  test("a submit answers the same recording the same, refuses another, and wants its chunks whole", async () => {
    const made = standIn()
    await signIn(made)
    const run = await made.client.startRun()
    const recording = await played(run.seed)
    await made.client.sendChunk(run, {
      ...chunkOf(recording),
      throughTick: 10,
      inputs: recording.inputs.filter((i) => i.tick <= 10),
      checkpoints: [],
    })
    expect((await refusalOf(made.client.submit(run, recording))).code).toBe(
      "E_CHUNKS_INCOMPLETE",
    )
    await made.client.sendChunk(run, {
      ...chunkOf(recording, 1),
      inputs: recording.inputs.filter((i) => i.tick > 10),
      checkpoints: recording.checkpoints.filter((c) => c.tick > 10),
    })
    const answer = await made.client.submit(run, recording)
    expect(answer.sessionId).toBe(run.sessionId)
    expect(await made.client.submit(run, recording)).toEqual(answer)
    expect(
      (
        await refusalOf(
          made.client.submit(run, { ...recording, counters: { presses: 99 } }),
        )
      ).code,
    ).toBe("E_SESSION_CLOSED")
    expect(
      (await refusalOf(made.client.sendChunk(run, chunkOf(recording, 2)))).code,
    ).toBe("E_SESSION_CLOSED")
  })

  test("a recording that is not one, or holds what the manifest does not declare, is refused", async () => {
    const made = standIn()
    await signIn(made)
    const run = await made.client.startRun()
    expect(
      (await refusalOf(made.client.submit(run, { format: "nope" }))).code,
    ).toBe("E_RECORDING_MALFORMED")
    const recording = await played(run.seed)
    const tampered = {
      ...recording,
      inputs: [
        ...recording.inputs,
        { tick: recording.endTick, code: "jump", value: 1 },
      ],
    }
    expect((await refusalOf(made.client.submit(run, tampered))).code).toBe(
      "E_INPUT_UNDECLARED",
    )
  })

  /**
   * Watching replays the run's log, which needs its seed, and the day's seed
   * is the same for everybody playing that day. So a run from a day still
   * open is its own player's to watch, and a reader with the page key alone
   * gets the answer a missing run gets, as the platform's catalogue answers.
   */
  test("a run from a day still open is watched by its own player alone", async () => {
    let now = new Date("2026-11-16T12:00:00.000Z")
    const made = standIn({ now: () => now })
    await signIn(made)
    const started = await made.client.startRun()
    const recording = await played(started.seed)
    await made.client.submit(started, recording)
    expect((await made.client.watch(started.sessionId)).inputs).toEqual(
      recording.inputs,
    )

    const stranger = createPlatformClient({
      apiOrigin: made.started.apiOrigin,
      signInOrigin: made.started.signInOrigin,
      pageKey: STAND_IN_PAGE_KEY,
      environment: pageAt(made.page.origin),
    })
    expect(stranger.player()).toBeNull()
    const refused = await refusalOf(stranger.watch(started.sessionId))
    expect([refused.code, refused.status, refused.message]).toEqual(NOT_THERE)

    // Once the day has closed, its seed is no longer anybody's advantage.
    now = new Date("2026-11-17T00:00:01.000Z")
    expect((await stranger.watch(started.sessionId)).inputs).toEqual(
      recording.inputs,
    )
  })

  /**
   * The platform answers every run a reader may not have the way it answers
   * one that does not exist: `404`, `E_NOT_FOUND`, "there is nothing there",
   * so a reader learns nothing from the difference. A page that switched on
   * another code here would meet this one in production.
   */
  test("a run nobody submitted, or nobody started, cannot be watched", async () => {
    const made = standIn()
    await signIn(made)
    const run = await made.client.startRun()
    for (const id of [run.sessionId, MISSING_RUN, "not-a-run"]) {
      const refused = await refusalOf(made.client.watch(id))
      expect([refused.code, refused.status, refused.message]).toEqual(NOT_THERE)
    }
  })

  test("the result of a run that does not exist is refused as the platform refuses it", async () => {
    const made = standIn()
    await signIn(made)
    for (const id of [MISSING_RUN, "not-a-run"]) {
      const refused = await refusalOf(made.client.result(id))
      expect([refused.code, refused.status, refused.message]).toEqual(NOT_THERE)
    }
  })
})

/** A body's size as the wire carries it. */
const wire = (body: unknown) =>
  new TextEncoder().encode(JSON.stringify(body)).byteLength

/** A chunk of nothing, padded to exactly `bytes` on the wire. */
function padded(seq: number, throughTick: number, bytes: number): RunChunk {
  const base = { seq, throughTick, checkpoints: [], inputs: [], note: "" }
  return {
    ...base,
    note: "x".repeat(bytes - wire(base)),
  } as unknown as RunChunk
}

describe("what the stand-in serves, and the platform's limits", () => {
  /** The checks play the served config, so a run has to as well, never `{}`. */
  test("a run plays every declared setting at its default", async () => {
    const manifest = {
      ...MANIFEST,
      params: { endAt: { type: "int", label: "End", default: 90 } },
    }
    const made = standIn({ manifest })
    await signIn(made)
    expect((await made.client.startRun()).config).toEqual({ endAt: 90 })
  })

  test("a game that declares no way to rank is refused, as the platform's checks refuse it", () => {
    const { rankBy: _, tiePolicy: __, ...unranked } = MANIFEST
    expect(() => standIn({ manifest: unranked })).toThrow(
      /rankBy and tiePolicy/,
    )
  })

  test("its limits are the platform's", () => {
    expect(STAND_IN_LIMITS).toEqual({
      chunkBytes: MAX_CHUNK_BYTES,
      runBytes: MAX_RUN_BYTES,
    })
  })

  test("a chunk at its limit is taken, and one a byte larger is refused", async () => {
    const made = standIn()
    await signIn(made)
    const run = await made.client.startRun()
    const at = padded(0, 10, MAX_CHUNK_BYTES)
    expect(wire(at)).toBe(MAX_CHUNK_BYTES)
    expect(await made.client.sendChunk(run, at)).toEqual({
      seq: 0,
      throughTick: 10,
    })
    const over = padded(1, 20, MAX_CHUNK_BYTES + 1)
    expect((await refusalOf(made.client.sendChunk(run, over))).code).toBe(
      "E_BODY_TOO_LARGE",
    )
  })

  /** Every chunk at its own limit, so only the run's total can refuse. */
  async function committed(total: number) {
    const made = standIn()
    await signIn(made)
    const run = await made.client.startRun()
    const sizes: number[] = []
    let left = total
    while (left > MAX_CHUNK_BYTES + 100) {
      sizes.push(MAX_CHUNK_BYTES)
      left -= MAX_CHUNK_BYTES
    }
    sizes.push(left - 100, 100)
    let last: unknown = null
    for (const [seq, size] of sizes.entries()) {
      try {
        last = await made.client.sendChunk(run, padded(seq, seq + 1, size))
      } catch (error) {
        last = error
      }
    }
    return last
  }

  test("a run's chunks are taken up to its limit, and refused one byte past it", async () => {
    expect(await committed(MAX_RUN_BYTES)).toMatchObject({ seq: 31 })
    const refused = await committed(MAX_RUN_BYTES + 1)
    expect(refused).toBeInstanceOf(PlatformRefusal)
    expect((refused as PlatformRefusal).code).toBe("E_RUN_TOO_LARGE")
  }, 60_000)

  test("a recording at its limit is read, and one a byte larger is refused unread", async () => {
    const made = standIn()
    await signIn(made)
    const run = await made.client.startRun()
    const body = (pad: number) => ({ recording: { pad: "x".repeat(pad) } })
    const at = MAX_RUN_BYTES - wire(body(0))
    expect(wire(body(at))).toBe(MAX_RUN_BYTES)
    expect(
      (await refusalOf(made.client.submit(run, body(at).recording as never)))
        .code,
    ).toBe("E_RECORDING_MALFORMED")
    expect(
      (
        await refusalOf(
          made.client.submit(run, body(at + 1).recording as never),
        )
      ).code,
    ).toBe("E_BODY_TOO_LARGE")
  }, 60_000)
})
