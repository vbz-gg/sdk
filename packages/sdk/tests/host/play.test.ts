/**
 * One platform run on a page: what the click does before it awaits anything,
 * which module a run plays, and the wiring between the module's mount and the
 * run's driver. What the driver sends the platform is held in
 * `tests/platform/run.test.ts`; this holds what `playRun` decides.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { hashCanonical, type PlainValue } from "@clockwork2/engine"
import {
  type CaptureEnvironment,
  ManualScheduler,
  MOTION_REFUSALS,
  type MotionAccess,
} from "@clockwork2/engine/host"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import type { RunChunk, StartedRun } from "../../src/api/index"
import type {
  MountError,
  MountHandle,
  MountOptions,
  PageModule,
  PreparedGame,
  PrepareOptions,
  RunMount,
} from "../../src/game/contract"
import { definePageModule } from "../../src/game/define"
import {
  type GameAddress,
  type GameMountOptions,
  type LoadedGame,
  loadGame,
} from "../../src/host/load"
import { playRun, type RunLocks, runLockName } from "../../src/host/play"
import {
  CLIENT_ERROR,
  PlatformClientError,
  PlatformRefusal,
} from "../../src/platform/errors"
import { RUN_PHASE, type RunState } from "../../src/platform/run"
import { Drawn, devices, FRAME_MS, MANIFEST, Probe } from "../game/subject"
import { settle } from "../platform/fake-page"

beforeAll(() => {
  GlobalRegistrator.register({ url: "https://studio-page.example/play" })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let stage: HTMLElement
let play: HTMLButtonElement

beforeEach(() => {
  document.body.replaceChildren()
  stage = document.createElement("div")
  play = document.createElement("button")
  document.body.append(play, stage)
  play.focus()
})

const PRESENT = "https://bundles.example/g/g-1/present/new.js"
const OLDER = "https://bundles.example/g/g-1/present/old.js"

const RUN: StartedRun = {
  sessionId: "s-1",
  mode: "ranked",
  day: "2026-11-12",
  rankedRunsLeft: null,
  seed: "seed-1",
  config: {},
  game: {
    id: "v-2",
    presentUrl: PRESENT,
    manifestHash: "mh-new",
    filesUrl: "https://bundles.example/g/g-1/t/new/",
    manifest: {},
    tickHz: 60,
  },
  limits: { chunkBytes: 1_048_576, runBytes: 27_262_976 },
  token: "t-run",
  expiresIn: 3600,
}

/** What happened, in the order it happened, across every stand-in. */
let calls: string[] = []

beforeEach(() => {
  calls = []
})

class FakeGame implements LoadedGame {
  readonly contract = 3
  readonly tickHz = 60
  readonly servedConfig = {}
  readonly filesUrl: string
  /** How many seats its game has: one, unless a test says otherwise. */
  seats = 1
  mounted: GameMountOptions | null = null
  /** What `prepare` answers once the game is ready, or not. */
  unready: MountError | null = null
  /** When set, `prepare` answers only once this settles. */
  waiting: Promise<MountError | null> | null = null
  released = 0

  constructor(
    readonly presentUrl: string,
    readonly manifestHash: string,
    readonly needsMotion = false,
  ) {
    this.filesUrl = `${presentUrl}.files/`
  }

  requestMotion(): Promise<MotionAccess> {
    calls.push(`motion ${this.presentUrl}`)
    return Promise.resolve({ granted: true })
  }

  prepare(element: HTMLElement): PreparedGame {
    calls.push(`prepare ${this.presentUrl}`)
    expect(element).toBe(stage)
    return {
      ready: this.waiting ?? Promise.resolve(this.unready),
      mount: (options: RunMount) => this.mount(element, options),
      release: () => {
        this.released += 1
        calls.push(`release ${this.presentUrl}`)
      },
    }
  }

  mount(element: HTMLElement, options: GameMountOptions): MountHandle {
    calls.push(`mount ${this.presentUrl}`)
    expect(element).toBe(stage)
    this.mounted = options
    return {
      remote: null,
      recorded: () => [],
      stop: (reason) => {
        calls.push(`stop ${reason}`)
        options.handlers.onEnded({
          tick: 10,
          reason: reason ?? "abandoned",
          counters: {},
          recording: {} as never,
        })
      },
      destroy: () => calls.push("destroy"),
    }
  }
}

const PAGE_KEY: `vbz_pk_${string}` = "vbz_pk_lane_runner"

function client(
  answers: {
    start?: StartedRun | Error
    chunk?: Error
    pageKey?: `vbz_pk_${string}`
  } = {},
) {
  const chunks: RunChunk[] = []
  return {
    chunks,
    pageKey: answers.pageKey ?? PAGE_KEY,
    startRun: async (request?: { practice?: boolean }) => {
      calls.push(`start ${JSON.stringify(request ?? {})}`)
      const answer = answers.start ?? RUN
      if (answer instanceof Error) throw answer
      return answer
    },
    sendChunk: async (_run: StartedRun, chunk: RunChunk) => {
      calls.push(`chunk ${chunk.seq}`)
      if (answers.chunk !== undefined) throw answers.chunk
      chunks.push(chunk)
      return { seq: chunk.seq, throughTick: chunk.throughTick }
    },
    submit: async () => {
      calls.push("submit")
      return { sessionId: "s-1", recordingSha256: "r" }
    },
    awaitResult: async () => {
      calls.push("result")
      return {
        sessionId: "s-1",
        mode: "ranked" as const,
        day: "2026-11-12",
        state: "settled" as const,
        committed: true,
        replay: { fault: null, code: null, counters: {}, endTick: 10 },
      }
    },
  }
}

/** Web Locks as a browser has them, with one tab's worth of holders. */
function locks(heldElsewhere: string[] = []): RunLocks & {
  readonly held: Set<string>
} {
  const held = new Set<string>(heldElsewhere)
  return {
    held,
    async request(name, _options, callback) {
      if (held.has(name)) return await callback(null)
      held.add(name)
      calls.push(`lock ${name}`)
      await callback({ name })
      held.delete(name)
      calls.push(`unlock ${name}`)
      return undefined
    },
  }
}

function loader(games: FakeGame[]) {
  return async (address: GameAddress) => {
    calls.push(`load ${address.presentUrl} ${address.manifestHash}`)
    const game = games.find((g) => g.presentUrl === address.presentUrl)
    if (game === undefined) {
      throw new PlatformClientError("E_GAME_UNLOADABLE", { cause: address })
    }
    return game
  }
}

describe("the click", () => {
  /**
   * iOS grants tilt only to a request made in the tap's own turn, before
   * anything is awaited; asked after, it refuses without asking.
   */
  test("asks for tilt first, then for the lock, before anything is awaited", async () => {
    const game = new FakeGame(PRESENT, "mh-new", true)
    const played = playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: locks(),
    })
    expect(calls).toEqual([
      `motion ${PRESENT}`,
      `lock ${runLockName(PAGE_KEY, "ranked")}`,
    ])
    expect(played.motion).not.toBeNull()
    expect(played.run.current.phase).toBe(RUN_PHASE.LOADING)
    await settle()
    // Then the game gets ready here, before the platform is asked for a run.
    expect(calls.slice(2, 5)).toEqual([
      `prepare ${PRESENT}`,
      "start {}",
      `mount ${PRESENT}`,
    ])
  })

  /**
   * The engine's request answers a refusal rather than failing, but a page
   * module built from other code can fail it. The run stops there, before a
   * run is asked for, and the lock is let go for the next tap.
   */
  test("a tilt request that fails stops the run before it starts", async () => {
    const game = new FakeGame(PRESENT, "mh-new", true)
    game.requestMotion = () => {
      calls.push("motion")
      return Promise.reject(new Error("the sensor broke"))
    }
    const held = locks()
    const states: RunState[] = []
    playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: held,
      onState: (state) => states.push(state),
    })
    await settle()
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_UNEXPECTED",
      detail: "Error: the sensor broke",
    })
    expect(calls.some((call) => call.startsWith("start"))).toBe(false)
    expect(held.held.size).toBe(0)
  })

  /**
   * A game steered by tilt is not played without it. On an iPad after "Don't
   * Allow", iOS answers every later request with a refusal and asks nothing,
   * so a run started anyway is a ranked run spent on a game nobody can
   * steer; on a laptop there is no sensor to read at all. Each refusal the
   * engine answers fails the run with its own code and the client's sentence
   * for the player, before a run is asked for, and lets the lock go.
   */
  for (const code of Object.values(MOTION_REFUSALS)) {
    test(`a tilt request answered ${code} starts no run, and says why`, async () => {
      const game = new FakeGame(PRESENT, "mh-new", true)
      const answer: MotionAccess = {
        granted: false,
        code,
        detail: "what the engine saw",
      }
      game.requestMotion = () => {
        calls.push("motion")
        return Promise.resolve(answer)
      }
      const held = locks()
      const states: RunState[] = []
      const name = runLockName(PAGE_KEY, "ranked")
      const played = playRun(stage, {
        client: client(),
        game,
        mode: "ranked",
        locks: held,
        onState: (state) => states.push(state),
      })
      await settle()
      expect(states).toEqual([
        {
          phase: RUN_PHASE.FAILED,
          errorCode: code,
          detail: CLIENT_ERROR[code],
          refusalDetail: null,
          result: null,
        },
      ])
      // Asked in the click, then the lock, and nothing of the platform.
      expect(calls).toEqual(["motion", `lock ${name}`, `unlock ${name}`])
      expect(held.held.size).toBe(0)
      expect(await played.motion).toBe(answer)
    })
  }

  /**
   * A page module built against a later engine may answer a refusal this
   * page has no sentence for. It is still a refusal, so nothing starts, and
   * the code it answered is kept in the detail.
   */
  test("a refusal this page has no code for starts no run either, and is named", async () => {
    const game = new FakeGame(PRESENT, "mh-new", true)
    game.requestMotion = () =>
      Promise.resolve({
        granted: false,
        code: "E_MOTION_LATER",
        detail: "a reason from a later engine",
      } as unknown as MotionAccess)
    const states: RunState[] = []
    playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: locks(),
      onState: (state) => states.push(state),
    })
    await settle()
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_UNEXPECTED",
      detail: `${CLIENT_ERROR.E_UNEXPECTED}: E_MOTION_LATER: a reason from a later engine`,
    })
    expect(calls.some((call) => call.startsWith("start"))).toBe(false)
  })

  /**
   * A second tap while the first's tilt prompt is still open: the page takes
   * the first run down and plays the second in the same element. The first
   * one's answer, when it comes, must not get its game ready there.
   */
  test("a run taken down while its tilt prompt is open gets nothing ready", async () => {
    const game = new FakeGame(PRESENT, "mh-new", true)
    const answers: Array<(access: MotionAccess) => void> = []
    game.requestMotion = () => {
      calls.push("motion")
      return new Promise((resolve) => answers.push(resolve))
    }
    const held = locks()
    const first = playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: held,
    })
    await settle()
    first.destroy()
    await settle()
    const second = playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: held,
    })
    await settle()
    // The first tap's prompt is answered after the second tap took the stage.
    answers[0]?.({ granted: true })
    await settle()
    expect(calls.filter((call) => call.startsWith("prepare"))).toEqual([])
    expect(game.released).toBe(0)

    answers[1]?.({ granted: true })
    await settle()
    expect(calls.filter((call) => call.startsWith("prepare"))).toEqual([
      `prepare ${PRESENT}`,
    ])
    expect(calls.filter((call) => call.startsWith("start"))).toEqual([
      "start {}",
    ])
    second.destroy()
  })

  test("a game that reads no tilt asks for nothing", async () => {
    const played = playRun(stage, {
      client: client(),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "practice",
      locks: locks(),
    })
    await settle()
    expect(calls.slice(0, 3)).toEqual([
      `lock ${runLockName(PAGE_KEY, "practice")}`,
      `prepare ${PRESENT}`,
      'start {"practice":true}',
    ])
    expect(played.motion).toBeNull()
  })
})

describe("which module plays the run", () => {
  test("the module loaded before the click, when the run is on its version", async () => {
    const game = new FakeGame(PRESENT, "mh-new")
    const states: RunState[] = []
    const played = playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: locks(),
      onState: (state) => states.push(state),
      load: loader([]),
      title: "Lane Runner",
    })
    await settle()
    expect(calls).toEqual([
      `lock ${runLockName(PAGE_KEY, "ranked")}`,
      `prepare ${PRESENT}`,
      "start {}",
      `mount ${PRESENT}`,
    ])
    expect(game.released).toBe(0)
    expect(game.mounted).toMatchObject({
      mode: "play",
      seed: "seed-1",
      expect: { manifestHash: "mh-new" },
    })
    expect(states.map((s) => s.phase)).toEqual([RUN_PHASE.PLAYING])
    expect(played.game).toBe(game)
  })

  /**
   * A refresh resumes the run on the version it started on, which can be an
   * older patch than the page loaded for the next start.
   */
  test("a resumed run on an older patch plays that patch's own module", async () => {
    const given = new FakeGame(PRESENT, "mh-new")
    const older = new FakeGame(OLDER, "mh-old")
    const resumed = {
      ...RUN,
      game: { ...RUN.game, presentUrl: OLDER, manifestHash: "mh-old" },
    }
    const played = playRun(stage, {
      client: client({ start: resumed }),
      game: given,
      mode: "ranked",
      locks: locks(),
      load: loader([older]),
    })
    await settle()
    // What was got ready is the newer patch's, and goes; the run's own module
    // gets ready inside its mount.
    expect(calls).toEqual([
      `lock ${runLockName(PAGE_KEY, "ranked")}`,
      `prepare ${PRESENT}`,
      "start {}",
      `release ${PRESENT}`,
      `load ${OLDER} mh-old`,
      `mount ${OLDER}`,
    ])
    expect(given.mounted).toBeNull()
    expect(played.game).toBe(older)
  })

  /**
   * `loadGame` hands back the address as the URL parser writes it, and the
   * platform may write the same one another way. The manifest hash is what
   * names the module, so the same version is never imported twice.
   */
  test("a run on the loaded module's version plays it, however its address is written", async () => {
    const game = new FakeGame(PRESENT, "mh-new")
    const written = {
      ...RUN,
      game: {
        ...RUN.game,
        presentUrl: "https://BUNDLES.example:443/g/g-1/present/new.js",
      },
    }
    const played = playRun(stage, {
      client: client({ start: written }),
      game,
      mode: "ranked",
      locks: locks(),
      load: loader([]),
    })
    await settle()
    expect(calls.some((call) => call.startsWith("load"))).toBe(false)
    expect(calls.at(-1)).toBe(`mount ${PRESENT}`)
    expect(played.game).toBe(game)
  })

  test("a run module that does not load fails the run, and nothing is posted", async () => {
    const states: RunState[] = []
    const resumed = {
      ...RUN,
      game: { ...RUN.game, presentUrl: OLDER, manifestHash: "mh-old" },
    }
    playRun(stage, {
      client: client({ start: resumed }),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: locks(),
      onState: (state) => states.push(state),
      load: loader([]),
    })
    await settle()
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_GAME_UNLOADABLE",
    })
    expect(calls.some((call) => call.startsWith("mount"))).toBe(false)
  })

  test("with no loader given, the run's module is loaded with loadGame", async () => {
    const states: RunState[] = []
    const resumed = {
      ...RUN,
      game: { ...RUN.game, presentUrl: OLDER, manifestHash: "mh-old" },
    }
    playRun(stage, {
      client: client({ start: resumed }),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: locks(),
      onState: (state) => states.push(state),
    })
    await settle()
    // Under bun there is no network import, so loadGame's own refusal is
    // what arrives.
    expect(states.at(-1)?.errorCode).toBe("E_GAME_UNLOADABLE")
  })

  /**
   * The run's module reads tilt and the click did not ask for it. Asked now,
   * after the start was awaited, iOS would refuse; so the run stops having
   * posted nothing, keeps the module, and the next tap asks and resumes it.
   */
  test("a run module that needs tilt the click did not ask for waits for the next tap", async () => {
    const given = new FakeGame(PRESENT, "mh-new")
    const tilting = new FakeGame(OLDER, "mh-old", true)
    const resumed = {
      ...RUN,
      game: { ...RUN.game, presentUrl: OLDER, manifestHash: "mh-old" },
    }
    const states: RunState[] = []
    const platform = client({ start: resumed })
    const first = playRun(stage, {
      client: platform,
      game: given,
      mode: "ranked",
      locks: locks(),
      onState: (state) => states.push(state),
      load: loader([tilting]),
    })
    await settle()
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_MOTION_NEEDS_TAP",
    })
    expect(first.game).toBe(tilting)
    // The lock is let go with the failure, so the next tap can take it.
    expect(calls).toEqual([
      `lock ${runLockName(PAGE_KEY, "ranked")}`,
      `prepare ${PRESENT}`,
      "start {}",
      `release ${PRESENT}`,
      `load ${OLDER} mh-old`,
      `unlock ${runLockName(PAGE_KEY, "ranked")}`,
    ])

    calls = []
    const second = playRun(stage, {
      client: platform,
      game: first.game,
      mode: "ranked",
      locks: locks(),
      load: loader([tilting]),
    })
    await settle()
    expect(calls).toEqual([
      `motion ${OLDER}`,
      `lock ${runLockName(PAGE_KEY, "ranked")}`,
      `prepare ${OLDER}`,
      "start {}",
      `mount ${OLDER}`,
    ])
    expect(second.run.started?.sessionId).toBe("s-1")
  })

  /**
   * A device the game cannot draw on, or a pack that never arrived, is found
   * before the platform is asked for a run, so it spends none.
   */
  test("a game that cannot draw here starts no run, in the client's sentence", async () => {
    const game = new FakeGame(PRESENT, "mh-new")
    game.unready = {
      code: "E_PRESENTATION_FAILED",
      message:
        "E_PRESENTATION_FAILED the presentation could not get ready to draw: no usable GPU path",
    }
    const states: RunState[] = []
    playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: locks(),
      onState: (state) => states.push(state),
    })
    await settle()
    const failed = states.at(-1)
    expect(failed).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_PRESENTATION_FAILED",
    })
    expect(failed?.detail).toStartWith(CLIENT_ERROR.E_PRESENTATION_FAILED)
    expect(String(failed?.detail)).toContain("no usable GPU path")
    expect(calls).toEqual([
      `lock ${runLockName(PAGE_KEY, "ranked")}`,
      `prepare ${PRESENT}`,
      `release ${PRESENT}`,
      `unlock ${runLockName(PAGE_KEY, "ranked")}`,
    ])
  })

  test("a game whose pack did not arrive starts no run, in the engine's words", async () => {
    const game = new FakeGame(PRESENT, "mh-new")
    game.unready = {
      code: "E_PACK_NOT_DELIVERED",
      message: "packs/level.json answered 404",
    }
    const states: RunState[] = []
    playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: locks(),
      onState: (state) => states.push(state),
    })
    await settle()
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_PACK_NOT_DELIVERED",
      detail: "packs/level.json answered 404",
    })
    expect(calls.some((call) => call.startsWith("start"))).toBe(false)
  })

  test("leaving while the game gets ready lets it go, and starts nothing", async () => {
    const game = new FakeGame(PRESENT, "mh-new")
    let ready: (answer: MountError | null) => void = () => {}
    game.waiting = new Promise((resolve) => {
      ready = resolve
    })
    const played = playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: locks(),
    })
    await settle()
    expect(calls.at(-1)).toBe(`prepare ${PRESENT}`)
    played.destroy()
    expect(game.released).toBe(1)
    ready(null)
    await settle()
    expect(calls.some((call) => call.startsWith("start"))).toBe(false)
    expect(calls.at(-1)).toBe(`unlock ${runLockName(PAGE_KEY, "ranked")}`)
  })

  test("a start the platform refuses fails the run with the platform's code", async () => {
    const states: RunState[] = []
    playRun(stage, {
      client: client({
        start: new PlatformRefusal(409, {
          error: "E_RANKED_PAUSED",
          message: "ranked play is paused today",
        }),
      }),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: locks(),
      onState: (state) => states.push(state),
    })
    await settle()
    expect(states).toEqual([
      {
        phase: RUN_PHASE.FAILED,
        errorCode: "E_RANKED_PAUSED",
        detail: "ranked play is paused today",
        refusalDetail: null,
        result: null,
      },
    ])
  })
})

describe("the page around the run", () => {
  /** A key the game maps must reach the game, not the Play button just pressed. */
  test("focus moves to the game element, labelled with the title", async () => {
    expect(document.activeElement).toBe(play)
    playRun(stage, {
      client: client(),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: locks(),
      title: "Lane Runner",
    })
    await settle()
    expect(stage.getAttribute("tabindex")).toBe("0")
    expect(stage.getAttribute("aria-label")).toBe("Lane Runner")
    expect(document.activeElement).toBe(stage)
  })

  test("a tabindex the page set is kept", async () => {
    stage.tabIndex = -1
    playRun(stage, {
      client: client(),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: locks(),
    })
    await settle()
    expect(stage.getAttribute("tabindex")).toBe("-1")
    expect(stage.hasAttribute("aria-label")).toBe(false)
  })

  /**
   * A second tab's start would be handed the first tab's run while it has
   * committed nothing, and two tabs posting chunks for one run conflict.
   * Once it has committed a chunk, the start closes it and answers a new
   * one, ending the first tab's run under its player. So the second tab asks
   * for nothing at all.
   */
  test("a second tab on the game and mode a first tab is playing starts nothing", async () => {
    const browser = locks()
    playRun(stage, {
      client: client(),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: browser,
    })
    await settle()
    expect(calls.at(-1)).toBe(`mount ${PRESENT}`)

    const states: RunState[] = []
    // What the platform would answer it once the first run has committed.
    const fresh = { ...RUN, sessionId: "s-2" }
    playRun(stage, {
      client: client({ start: fresh }),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: browser,
      onState: (state) => states.push(state),
    })
    await settle()
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_RUN_OPEN_ELSEWHERE",
    })
    expect(calls.filter((call) => call.startsWith("start"))).toEqual([
      "start {}",
    ])
    expect(calls.filter((call) => call.startsWith("mount"))).toHaveLength(1)
  })

  test("a run of another mode, or of another game, is not held back", async () => {
    const browser = locks()
    const others: ReadonlyArray<{
      readonly mode: "ranked" | "practice"
      readonly pageKey: `vbz_pk_${string}`
    }> = [
      { mode: "practice", pageKey: PAGE_KEY },
      { mode: "ranked", pageKey: "vbz_pk_other" },
    ]
    playRun(stage, {
      client: client(),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: browser,
    })
    for (const other of others) {
      playRun(stage, {
        client: client({ pageKey: other.pageKey }),
        game: new FakeGame(PRESENT, "mh-new"),
        mode: other.mode,
        locks: browser,
      })
    }
    await settle()
    expect(calls.filter((call) => call.startsWith("mount"))).toHaveLength(3)
    expect([...browser.held].sort()).toEqual(
      [
        runLockName(PAGE_KEY, "ranked"),
        runLockName(PAGE_KEY, "practice"),
        runLockName("vbz_pk_other", "ranked"),
      ].sort(),
    )
  })

  test("a browser with no Web Locks starts no run, asks for nothing, and says why", async () => {
    const states: RunState[] = []
    const game = new FakeGame(PRESENT, "mh-new")
    playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: null,
      onState: (state) => states.push(state),
    })
    await settle()
    expect(states.at(-1)?.errorCode).toBe("E_BROWSER_UNSUPPORTED")
    expect(calls.some((call) => call.startsWith("start"))).toBe(false)
    expect(calls.some((call) => call.startsWith("mount"))).toBe(false)
  })

  /**
   * vbz.gg ranks one player's run. A game of turns asks for no tilt, takes
   * no lock and starts nothing, so it spends no run and holds no tab.
   */
  test("a game of more than one seat starts no run, asks for nothing, and says why", async () => {
    const states: RunState[] = []
    const game = new FakeGame(PRESENT, "mh-new", true)
    game.seats = 2
    const held = locks()
    const played = playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: held,
      onState: (state) => states.push(state),
    })
    expect(played.motion).toBeNull()
    await settle()
    expect(states.at(-1)).toMatchObject({
      phase: RUN_PHASE.FAILED,
      errorCode: "E_SEATED_RUN_UNSUPPORTED",
    })
    expect(calls).toEqual([])
    expect(held.held.size).toBe(0)
  })

  test("a resumed run whose own module has seats starts nothing, and lets the lock go", async () => {
    const states: RunState[] = []
    const seated = new FakeGame(OLDER, "mh-old")
    seated.seats = 2
    playRun(stage, {
      client: client({
        start: {
          ...RUN,
          game: { ...RUN.game, presentUrl: OLDER, manifestHash: "mh-old" },
        },
      }),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: locks(),
      onState: (state) => states.push(state),
      load: loader([seated]),
    })
    await settle()
    expect(states.at(-1)?.errorCode).toBe("E_SEATED_RUN_UNSUPPORTED")
    expect(calls).toEqual([
      `lock ${runLockName(PAGE_KEY, "ranked")}`,
      `prepare ${PRESENT}`,
      "start {}",
      `release ${PRESENT}`,
      `load ${OLDER} mh-old`,
      `unlock ${runLockName(PAGE_KEY, "ranked")}`,
    ])
  })

  /**
   * A run is open on the platform until its recording is taken, and a start
   * from another tab before then would close it.
   */
  test("the lock is held until the platform has the run, then let go", async () => {
    const held = locks()
    const name = runLockName(PAGE_KEY, "ranked")
    const platform = client()
    const heldWhileSubmitting: boolean[] = []
    const played = playRun(stage, {
      client: {
        ...platform,
        submit: () => {
          heldWhileSubmitting.push(held.held.has(name))
          return platform.submit()
        },
      },
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: held,
    })
    await settle()
    expect(held.held.has(name)).toBe(true)
    played.end()
    await settle()
    expect(heldWhileSubmitting).toEqual([true])
    expect(held.held.size).toBe(0)
    expect(calls.indexOf(`unlock ${name}`)).toBeGreaterThan(
      calls.indexOf("submit"),
    )
  })

  test("by default the browser's own Web Locks are read, and a browser without them is refused", async () => {
    // happy-dom's navigator has none, as Safari before 15.4 has none.
    expect(
      (navigator as unknown as { locks?: unknown }).locks ?? null,
    ).toBeNull()
    const states: RunState[] = []
    playRun(stage, {
      client: client(),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      onState: (state) => states.push(state),
    })
    await settle()
    expect(states.at(-1)?.errorCode).toBe("E_BROWSER_UNSUPPORTED")
    expect(calls.some((call) => call.startsWith("start"))).toBe(false)
  })

  test("a lock request the browser fails fails the run", async () => {
    const states: RunState[] = []
    playRun(stage, {
      client: client(),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: { request: () => Promise.reject(new Error("locks broke")) },
      onState: (state) => states.push(state),
    })
    await settle()
    expect(states.at(-1)).toMatchObject({
      errorCode: "E_UNEXPECTED",
      detail: "Error: locks broke",
    })
  })

  test("leaving before the run plays stops it, and it is never mounted", async () => {
    const held = locks()
    const played = playRun(stage, {
      client: client(),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: held,
    })
    played.end()
    await settle()
    // Left before the lock was held: no run was asked for.
    expect(calls.some((call) => call.startsWith("start"))).toBe(false)
    expect(calls.some((call) => call.startsWith("mount"))).toBe(false)
    expect(held.held.size).toBe(0)
  })

  test("leaving while the start is answered stops it, and lets the lock go", async () => {
    const held = locks()
    const platform = client()
    let answer: (run: StartedRun) => void = () => {}
    const played = playRun(stage, {
      client: {
        ...platform,
        startRun: () => {
          calls.push("start")
          return new Promise<StartedRun>((resolve) => {
            answer = resolve
          })
        },
      },
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: held,
    })
    await settle()
    expect(calls.at(-1)).toBe("start")
    played.end()
    answer(RUN)
    await settle()
    expect(calls.some((call) => call.startsWith("mount"))).toBe(false)
    expect(held.held.size).toBe(0)
  })

  test("taking it down destroys the game and lets the lock go", async () => {
    const held = locks()
    const played = playRun(stage, {
      client: client(),
      game: new FakeGame(PRESENT, "mh-new"),
      mode: "ranked",
      locks: held,
    })
    await settle()
    played.destroy()
    await settle()
    expect(calls).toContain("destroy")
    expect(held.held.size).toBe(0)
  })

  test("a device notice reaches the page's handler", async () => {
    const notices: string[] = []
    const game = new FakeGame(PRESENT, "mh-new")
    playRun(stage, {
      client: client(),
      game,
      mode: "ranked",
      locks: locks(),
      onNotice: (notice) => notices.push(notice.code),
    })
    await settle()
    game.mounted?.handlers.onNotice?.({
      code: "E_GAMEPAD_UNMAPPED",
      detail: "",
    })
    expect(notices).toEqual(["E_GAMEPAD_UNMAPPED"])
  })
})

/**
 * A real page module, loaded as a page loads one, whose runs go on the test's
 * clock and hear the test's keys.
 */
async function onTheirClock(
  module: PageModule,
  manifestHash: string,
  scheduler: ManualScheduler,
  keys: CaptureEnvironment,
): Promise<LoadedGame> {
  const devices = { scheduler, environment: keys }
  return await loadGame(
    { presentUrl: PRESENT, manifestHash, filesUrl: RUN.game.filesUrl },
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

describe("a real page module through a real run", () => {
  /**
   * The engine, the module, the driver and the chunks together: keys pressed
   * on the page reach the platform as chunks no larger than the run allows,
   * and the run's end goes last, before the recording.
   */
  test("presses reach the platform in chunks under the run's cap, then the recording", async () => {
    const module = definePageModule({
      createGame: () => new Probe(),
      manifest: MANIFEST,
      createPresentation: () => new Drawn(),
      capture: { keys: { ArrowLeft: "left" } },
    })
    const scheduler = new ManualScheduler()
    const keys = devices()
    const hash = hashCanonical(MANIFEST as unknown as PlainValue)
    const game = await onTheirClock(module, hash, scheduler, keys)
    const run: StartedRun = {
      ...RUN,
      config: { endAt: 200 },
      game: { ...RUN.game, manifestHash: hash },
      limits: { chunkBytes: 300, runBytes: 100_000 },
    }
    const platform = client({ start: run })
    const states: RunState[] = []
    playRun(stage, {
      client: platform,
      game,
      mode: "ranked",
      locks: locks(),
      chunkSeconds: 1,
      onState: (state) => states.push(state),
    })
    await settle()
    for (let frame = 0; frame < 210; frame += 1) {
      if (frame % 10 === 5) keys.press("ArrowLeft", true)
      if (frame % 10 === 7) keys.press("ArrowLeft", false)
      scheduler.advance(FRAME_MS)
    }
    await settle()
    const sizes = platform.chunks.map(
      (chunk) => new TextEncoder().encode(JSON.stringify(chunk)).byteLength,
    )
    expect(sizes.length).toBeGreaterThan(3)
    for (const size of sizes) expect(size).toBeLessThanOrEqual(300)
    const inputs = platform.chunks.flatMap((chunk) => chunk.inputs)
    // Twenty presses and their releases: a run that recorded nothing would
    // pass every other check here.
    expect(inputs).toHaveLength(40)
    expect(platform.chunks.at(-1)?.throughTick).toBe(200)
    expect(
      calls.filter((call) => !call.startsWith("unlock")).slice(-2),
    ).toEqual(["submit", "result"])
    expect(states.at(-1)?.phase).toBe(RUN_PHASE.DONE)
  })

  test("after a final chunk refusal nothing more is sent", async () => {
    const module = definePageModule({
      createGame: () => new Probe(),
      manifest: MANIFEST,
      createPresentation: () => new Drawn(),
      capture: { keys: { ArrowLeft: "left" } },
    })
    const scheduler = new ManualScheduler()
    const keys = devices()
    const hash = hashCanonical(MANIFEST as unknown as PlainValue)
    const game = await onTheirClock(module, hash, scheduler, keys)
    const platform = client({
      start: { ...RUN, game: { ...RUN.game, manifestHash: hash } },
      chunk: new PlatformRefusal(409, {
        error: "E_CHUNK_CONFLICT",
        message: "a different body under seq 0",
      }),
    })
    const states: RunState[] = []
    playRun(stage, {
      client: platform,
      game,
      mode: "ranked",
      locks: locks(),
      chunkSeconds: 1,
      onState: (state) => states.push(state),
    })
    await settle()
    keys.press("ArrowLeft", true)
    scheduler.run(130, FRAME_MS)
    await settle()
    scheduler.run(130, FRAME_MS)
    await settle()
    expect(calls.filter((call) => call.startsWith("chunk"))).toEqual([
      "chunk 0",
    ])
    expect(calls).not.toContain("submit")
    expect(states.at(-1)?.errorCode).toBe("E_CHUNK_CONFLICT")
  })
})
