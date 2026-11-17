/**
 * The template's site: what it says for each state a run reaches, and what
 * it does with each click. The page runs in happy-dom against a stand-in
 * client, with `loadGame` and `playRun` replaced, so what is held is the
 * page's own decisions: which module a click plays, in which mode, what it
 * shows on a paused day or a bar, and that it reads the game again on every
 * Play. The SDK's own `loadGame` and `playRun` are held by their own tests,
 * and the page against the stand-in by `vbz dev --site`.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { MotionAccess } from "@clockwork2/engine/host"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import type {
  Board,
  PageGame,
  PageGameVersion,
  RunMode,
  RunResult,
} from "../../src/api/index"
import { TEMPLATE_DIR } from "../../src/cli/new"
import type { GameAddress, LoadedGame } from "../../src/host/load"
import type { LocalPlayOptions, LocalRun } from "../../src/host/local"
import { type PlayOptions, playRun, type RunLocks } from "../../src/host/play"
import { CLIENT_ERROR } from "../../src/platform/errors"
import { RUN_PHASE, type RunState } from "../../src/platform/run"
import {
  barredMessage,
  endedMessage,
  NO_ROUND_TODAY,
  RANKED_PAUSED,
  RANKED_PAUSED_ALONE,
  resultMessage,
  SIGN_IN_FIRST,
  stateMessage,
} from "../../templates/game/site/messages"
import {
  LOCAL_BUILD,
  readConfig,
  type SiteOptions,
  startLocalSite,
  startSite,
} from "../../templates/game/site/page"

beforeAll(() => {
  GlobalRegistrator.register({ url: "https://studio.example/" })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

function state(overrides: Partial<RunState>): RunState {
  return {
    phase: RUN_PHASE.FAILED,
    errorCode: null,
    detail: null,
    refusalDetail: null,
    result: null,
    ...overrides,
  }
}

function result(replay: RunResult["replay"]): RunResult {
  return {
    sessionId: "s-1",
    mode: "ranked",
    day: "2026-11-16",
    state: "settled",
    committed: true,
    replay,
  }
}

describe("what the page says", () => {
  const open = { practiceOpen: true }

  test("each phase of a run has its sentence, and playing has none", () => {
    expect(stateMessage(state({ phase: RUN_PHASE.LOADING }), open)).toBe(
      "Starting",
    )
    expect(stateMessage(state({ phase: RUN_PHASE.PLAYING }), open)).toBe("")
    expect(stateMessage(state({ phase: RUN_PHASE.SUBMITTING }), open)).toBe(
      "Sending your run",
    )
    expect(stateMessage(state({ phase: RUN_PHASE.REPLAYING }), open)).toBe(
      "Checking your run",
    )
  })

  test("a settled run says what its replay decided, never what the page showed", () => {
    const scored = result({
      fault: null,
      code: null,
      counters: { motes: 3, ticksSurvived: 900 },
      endTick: 900,
    })
    expect(
      stateMessage(state({ phase: RUN_PHASE.DONE, result: scored }), open),
    ).toBe("You scored motes 3, ticksSurvived 900")
    expect(
      resultMessage(
        result({
          fault: "mismatch",
          code: null,
          counters: null,
          endTick: null,
        }),
      ),
    ).toContain("did not count")
    expect(
      resultMessage(
        result({
          fault: "log_fault",
          code: "E_X",
          counters: null,
          endTick: null,
        }),
      ),
    ).toContain("could not be replayed")
    expect(
      resultMessage(
        result({
          fault: "platform_fault",
          code: null,
          counters: null,
          endTick: null,
        }),
      ),
    ).toContain("could not be checked")
    expect(
      resultMessage(
        result({ fault: null, code: null, counters: null, endTick: null }),
      ),
    ).toBe("Nothing to score in that run")
    expect(resultMessage(result(null))).toContain("ended before")
    expect(resultMessage(null)).toContain("ended before")
  })

  test("a paused day says practice is open, where it is", () => {
    const paused = state({ errorCode: "E_RANKED_PAUSED", detail: "paused" })
    expect(stateMessage(paused, open)).toBe(RANKED_PAUSED)
    expect(RANKED_PAUSED).toBe("Ranked play is paused; practice is open")
    expect(stateMessage(paused, { practiceOpen: false })).toBe(
      RANKED_PAUSED_ALONE,
    )
  })

  test("a bar says when it ends, from the refusal's own detail", () => {
    const barred = state({
      errorCode: "E_PLAYER_BARRED",
      detail: "the platform's sentence",
      refusalDetail: { until: "2026-11-17T09:00:00.000Z" },
    })
    expect(
      stateMessage(barred, {
        ...open,
        formatTime: (time) => time.toISOString(),
      }),
    ).toBe("You can play this game again from 2026-11-17T09:00:00.000Z")
    // Without a time it can read, the platform's own sentence is shown.
    expect(stateMessage({ ...barred, refusalDetail: null }, open)).toBe(
      "the platform's sentence",
    )
    expect(barredMessage("not a time", "fallback")).toBe("fallback")
    expect(barredMessage("2026-11-17T09:00:00.000Z", "x")).toContain(
      "You can play this game again from",
    )
  })

  test("signing out mid-way asks to sign in, and anything else is said in its own words", () => {
    expect(stateMessage(state({ errorCode: "E_SIGN_IN_REQUIRED" }), open)).toBe(
      SIGN_IN_FIRST,
    )
    expect(stateMessage(state({ errorCode: "E_NOT_SIGNED_IN" }), open)).toBe(
      SIGN_IN_FIRST,
    )
    expect(
      stateMessage(
        state({ errorCode: "E_RUN_OPEN_ELSEWHERE", detail: "elsewhere" }),
        open,
      ),
    ).toBe("elsewhere")
    expect(stateMessage(state({ errorCode: "E_X" }), open)).toBe(
      "The run stopped",
    )
  })
})

describe("the page's config", () => {
  test("a filled-in ranked config is a client's", () => {
    expect(
      readConfig({
        mode: "ranked",
        apiOrigin: "https://api.example",
        signInOrigin: "https://signin.example",
        pageKey: "vbz_pk_1",
      }),
    ).toEqual({
      mode: "ranked",
      apiOrigin: "https://api.example",
      signInOrigin: "https://signin.example",
      pageKey: "vbz_pk_1",
    })
  })

  /** A new game plays with no platform until its author opts in. */
  test("the template's own plays locally", async () => {
    const shipped = JSON.parse(
      await readFile(join(TEMPLATE_DIR, "site", "config.json"), "utf8"),
    ) as unknown
    expect(shipped).toEqual({ mode: "local" })
    expect(readConfig(shipped)).toEqual({ mode: "local" })
  })

  /** Never a mode chosen because a key is missing: the file says which. */
  test("a config naming no mode is refused, however much else it holds", () => {
    for (const config of [
      null,
      {},
      {
        apiOrigin: "https://api.vbz.gg",
        signInOrigin: "https://signin.vbz.gg",
        pageKey: "vbz_pk_1",
      },
      { mode: "practice" },
    ]) {
      expect(() => readConfig(config)).toThrow(/names its mode/)
    }
  })

  test("ranked with no page key says which file to fill in", () => {
    expect(() =>
      readConfig({
        mode: "ranked",
        apiOrigin: "https://api.vbz.gg",
        signInOrigin: "https://signin.vbz.gg",
        pageKey: "",
      }),
    ).toThrow(/site\/config\.json needs/)
    expect(() =>
      readConfig({
        mode: "ranked",
        apiOrigin: "a",
        signInOrigin: "b",
        pageKey: "vbz_sk_1",
      }),
    ).toThrow(/pageKey/)
  })
})

const RANKED: PageGameVersion = {
  id: "v-2",
  version: "1.0.1",
  manifest: {},
  manifestSha256: "a".repeat(64),
  manifestHash: "h-ranked",
  presentUrl: "https://bundles.example/g/g-1/present/ranked.js",
  filesUrl: "https://bundles.example/g/g-1/t/ranked/",
}
const PRACTICE: PageGameVersion = {
  ...RANKED,
  id: "v-3",
  version: "1.1.0",
  manifestHash: "h-practice",
  presentUrl: "https://bundles.example/g/g-1/present/practice.js",
}

function pageGame(overrides: Partial<PageGame> = {}): PageGame {
  return {
    game: {
      id: "g-1",
      slug: "lane-runner",
      title: "Lane Runner",
      dailySeed: true,
      practice: true,
      rankedRunsPerDay: null,
    },
    studio: { slug: "s", name: "Studio" },
    day: "2026-11-16",
    today: { seedCommit: null, line: "1.0", ranked: "open", version: RANKED },
    practiceVersion: PRACTICE,
    ...overrides,
  }
}

const EMPTY_BOARD: Board = {
  gameId: "g-1",
  period: "day",
  from: null,
  to: "2026-11-17T00:00:00.000Z",
  total: 0,
  rows: [],
  you: null,
  rankBy: [],
  tiePolicy: "shared",
}

/** A module of `version`; one that reads tilt when `tilt` is its answer to asking. */
function moduleAt(version: PageGameVersion, tilt?: MotionAccess): LoadedGame {
  const handle = { recorded: () => [], stop: () => {}, destroy: () => {} }
  return {
    presentUrl: version.presentUrl,
    manifestHash: version.manifestHash,
    filesUrl: version.filesUrl,
    contract: 2,
    needsMotion: tilt !== undefined,
    tickHz: 60,
    servedConfig: {},
    requestMotion: async () => tilt ?? { granted: true },
    prepare: () => ({
      ready: Promise.resolve(null),
      mount: () => handle,
      release: () => {},
    }),
    mount: () => handle,
  }
}

/**
 * The page, with a client, a loader and a player of runs that record what
 * they were asked. With `play`, runs go through that instead, such as the
 * SDK's own `playRun`; with `tilt`, every module reads tilt and answers it.
 */
function rig(answers: {
  games: PageGame[]
  signedIn?: boolean
  tilt?: MotionAccess
  play?: SiteOptions["play"]
}) {
  document.body.innerHTML = `
    <h1 id="title">Game</h1><div id="signin"></div>
    <div id="game"></div><p id="message"></p>
    <button id="play">Play</button><button id="practice">Practice</button>
    <div id="board"></div>`
  const games = [...answers.games]
  let reads = 0
  let boards = 0
  let starts = 0
  const plays: Array<{
    readonly mode: RunMode
    readonly game: LoadedGame
    readonly options: PlayOptions
    destroyed: boolean
    /** The run's own module, once the run turned out to be on another version. */
    own: LoadedGame | null
  }> = []
  const loads: string[] = []
  let signedIn = answers.signedIn !== false
  const following = new Set<
    (player: { id: string; displayName: string } | null) => void
  >()
  const client = {
    pageKey: "vbz_pk_1" as const,
    game: async () => {
      reads += 1
      const next = games.length > 1 ? games.shift() : games[0]
      if (next === undefined) throw new Error("no game scripted")
      return next
    },
    player: () => (signedIn ? { id: "p-1", displayName: "Ann" } : null),
    onPlayerChange: (
      listener: (player: { id: string; displayName: string } | null) => void,
    ) => {
      following.add(listener)
      return () => {
        following.delete(listener)
      }
    },
    signIn: async () => ({ id: "p-1", displayName: "Ann" }),
    signOut: () => {},
    board: async () => {
      boards += 1
      return EMPTY_BOARD
    },
    startRun: async () => {
      starts += 1
      throw new Error("the page starts runs through playRun")
    },
    sendChunk: async () => ({ seq: 0, throughTick: 0 }),
    submit: async () => ({ sessionId: "s", recordingSha256: "x" }),
    awaitResult: async () => result(null),
  }
  const site = startSite({
    document,
    client,
    load: async (address) => {
      loads.push(address.presentUrl)
      if (address.presentUrl.includes("broken")) {
        throw new Error("the game's code did not load")
      }
      return moduleAt(address as PageGameVersion, answers.tilt)
    },
    play:
      answers.play ??
      ((_element, options) => {
        const entry = {
          mode: options.mode,
          game: options.game,
          options,
          destroyed: false,
          own: null as LoadedGame | null,
        }
        plays.push(entry)
        return {
          // The page reads only `game` and `destroy` of what `playRun` hands back.
          run: {} as never,
          get game() {
            return entry.own ?? options.game
          },
          motion: null,
          end: () => {},
          destroy: () => {
            entry.destroyed = true
          },
        }
      }),
    formatTime: (time) => time.toISOString(),
  })
  const click = (id: string) =>
    (document.getElementById(id) as HTMLButtonElement).click()
  const message = () => document.getElementById("message")?.textContent ?? ""
  return {
    site,
    /**
     * The client forgetting the player, as it does when the platform stops
     * honouring a token, and telling whoever follows it.
     */
    forgetPlayer: () => {
      signedIn = false
      for (const listener of [...following]) listener(null)
    },
    plays,
    loads,
    click,
    message,
    reads: () => reads,
    boards: () => boards,
    starts: () => starts,
  }
}

/** Web Locks as a browser with one tab has them: every lock is free. */
const oneTab: RunLocks = {
  async request(_name, _options, callback) {
    return await callback({})
  },
}

async function settled(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0))
}

describe("the page", () => {
  beforeEach(() => {
    document.title = ""
  })

  test("it loads both modules before a click, and names the game", async () => {
    const page = rig({ games: [pageGame()] })
    await settled()
    expect(document.getElementById("title")?.textContent).toBe("Lane Runner")
    expect(document.title).toBe("Lane Runner")
    expect(page.loads).toEqual([RANKED.presentUrl, PRACTICE.presentUrl])
    expect(page.boards()).toBe(1)
  })

  test("Play plays the ranked module ranked, and Practice the practice module", async () => {
    const page = rig({ games: [pageGame()] })
    await settled()
    page.click("play")
    page.click("practice")
    expect(page.plays.map((p) => [p.mode, p.game.presentUrl])).toEqual([
      ["ranked", RANKED.presentUrl],
      ["practice", PRACTICE.presentUrl],
    ])
    // The run before is taken down before the next one starts.
    expect(page.plays[0]?.destroyed).toBe(true)
    expect(page.plays[0]?.options.title).toBe("Lane Runner")
    // Each module is loaded once, however many times the game is read again.
    await settled()
    expect(page.loads).toEqual([RANKED.presentUrl, PRACTICE.presentUrl])
  })

  test("with nobody signed in, Play asks for a sign-in and starts nothing", async () => {
    const page = rig({ games: [pageGame()], signedIn: false })
    await settled()
    page.click("play")
    expect(page.plays).toEqual([])
    expect(page.message()).toBe(SIGN_IN_FIRST)
  })

  test("a run refused for a sign-in that stopped working shows the player signed out", async () => {
    const page = rig({ games: [pageGame()] })
    await settled()
    const signInButton = () =>
      document.querySelector("#signin button")?.textContent ?? ""
    expect(signInButton()).toBe("Sign out")
    page.click("play")
    // The run's start is refused and the client forgets the player: the box
    // follows the client, before the page hears the run failed.
    page.forgetPlayer()
    expect(signInButton()).toBe("Sign in")
    expect(
      document.querySelector(".gb-signin-name")?.hasAttribute("hidden"),
    ).toBe(true)
    page.plays[0]?.options.onState?.(
      state({ errorCode: "E_SIGN_IN_REQUIRED", detail: "sign in first" }),
    )
    expect(page.message()).toBe(SIGN_IN_FIRST)
    expect(signInButton()).toBe("Sign in")
  })

  test("on a paused day it says so, and Play still asks, reading the game again", async () => {
    const paused = pageGame({
      today: { seedCommit: null, line: "1.0", ranked: "paused", version: null },
    })
    const page = rig({ games: [paused, paused, pageGame()] })
    await settled()
    expect(page.message()).toBe(RANKED_PAUSED)
    expect(page.reads()).toBe(1)

    // A ranked run is asked for with the module the page has, and the
    // platform answers which version it plays, or that it is still paused.
    page.click("play")
    expect(page.plays[0]?.mode).toBe("ranked")
    expect(page.plays[0]?.game.presentUrl).toBe(PRACTICE.presentUrl)
    page.plays[0]?.options.onState?.(
      state({ errorCode: "E_RANKED_PAUSED", detail: "paused" }),
    )
    expect(page.message()).toBe(RANKED_PAUSED)
    await settled()
    expect(page.reads()).toBe(2)

    // A newer patch passed in between: the next Play reads it and plays it.
    page.click("play")
    await settled()
    expect(page.reads()).toBe(3)
    page.click("play")
    expect(page.plays.at(-1)?.game.presentUrl).toBe(RANKED.presentUrl)
  })

  test("a paused day with no practice says only that ranked play is paused", async () => {
    const page = rig({
      games: [
        pageGame({
          game: { ...pageGame().game, practice: false },
          today: {
            seedCommit: null,
            line: "1.0",
            ranked: "paused",
            version: null,
          },
          practiceVersion: null,
        }),
      ],
    })
    await settled()
    expect(page.message()).toBe(RANKED_PAUSED_ALONE)
    expect(document.getElementById("practice")?.hidden).toBe(true)
    // Nothing to play: the press reads the game again and starts nothing.
    page.click("play")
    expect(page.plays).toEqual([])
    await settled()
    expect(page.reads()).toBe(2)
  })

  test("a day with no round says so", async () => {
    const page = rig({ games: [pageGame({ today: null })] })
    await settled()
    expect(page.message()).toBe(NO_ROUND_TODAY)
  })

  test("a bar says when it ends", async () => {
    const page = rig({ games: [pageGame()] })
    await settled()
    page.click("play")
    page.plays[0]?.options.onState?.(
      state({
        errorCode: "E_PLAYER_BARRED",
        detail: "barred",
        refusalDetail: { until: "2026-11-17T09:00:00.000Z" },
      }),
    )
    expect(page.message()).toBe(
      "You can play this game again from 2026-11-17T09:00:00.000Z",
    )
  })

  test("a run that needs a second tap plays the run's own module on the next Play", async () => {
    const page = rig({ games: [pageGame()] })
    await settled()
    page.click("play")
    const first = page.plays[0]
    if (first === undefined) throw new Error("no run")
    // The run turned out to be on an older version, which reads tilt.
    first.own = moduleAt({
      ...RANKED,
      presentUrl: "https://bundles.example/g/g-1/present/older.js",
    })
    first.options.onState?.(
      state({ errorCode: "E_MOTION_NEEDS_TAP", detail: "tap Play again" }),
    )
    expect(page.message()).toBe("tap Play again")
    page.click("play")
    expect(page.plays[1]?.mode).toBe("ranked")
    expect(page.plays[1]?.game.presentUrl).toBe(first.own.presentUrl)
  })

  /**
   * The page with the SDK's own `playRun`, a game steered by tilt, and a
   * player who would not allow it, as on an iPad after "Cancel" on its motion
   * prompt (the button's name, measured on iPadOS 26.7). The page says why
   * in the client's own sentence, and nothing is asked of the platform, so
   * no ranked run is spent on a game nobody can steer.
   */
  test("a refusal of tilt is said in the client's sentence, and starts no run", async () => {
    const page = rig({
      games: [pageGame()],
      tilt: {
        granted: false,
        code: "E_MOTION_DENIED",
        detail: 'the browser answered "denied"',
      },
      // The SDK's own `playRun`, from the source under test. The site names
      // the package's built copy, which declares the same `Run` class again,
      // so the two answers differ only in where they were declared.
      play: (element, options) =>
        playRun(element, {
          ...options,
          locks: oneTab,
        }) as unknown as ReturnType<NonNullable<SiteOptions["play"]>>,
    })
    await settled()
    page.click("play")
    await settled()
    expect(page.message()).toBe(CLIENT_ERROR.E_MOTION_DENIED)
    expect(page.starts()).toBe(0)
  })

  test("a practice tap in between is not the second tap of a ranked run", async () => {
    const page = rig({ games: [pageGame()] })
    await settled()
    page.click("play")
    const first = page.plays[0]
    if (first === undefined) throw new Error("no run")
    first.own = moduleAt({
      ...RANKED,
      presentUrl: "https://bundles.example/g/g-1/present/older.js",
    })
    first.options.onState?.(state({ errorCode: "E_MOTION_NEEDS_TAP" }))
    page.click("practice")
    expect(page.plays[1]?.game.presentUrl).toBe(PRACTICE.presentUrl)
    page.click("play")
    expect(page.plays[2]?.game.presentUrl).toBe(RANKED.presentUrl)
  })

  test("a settled run's result is said, and the board read again", async () => {
    const page = rig({ games: [pageGame()] })
    await settled()
    page.click("play")
    const before = page.boards()
    page.plays[0]?.options.onState?.(
      state({
        phase: RUN_PHASE.DONE,
        result: result({
          fault: null,
          code: null,
          counters: { motes: 2 },
          endTick: 9,
        }),
      }),
    )
    await settled()
    expect(page.message()).toBe("You scored motes 2")
    expect(page.boards()).toBe(before + 1)
  })

  test("a device notice is said, and stops nothing", async () => {
    const page = rig({ games: [pageGame()] })
    await settled()
    page.click("play")
    page.plays[0]?.options.onNotice?.({
      code: "E_GAMEPAD_BLOCKED",
      detail: "the page forbids gamepads",
    })
    expect(page.message()).toBe("the page forbids gamepads")
  })

  test("a module that will not load is said, and the other still plays", async () => {
    const page = rig({
      games: [
        pageGame({
          today: {
            seedCommit: null,
            line: "1.0",
            ranked: "open",
            version: {
              ...RANKED,
              presentUrl: "https://bundles.example/broken.js",
            },
          },
        }),
      ],
    })
    await settled()
    expect(page.message()).toBe("the game's code did not load")
    page.click("play")
    expect(page.plays[0]?.game.presentUrl).toBe(PRACTICE.presentUrl)
  })

  test("a game that cannot be read is said", async () => {
    document.body.innerHTML = `
      <h1 id="title">Game</h1><div id="signin"></div>
      <div id="game"></div><p id="message"></p>
      <button id="play">Play</button><button id="practice">Practice</button>
      <div id="board"></div>`
    startSite({
      document,
      client: {
        pageKey: "vbz_pk_1",
        game: async () => {
          throw new Error("the platform did not answer")
        },
        player: () => null,
        onPlayerChange: () => () => {},
        signIn: async () => ({ id: "p", displayName: "p" }),
        signOut: () => {},
        board: async () => EMPTY_BOARD,
        startRun: async () => {
          throw new Error("unused")
        },
        sendChunk: async () => ({ seq: 0, throughTick: 0 }),
        submit: async () => ({ sessionId: "s", recordingSha256: "x" }),
        awaitResult: async () => result(null),
      },
      load: async () => {
        throw new Error("unused")
      },
    })
    await settled()
    expect(document.getElementById("message")?.textContent).toBe(
      "the platform did not answer",
    )
  })

  test("a page missing one of its elements says which", () => {
    document.body.innerHTML = "<p>nothing</p>"
    expect(() =>
      startSite({
        document,
        client: {} as never,
        load: async () => ({}) as never,
      }),
    ).toThrow(/the page has no #title/)
  })
})

describe("the page played locally", () => {
  const BUILD = {
    name: "Lane Runner",
    present: "present.js",
    sim: "sim.js",
    manifest: "manifest.json",
    manifestHash: "h-local",
    files: "files/",
    listing: "files.json",
    filesSha256: "f".repeat(64),
  }

  function localRig(build: unknown = BUILD) {
    document.body.innerHTML = `
      <header><h1 id="title">Game</h1><div id="signin"></div></header>
      <div id="game"></div><p id="message"></p>
      <button id="play">Play</button><button id="practice">Practice</button>
      <section><h2>Today's board</h2><div id="board"></div></section>`
    const fetched: string[] = []
    const loaded: GameAddress[] = []
    const plays: LocalPlayOptions[] = []
    const site = startLocalSite({
      document,
      fetch: async (url) => {
        fetched.push(url)
        return Response.json(build)
      },
      load: async (address) => {
        loaded.push(address)
        return moduleAt({
          ...RANKED,
          presentUrl: address.presentUrl,
          manifestHash: address.manifestHash,
          filesUrl: address.filesUrl,
        })
      },
      play: (_element, options) => {
        plays.push(options)
        return {} as LocalRun
      },
    })
    const byId = (id: string) => document.getElementById(id) as HTMLElement
    return { site, fetched, loaded, plays, byId }
  }

  test("loads the build beside it, as vbz build wrote it, before any click", async () => {
    const { site, fetched, loaded, byId } = localRig()
    expect((byId("play") as HTMLButtonElement).disabled).toBe(true)
    await site.ready
    const url = new URL(LOCAL_BUILD, document.baseURI).href
    expect(fetched).toEqual([url])
    expect(loaded).toEqual([
      {
        presentUrl: new URL("present.js", url).href,
        manifestHash: "h-local",
        filesUrl: new URL("files/", url).href,
      },
    ])
    expect(byId("title").textContent).toBe("Lane Runner")
    expect((byId("play") as HTMLButtonElement).disabled).toBe(false)
  })

  /** Nothing of ranked play is on a page that talks to nobody. */
  test("shows no sign-in, no practice and no board", async () => {
    const { byId } = localRig()
    expect(byId("signin").hidden).toBe(true)
    expect(byId("practice").hidden).toBe(true)
    expect(byId("board").closest("section")?.hidden).toBe(true)
    expect(byId("play").hidden).toBe(false)
  })

  test("Play starts a local run, from the devices alone, and its end says the score", async () => {
    const { site, plays, byId } = localRig()
    await site.ready
    byId("play").click()
    expect(plays).toHaveLength(1)
    const options = plays[0] as LocalPlayOptions
    expect(options.scripted).toBe("ignore")
    expect(options.title).toBe("Lane Runner")
    options.onEnded({
      tick: 90,
      reason: "completed",
      counters: { motes: 4 },
      recording: {} as never,
    })
    expect(byId("message").textContent).toBe("You scored motes 4")
    options.onError?.({ code: "E_MOTION_DENIED", message: "tilt was refused" })
    expect(byId("message").textContent).toBe("tilt was refused")
  })

  test("a build that is not what vbz build writes says so, and Play stays off", async () => {
    const { site, byId, plays } = localRig({ present: 3 })
    await site.ready
    expect(byId("message").textContent).toContain("game's code did not load")
    expect((byId("play") as HTMLButtonElement).disabled).toBe(true)
    byId("play").click()
    expect(plays).toEqual([])
  })

  test("the end of a run with nothing to count says so", () => {
    expect(endedMessage({ counters: {} })).toBe("Nothing to score in that run")
  })
})
