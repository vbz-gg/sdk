/**
 * The client against a scripted platform: signing a player in through the
 * window, keeping and renewing the token, and the run, board and result
 * routes.
 */

import { describe, expect, test } from "bun:test"
import {
  createPlatformClient,
  isFinalResult,
  type RunRecording,
} from "../../src/platform/client"
import type {
  PlatformClientError,
  PlatformRefusal,
} from "../../src/platform/errors"
import { SIGN_IN_READY_MS } from "../../src/platform/signin"
import { FakePage, settle } from "./fake-page"

const API = "https://api.vbz.example"
const SIGN_IN = "https://signin.vbz.example"
const KEY = "vbz_pk_abc" as const
const PLAYER = { id: "p-1", displayName: "player-3fa91c0e" }

function client(page = new FakePage(), onSignedOut?: () => void) {
  return {
    page,
    client: createPlatformClient({
      apiOrigin: API,
      signInOrigin: SIGN_IN,
      pageKey: KEY,
      environment: page,
      ...(onSignedOut === undefined ? {} : { onSignedOut }),
    }),
  }
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error("expected a failure")
}

/** The query the page pointed the box's frame at. */
function authorizeQuery(page: FakePage): URLSearchParams {
  const href = page.box?.url ?? ""
  expect(href.startsWith(`${SIGN_IN}/authorize?`)).toBe(true)
  return new URL(href).searchParams
}

/** The sign-in, posting from the box's frame on its own origin. */
function fromFrame(page: FakePage, data: unknown): void {
  page.post({ origin: SIGN_IN, source: page.box?.frame, data })
}

/** The sign-in loading in its box, and then handing the page a code. */
function signedInThroughBox(page: FakePage, code = "code-1"): void {
  const state = authorizeQuery(page).get("state")
  fromFrame(page, { type: "vbz.signin.ready", state })
  fromFrame(page, { type: "vbz.signin", code, state })
}

async function signedIn() {
  const made = client()
  made.page.answers.push({
    status: 200,
    body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
  })
  const signing = made.client.signIn()
  await settle()
  signedInThroughBox(made.page)
  await signing
  return made
}

/** How a sign-in ended, once it has: the player, or the client's code. */
function outcome(signing: Promise<unknown>) {
  const seen: { value?: unknown; code?: string } = {}
  signing.then(
    (value) => {
      seen.value = value
    },
    (error: unknown) => {
      seen.code = (error as PlatformClientError).code
    },
  )
  return seen
}

describe("signing a player in", () => {
  /**
   * In the click's own turn, before anything is awaited, so focus moves into
   * the box from the click; only then is the challenge made and the frame
   * pointed at the sign-in.
   */
  test("puts the box on the page before anything is awaited, then points its frame at authorize", async () => {
    const { page, client: platform } = client()
    const signing = platform.signIn()
    expect(page.boxes).toHaveLength(1)
    expect(page.box?.url).toBeNull()
    expect(page.listening).toBe(1)
    await settle()
    const query = authorizeQuery(page)
    expect(query.get("client_id")).toBe(KEY)
    expect(query.get("redirect_uri")).toBe(page.origin)
    expect(query.get("code_challenge_method")).toBe("S256")
    expect(query.get("code_challenge")).toHaveLength(43)
    expect(query.get("state")?.length).toBeGreaterThan(0)
    page.box?.cancel()
    await caught(() => signing)
  })

  test("takes only the frame's own message, on the sign-in's origin, for this state, and trades its code", async () => {
    const { page, client: platform } = client()
    page.answers.push({
      status: 200,
      body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
    })
    const signing = platform.signIn()
    await settle()
    const state = authorizeQuery(page).get("state")
    const right = { type: "vbz.signin", code: "code-1", state }
    // Another origin, another window, another message, another state, no code.
    page.post({
      origin: "https://evil.example",
      source: page.box?.frame,
      data: right,
    })
    page.post({ origin: SIGN_IN, source: {}, data: right })
    page.post({ origin: SIGN_IN, source: null, data: right })
    fromFrame(page, { ...right, type: "other" })
    fromFrame(page, { ...right, state: "x" })
    fromFrame(page, { ...right, code: 7 })
    fromFrame(page, null)
    fromFrame(page, "vbz.signin")
    // A cancel for another state, or from another window, closes nothing.
    fromFrame(page, { type: "vbz.signin.cancel", state: "x" })
    page.post({
      origin: SIGN_IN,
      source: {},
      data: { type: "vbz.signin.cancel", state },
    })
    expect(page.sent).toHaveLength(0)
    expect(page.box?.removed).toBe(false)
    fromFrame(page, right)

    expect(await signing).toEqual(PLAYER)
    const [trade] = page.sent
    expect(trade?.url.pathname).toBe("/v1/oauth/token")
    expect(trade?.body).toMatchObject({ code: "code-1", clientId: KEY })
    const traded = trade?.body as { codeVerifier?: string } | undefined
    expect(traded?.codeVerifier).toHaveLength(43)
    expect(platform.player()).toEqual(PLAYER)
    // The box is down, and nothing is left listening or waiting.
    expect(page.box?.removed).toBe(true)
    expect(page.listening).toBe(0)
    expect(page.pendingTimers).toBe(0)
  })

  /**
   * The player closes the box from the page, with its Cancel button or
   * Escape; from inside the frame, where the page cannot hear Escape and the
   * sign-in says so; or the page closes it itself.
   */
  test("closed by the player or the page, it rejects E_SIGNIN_CANCELLED and the box comes down", async () => {
    const ways: ReadonlyArray<
      (page: FakePage, platform: ReturnType<typeof client>["client"]) => void
    > = [
      (page) => page.box?.cancel(),
      (page) =>
        fromFrame(page, {
          type: "vbz.signin.cancel",
          state: authorizeQuery(page).get("state"),
        }),
      (_page, platform) => platform.closeSignIn(),
    ]
    for (const close of ways) {
      const { page, client: platform } = client()
      const seen = outcome(platform.signIn())
      await settle()
      close(page, platform)
      await settle()
      expect(seen.code).toBe("E_SIGNIN_CANCELLED")
      expect(page.box?.removed).toBe(true)
      expect(page.listening).toBe(0)
      expect(page.pendingTimers).toBe(0)
      // A code that arrives after is nobody's.
      signedInThroughBox(page)
      await settle()
      expect(page.sent).toHaveLength(0)
      // And closing again, or a sign-in already closed, does nothing.
      platform.closeSignIn()
      page.box?.cancel()
    }
  })

  test("closed before its frame was pointed anywhere, the box comes down and nothing loads", async () => {
    const { page, client: platform } = client()
    const seen = outcome(platform.signIn())
    page.box?.cancel()
    await settle()
    expect(seen.code).toBe("E_SIGNIN_CANCELLED")
    expect(page.box?.url).toBeNull()
    expect(page.pendingTimers).toBe(0)
  })

  /**
   * A browser that refused the frame shows nothing in the box and fires
   * `load` all the same, so the sign-in's own ready message is the only
   * sign it works.
   */
  test("no ready from the sign-in in time rejects E_SIGNIN_UNREACHABLE, and the box comes down", async () => {
    const { page, client: platform } = client()
    const seen = outcome(platform.signIn())
    await settle()
    page.advance(SIGN_IN_READY_MS - 1)
    await settle()
    expect(seen).toEqual({})
    // A ready from anywhere but the frame changes nothing.
    page.post({
      origin: SIGN_IN,
      source: {},
      data: {
        type: "vbz.signin.ready",
        state: authorizeQuery(page).get("state"),
      },
    })
    page.advance(1)
    await settle()
    expect(seen.code).toBe("E_SIGNIN_UNREACHABLE")
    expect(page.box?.removed).toBe(true)
    expect(page.listening).toBe(0)
  })

  test("once the sign-in is ready, the player may take as long as they need", async () => {
    const { page, client: platform } = client()
    page.answers.push({
      status: 200,
      body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
    })
    const seen = outcome(platform.signIn())
    await settle()
    const state = authorizeQuery(page).get("state")
    fromFrame(page, { type: "vbz.signin.ready", state })
    page.advance(SIGN_IN_READY_MS * 20)
    await settle()
    expect(seen).toEqual({})
    expect(page.pendingTimers).toBe(0)
    fromFrame(page, { type: "vbz.signin", code: "late", state })
    await settle()
    expect(seen.value).toEqual(PLAYER)
  })

  /**
   * Every page the frame shows owes a ready, not only the first. A form
   * step answered with a page the browser will not frame, a 404 the
   * sign-in frames for nobody, or one sent without the headers a page under
   * COOP and COEP needs, leaves the box as empty as a refused first page,
   * and fires `load` all the same.
   */
  test("a later page that never says it is ready rejects E_SIGNIN_UNREACHABLE too", async () => {
    const { page, client: platform } = client()
    const seen = outcome(platform.signIn())
    await settle()
    const state = authorizeQuery(page).get("state")
    // The first page: its load and its ready, in either order.
    page.box?.loaded()
    fromFrame(page, { type: "vbz.signin.ready", state })
    page.advance(SIGN_IN_READY_MS * 4)
    expect(page.pendingTimers).toBe(0)
    // A second page, whose ready comes before its load: still accounted for.
    fromFrame(page, { type: "vbz.signin.ready", state })
    page.box?.loaded()
    page.advance(SIGN_IN_READY_MS * 4)
    await settle()
    expect(seen).toEqual({})
    // A third, the browser refused to show: it loads and says nothing.
    page.box?.loaded()
    page.advance(SIGN_IN_READY_MS - 1)
    await settle()
    expect(seen).toEqual({})
    page.advance(1)
    await settle()
    expect(seen.code).toBe("E_SIGNIN_UNREACHABLE")
    expect(page.box?.removed).toBe(true)
    expect(page.listening).toBe(0)
  })

  /** A load says a page came; the wait for its ready starts there. */
  test("each page's wait for its ready starts at its load", async () => {
    const { page, client: platform } = client()
    const seen = outcome(platform.signIn())
    await settle()
    const state = authorizeQuery(page).get("state")
    page.advance(SIGN_IN_READY_MS - 10)
    page.box?.loaded()
    page.advance(SIGN_IN_READY_MS - 10)
    await settle()
    expect(seen).toEqual({})
    fromFrame(page, { type: "vbz.signin.ready", state })
    expect(page.pendingTimers).toBe(0)
    page.box?.cancel()
    await settle()
    expect(seen.code).toBe("E_SIGNIN_CANCELLED")
    // A load after the box came down waits for nothing.
    page.box?.loaded()
    expect(page.pendingTimers).toBe(0)
  })

  /** A second click while the box is up opens no second box. */
  test("a second signIn while one is open answers the first's promise, and opens nothing", async () => {
    const { page, client: platform } = client()
    page.answers.push({
      status: 200,
      body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
    })
    const first = platform.signIn()
    const second = platform.signIn()
    expect(second).toBe(first)
    expect(page.boxes).toHaveLength(1)
    await settle()
    signedInThroughBox(page)
    // Still the same while the code is traded.
    expect(platform.signIn()).toBe(first)
    expect(await first).toEqual(PLAYER)
    expect(page.boxes).toHaveLength(1)

    // Once it settled, the next opens a box of its own.
    const third = platform.signIn()
    expect(third).not.toBe(first)
    expect(page.boxes).toHaveLength(2)
    page.box?.cancel()
    await caught(() => third)
  })

  test("a page that cannot make a challenge takes its box down again", async () => {
    const page = new FakePage()
    const broken = Object.create(page) as FakePage
    Object.defineProperty(broken, "crypto", {
      value: {
        getRandomValues: page.crypto.getRandomValues.bind(page.crypto),
        subtle: { digest: () => Promise.reject(new Error("no digest")) },
      },
    })
    const { client: platform } = client(broken)
    expect(String(await caught(() => platform.signIn()))).toContain("no digest")
    expect(page.box?.removed).toBe(true)
    expect(page.box?.url).toBeNull()
  })

  test("a box that cannot be put on the page fails the sign-in with what went wrong", async () => {
    const { page, client: platform } = client()
    page.boxFails = new Error("no document")
    const failing = platform.signIn()
    // Closing one that never opened does nothing.
    platform.closeSignIn()
    expect(String(await caught(() => failing))).toContain("no document")
    expect(page.listening).toBe(0)
    // Nothing is left open, so the next try opens a box.
    page.boxFails = null
    const next = platform.signIn()
    expect(page.boxes).toHaveLength(1)
    page.box?.cancel()
    await caught(() => next)
  })

  test("signing out forgets the player on this page", async () => {
    const { client: platform } = await signedIn()
    platform.signOut()
    expect(platform.player()).toBeNull()
  })
})

describe("runs", () => {
  test("a start with nobody signed in is E_NOT_SIGNED_IN, and asks nothing", async () => {
    const { page, client: platform } = client()
    const error = (await caught(() =>
      platform.startRun(),
    )) as PlatformClientError
    expect(error.code).toBe("E_NOT_SIGNED_IN")
    expect(page.sent).toHaveLength(0)
  })

  test("a start sends the token and keeps the renewed one", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({
      status: 201,
      body: { sessionId: "s-1", token: "t-2", expiresIn: 7_776_000 },
    })
    await platform.startRun({ practice: true })
    const start = page.sent.at(-1)
    expect(start?.headers.authorization).toBe("Bearer t-1")
    expect(start?.body).toEqual({ practice: true })

    page.answers.push({ status: 200, body: { sessionId: "s-1", replay: null } })
    await platform.result("s-1")
    expect(page.sent.at(-1)?.headers.authorization).toBe("Bearer t-2")
  })

  test("a token that stopped working forgets the player, and says so", async () => {
    let told = 0
    const made = client(new FakePage(), () => {
      told += 1
    })
    made.page.answers.push({
      status: 200,
      body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
    })
    const signing = made.client.signIn()
    await settle()
    signedInThroughBox(made.page, "c")
    await signing

    made.page.answers.push({
      status: 401,
      body: {
        error: "E_SIGN_IN_REQUIRED",
        message: "this needs a player signed in to this studio",
      },
    })
    const error = (await caught(() =>
      made.client.startRun(),
    )) as PlatformRefusal
    expect(error.code).toBe("E_SIGN_IN_REQUIRED")
    expect(made.client.player()).toBeNull()
    expect(told).toBe(1)
  })

  test("an older run's token refused leaves a newer sign-in alone", async () => {
    let told = 0
    const made = client(new FakePage(), () => {
      told += 1
    })
    made.page.answers.push({
      status: 200,
      body: { token: "t-1", expiresIn: 7_776_000, player: PLAYER },
    })
    const signing = made.client.signIn()
    await settle()
    signedInThroughBox(made.page, "c")
    await signing
    const run = { sessionId: "s-old", token: "t-old" } as Parameters<
      typeof made.client.sendChunk
    >[0]
    made.page.answers.push({
      status: 401,
      body: { error: "E_SIGN_IN_REQUIRED", message: "sign in" },
    })
    const error = (await caught(() =>
      made.client.sendChunk(run, {
        seq: 3,
        throughTick: 9,
        checkpoints: [],
        inputs: [],
      }),
    )) as PlatformRefusal
    expect(error.code).toBe("E_SIGN_IN_REQUIRED")
    expect(made.client.player()).toEqual(PLAYER)
    expect(told).toBe(0)
  })

  test("another refusal leaves the player signed in", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({
      status: 429,
      body: { error: "E_RANKED_RUNS_USED", message: "used" },
    })
    await caught(() => platform.startRun())
    expect(platform.player()).toEqual(PLAYER)
  })

  test("a chunk and a submit go with the run's own token", async () => {
    const { page, client: platform } = await signedIn()
    const run = { sessionId: "s-9", token: "t-run" } as Parameters<
      typeof platform.submit
    >[0]
    page.answers.push({ status: 202, body: { seq: 0, throughTick: 9 } })
    page.answers.push({
      status: 202,
      body: { sessionId: "s-9", recordingSha256: "x" },
    })
    await platform.sendChunk(run, {
      seq: 0,
      throughTick: 9,
      checkpoints: [],
      inputs: [],
    })
    await platform.submit(run, { version: 1 } as unknown as RunRecording)
    expect(
      page.sent.slice(-2).map((s) => [s.url.pathname, s.headers.authorization]),
    ).toEqual([
      ["/v1/runs/s-9/chunks", "Bearer t-run"],
      ["/v1/runs/s-9/submit", "Bearer t-run"],
    ])
    expect(page.sent.at(-1)?.body).toEqual({ recording: { version: 1 } })
  })
})

describe("following the player", () => {
  /** Signs `made`'s page in through the window, as `player`. */
  async function signInAs(
    made: ReturnType<typeof client>,
    player: typeof PLAYER,
    expiresIn = 7_776_000,
  ) {
    made.page.answers.push({
      status: 200,
      body: { token: `t-${player.displayName}`, expiresIn, player },
    })
    const signing = made.client.signIn()
    await settle()
    signedInThroughBox(made.page, "c")
    await signing
  }

  function listen(made: ReturnType<typeof client>) {
    const told: Array<typeof PLAYER | null> = []
    const stop = made.client.onPlayerChange((player) => told.push(player))
    return { told, stop }
  }

  test("tells each sign-in and sign-out once, and a renewed token not at all", async () => {
    const made = client()
    const { told } = listen(made)
    await signInAs(made, PLAYER)
    expect(told).toEqual([PLAYER])

    made.page.answers.push({
      status: 201,
      body: { sessionId: "s-1", token: "t-2", expiresIn: 7_776_000 },
    })
    await made.client.startRun()
    expect(told).toEqual([PLAYER])

    // The same player under a name changed on the sign-in's own page is a change.
    const renamed = { ...PLAYER, displayName: "Ann" }
    await signInAs(made, renamed)
    expect(told).toEqual([PLAYER, renamed])

    made.client.signOut()
    made.client.signOut()
    expect(told).toEqual([PLAYER, renamed, null])
  })

  test("a token the platform stopped honouring is told as nobody, before the refusal", async () => {
    const order: string[] = []
    const made = client(new FakePage(), () => order.push("onSignedOut"))
    await signInAs(made, PLAYER)
    made.client.onPlayerChange((player) =>
      order.push(`changed to ${player?.displayName ?? "nobody"}`),
    )
    made.page.answers.push({
      status: 401,
      body: { error: "E_SIGN_IN_REQUIRED", message: "sign in" },
    })
    const error = (await caught(() =>
      made.client.startRun(),
    )) as PlatformRefusal
    order.push(`refused ${error.code}`)
    expect(order).toEqual([
      "changed to nobody",
      "onSignedOut",
      "refused E_SIGN_IN_REQUIRED",
    ])
    expect(made.client.player()).toBeNull()
  })

  test("an older run's token refused tells nothing", async () => {
    const made = client()
    await signInAs(made, PLAYER)
    const { told } = listen(made)
    const run = { sessionId: "s-old", token: "t-old" } as Parameters<
      typeof made.client.sendChunk
    >[0]
    made.page.answers.push({
      status: 401,
      body: { error: "E_SIGN_IN_REQUIRED", message: "sign in" },
    })
    await caught(() =>
      made.client.sendChunk(run, {
        seq: 0,
        throughTick: 9,
        checkpoints: [],
        inputs: [],
      }),
    )
    expect(told).toEqual([])
    expect(made.client.player()).toEqual(PLAYER)
  })

  test("a token found expired is told as nobody, by whatever read found it", async () => {
    const made = client()
    await signInAs(made, PLAYER, 60)
    const { told } = listen(made)
    made.page.advance(60_000)
    made.page.answers.push({ status: 200, body: { rows: [] } })
    await made.client.board()
    expect(made.page.sent.at(-1)?.headers.authorization).toBeUndefined()
    expect(told).toEqual([null])
    expect(made.client.player()).toBeNull()
    expect(told).toEqual([null])
  })

  test("a player kept from an earlier visit is no change, and a stopped listener hears nothing", async () => {
    const earlier = client()
    await signInAs(earlier, PLAYER)
    const made = client(earlier.page)
    const { told, stop } = listen(made)
    expect(made.client.player()).toEqual(PLAYER)
    expect(told).toEqual([])
    stop()
    made.client.signOut()
    expect(told).toEqual([])
  })
})

describe("waiting for a result", () => {
  const waiting = {
    sessionId: "s-1",
    state: "submitted",
    committed: true,
    replay: null,
  }
  const done = {
    ...waiting,
    state: "settled",
    replay: { fault: null, code: null, counters: { motes: 3 }, endTick: 90 },
  }

  test("is final once the replay ran, or the run expired having sent nothing", () => {
    expect(isFinalResult(waiting as never)).toBe(false)
    expect(isFinalResult(done as never)).toBe(true)
    expect(
      isFinalResult({
        ...waiting,
        state: "expired",
        committed: false,
      } as never),
    ).toBe(true)
    expect(
      isFinalResult({ ...waiting, state: "expired", committed: true } as never),
    ).toBe(false)
  })

  test("asks again, through a request that got no answer, until it is final", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({ status: 200, body: waiting })
    page.answers.push({ unreachable: true })
    page.answers.push({ status: 200, body: done })
    const result = platform.awaitResult("s-1", { intervalMs: 100 })
    for (let i = 0; i < 3; i += 1) {
      await settle()
      page.advance(100)
    }
    expect(await result).toEqual(done as never)
  })

  test("a refusal ends the wait", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({
      status: 404,
      body: { error: "E_NOT_FOUND", message: "no" },
    })
    const error = (await caught(() =>
      platform.awaitResult("s-1"),
    )) as PlatformRefusal
    expect(error.code).toBe("E_NOT_FOUND")
  })

  test("an abort ends it too, between asks and before the first", async () => {
    const { page, client: platform } = await signedIn()
    page.answers.push({ status: 200, body: waiting })
    const controller = new AbortController()
    const result = platform.awaitResult("s-1", { signal: controller.signal })
    await settle()
    controller.abort(new Error("left the page"))
    expect(String(await caught(() => result))).toContain("left the page")
    expect(
      String(
        await caught(() =>
          platform.awaitResult("s-1", { signal: controller.signal }),
        ),
      ),
    ).toContain("left the page")
  })

  test("asks with the run's own token when given one", async () => {
    const { page, client: platform } = await signedIn()
    platform.signOut()
    page.answers.push({ status: 200, body: done })
    expect(await platform.awaitResult("s-1", { token: "t-run" })).toEqual(
      done as never,
    )
    expect(page.sent.at(-1)?.headers.authorization).toBe("Bearer t-run")
  })

  test("with nobody signed in, there is no result to ask for", async () => {
    const { client: platform } = client()
    const error = (await caught(() =>
      platform.result("s-1"),
    )) as PlatformClientError
    expect(error.code).toBe("E_NOT_SIGNED_IN")
  })
})

describe("reads anyone may make", () => {
  test("the game, the board and a run read back, with the token when there is one", async () => {
    const anonymous = client()
    anonymous.page.answers.push({ status: 200, body: { day: "d" } })
    anonymous.page.answers.push({ status: 200, body: { rows: [] } })
    await anonymous.client.game()
    await anonymous.client.board()
    expect(anonymous.page.sent.map((s) => s.headers.authorization)).toEqual([
      undefined,
      undefined,
    ])

    const { page, client: platform } = await signedIn()
    page.answers.push({ status: 200, body: { rows: [] } })
    page.answers.push({ status: 200, body: { sessionId: "s-1" } })
    await platform.board({ period: "week", limit: 20, offset: 40 })
    await platform.watch("s-1")
    const [board, run] = page.sent.slice(-2)
    expect(board?.url.search).toBe("?period=week&limit=20&offset=40")
    expect(board?.headers.authorization).toBe("Bearer t-1")
    expect(run?.url.pathname).toBe("/v1/runs/s-1")
    expect(run?.headers.authorization).toBe("Bearer t-1")
  })
})
