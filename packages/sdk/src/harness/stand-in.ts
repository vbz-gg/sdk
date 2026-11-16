/**
 * A stand-in for the platform's page routes and its sign-in window, so a
 * studio's page runs on a laptop before it ever meets the platform.
 *
 * It answers every route a game's page calls, with the shapes `/api`
 * declares, as one local player: sign-in through a window on an origin of
 * its own, a run started on the harness seed, chunks and a submit held to the
 * manifest the way the platform holds them, the result, a run read back to
 * watch, and the board. A page built against it is the page that runs in
 * production, through `@vbz-gg/sdk/platform` and `@vbz-gg/sdk/host`
 * unchanged.
 *
 * What it does not do is replay or rank. A run settles as soon as it is
 * submitted, with the counters its page sent, and the board holds the local
 * player's last ranked run of the day. The platform replays every run before
 * a number reaches its board; a page that showed the stand-in's counters as
 * verified would be showing an author a check that never ran, so each settle
 * is said in the terminal for what it is.
 */

import {
  checkInputSpan,
  checkInputs,
  decodeRecording,
  hashCanonical,
  type InputEvent,
  isClockworkError,
  type Manifest,
  type PlainValue,
} from "@clockwork2/engine"
import type {
  ApiErrorBody,
  Board,
  BoardPeriod,
  BoardRow,
  ChunkAccepted,
  PageGame,
  PageGameVersion,
  PageKey,
  PublicRefusalCode,
  RunChunk,
  RunLimits,
  RunMode,
  RunResult,
  SignedInPlayer,
  StartedRun,
  SubmittedRun,
  WatchedRun,
} from "../api/index.js"
import { sha256Hex } from "../build/digest.js"
import { parseReleaseVersion, releaseLine } from "../build/version.js"
import { escapeHtml } from "./page/document.js"
import { type Listen, originOf, serveOptions } from "./servers.js"

/** The page key the stand-in hands its page, and the only one it takes. */
export const STAND_IN_PAGE_KEY: PageKey = "vbz_pk_stand_in"

/** The one player the stand-in signs in. */
export const LOCAL_PLAYER: SignedInPlayer["player"] = {
  id: "00000000-0000-4000-8000-00000000000a",
  displayName: "Local player",
}

/** The version id the stand-in serves the game's one build under. */
export const STAND_IN_VERSION_ID = "00000000-0000-4000-8000-00000000000b"

/**
 * The byte caps the platform's plan gives a run: a chunk at 1 MiB, and a
 * run's chunks together, or its recording, at 29 MiB, which is the verifier's
 * 32 MiB less the largest rules code and a MiB of envelope. The platform is
 * the authority on both; these let a page meet the split and the stop here.
 */
export const STAND_IN_LIMITS: RunLimits = {
  chunkBytes: 1024 * 1024,
  runBytes: 29 * 1024 * 1024,
}

/** How long a token lasts, in seconds, as a page is told. */
const TOKEN_SECONDS = 3600

/**
 * The status each refusal arrives with. A page switches on the code, never
 * the status; what the status decides is whether a request is worth sending
 * again, and none of these is.
 */
const STATUS: Readonly<Partial<Record<PublicRefusalCode, number>>> = {
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
  E_CHUNK_NOT_FORWARD: 409,
  E_CHUNKS_INCOMPLETE: 409,
  E_BODY_TOO_LARGE: 413,
  E_RUN_TOO_LARGE: 413,
  E_INPUT_UNDECLARED: 422,
  E_INPUT_RANGE: 422,
  E_INPUT_BUDGET: 422,
  E_RECORDING_MALFORMED: 422,
}

/** The input refusals a server passes through by their own code. */
const INPUT_CODES: ReadonlySet<string> = new Set([
  "E_INPUT_UNDECLARED",
  "E_INPUT_RANGE",
  "E_INPUT_BUDGET",
])

class Refused extends Error {
  constructor(
    readonly code: PublicRefusalCode,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
  }
}

/** An engine refusal of a log, as the platform answers it. */
function inputRefusal(error: unknown): Refused {
  if (isClockworkError(error) && INPUT_CODES.has(error.code)) {
    return new Refused(error.code as PublicRefusalCode, error.message)
  }
  return new Refused(
    "E_RECORDING_MALFORMED",
    isClockworkError(error) ? error.message : String(error),
  )
}

export interface StandInOptions {
  /** The game's manifest, as `vbz build` wrote it. */
  readonly manifest: unknown
  /** The game's page module, absolute, on the bundles origin. */
  readonly presentUrl: string
  /** The game id the bundles origin serves it under. */
  readonly gameId: string
  /** The only origin the stand-in lets call it: the site's. */
  readonly siteOrigin: string
  /** The seed every run plays. */
  readonly seed: string
  readonly listen: Listen
  /** The API's and the sign-in window's ports. Any free one by default. */
  readonly apiPort?: number
  readonly signInPort?: number
  /** For a test: ranked play paused, or the player barred until a time. */
  readonly ranked?: "open" | "paused"
  readonly barredUntil?: string | null
  /** A line for the terminal: what the stand-in did that the platform would not. */
  readonly log?: (line: string) => void
  /** For a test: the clock. */
  readonly now?: () => Date
}

export interface RunningStandIn {
  readonly apiOrigin: string
  readonly signInOrigin: string
  readonly pageKey: PageKey
  stop(): Promise<void>
}

interface Session {
  readonly started: StartedRun
  readonly chunks: Map<
    number,
    { readonly body: string; readonly answer: ChunkAccepted }
  >
  committedBytes: number
  throughTick: number
  recording: { readonly text: string; readonly answer: SubmittedRun } | null
  settled: {
    readonly counters: Readonly<Record<string, number>>
    readonly endTick: number
    readonly inputs: readonly InputEvent[]
  } | null
}

interface Grant {
  readonly challenge: string
  used: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The base64url SHA-256 of a verifier, which its S256 challenge has to be. */
function challengeOf(verifier: string): string {
  return new Bun.CryptoHasher("sha256").update(verifier).digest("base64url")
}

/** The start of the UTC day `date` falls in, and of the next. */
function dayOf(date: Date): {
  readonly day: string
  readonly from: string
  readonly to: string
} {
  const day = date.toISOString().slice(0, 10)
  const start = new Date(`${day}T00:00:00.000Z`)
  const next = new Date(start.getTime() + 86_400_000)
  return { day, from: start.toISOString(), to: next.toISOString() }
}

/** Starts the stand-in's two origins: the API and the sign-in window. */
export function startStandIn(options: StandInOptions): RunningStandIn {
  const manifest = options.manifest as Manifest
  const now = options.now ?? (() => new Date())
  const log = options.log ?? (() => {})
  const version =
    typeof manifest.version === "string" ? manifest.version : "0.0.0"
  const manifestText = JSON.stringify(options.manifest)
  const pageVersion: PageGameVersion = {
    id: STAND_IN_VERSION_ID,
    version,
    manifest: options.manifest,
    manifestSha256: sha256Hex(new TextEncoder().encode(manifestText)),
    manifestHash: hashCanonical(options.manifest as PlainValue),
    presentUrl: options.presentUrl,
  }

  let token: string | null = null
  const grants = new Map<string, Grant>()
  const sessions = new Map<string, Session>()
  let boardRow: BoardRow | null = null

  // The sign-in window's origin is needed by the API's answers and the API's
  // by nothing the window serves, so the window is bound first.
  const signIn = Bun.serve({
    ...serveOptions(options.listen, options.signInPort ?? 0),
    fetch: (request) => authorize(request),
  })
  const signInOrigin = originOf(options.listen, signIn.port ?? 0)

  function authorize(request: Request): Response {
    const url = new URL(request.url)
    const page = (body: string, status = 200) =>
      new Response(body, {
        status,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      })
    if (url.pathname !== "/authorize") {
      return page(
        "<!doctype html><title>Not here</title><p>Nothing here.</p>",
        404,
      )
    }
    const query = url.searchParams
    const redirect = query.get("redirect_uri")
    const state = query.get("state")
    const challenge = query.get("code_challenge")
    // A request it cannot check hands nothing anywhere, as the platform's
    // window does not.
    const why =
      query.get("client_id") !== STAND_IN_PAGE_KEY
        ? "the page key is not the stand-in's"
        : redirect !== options.siteOrigin
          ? `the page asking is not ${options.siteOrigin}`
          : query.get("code_challenge_method") !== "S256" ||
              challenge === null ||
              challenge === ""
            ? "the request carries no S256 challenge"
            : state === null || state === ""
              ? "the request carries no state"
              : null
    if (
      why !== null ||
      redirect === null ||
      state === null ||
      challenge === null
    ) {
      return page(
        `<!doctype html><title>Sign-in refused</title><p>Refused: ${escapeHtml(why ?? "malformed")}.</p>`,
        400,
      )
    }
    const code = crypto.randomUUID()
    grants.set(code, { challenge, used: false })
    const hand = JSON.stringify({
      origin: redirect,
      message: { type: "vbz.signin", state, code },
    }).replaceAll("</", "<\\/")
    return page(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in</title>
  </head>
  <body style="font: 16px system-ui, sans-serif; padding: 24px">
    <p>The vbz platform's sign-in window, stood in for on this machine.</p>
    <button id="continue" type="button">Sign in as ${escapeHtml(LOCAL_PLAYER.displayName)}</button>
    <script type="application/json" id="hand">${hand}</script>
    <script>
      const hand = JSON.parse(document.getElementById("hand").textContent)
      document.getElementById("continue").addEventListener("click", () => {
        window.opener.postMessage(hand.message, hand.origin)
        window.close()
      })
    </script>
  </body>
</html>
`)
  }

  const api = Bun.serve({
    ...serveOptions(options.listen, options.apiPort ?? 0),
    fetch: (request) => answer(request),
  })
  const apiOrigin = originOf(options.listen, api.port ?? 0)

  function cors(request: Request): Record<string, string> {
    const origin = request.headers.get("origin")
    return {
      vary: "Origin, Authorization, x-vbz-key",
      "cache-control": "no-store",
      ...(origin === options.siteOrigin
        ? { "access-control-allow-origin": origin }
        : {}),
    }
  }

  async function answer(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors(request),
          "access-control-allow-methods": "GET, POST",
          "access-control-allow-headers":
            "authorization, content-type, x-vbz-key",
          "access-control-max-age": "600",
        },
      })
    }
    try {
      const body = await route(request, url)
      return Response.json(body, { headers: cors(request) })
    } catch (error) {
      const refused =
        error instanceof Refused
          ? error
          : new Refused("E_BAD_REQUEST", String(error))
      const body: ApiErrorBody = {
        error: refused.code,
        message: refused.message,
        ...(refused.detail === undefined ? {} : { detail: refused.detail }),
      }
      return Response.json(body, {
        status: STATUS[refused.code] ?? 400,
        headers: cors(request),
      })
    }
  }

  function pageKeyOf(request: Request): void {
    if (request.headers.get("origin") !== options.siteOrigin) {
      throw new Refused(
        "E_ORIGIN_NOT_ALLOWED",
        `the stand-in takes its page key from ${options.siteOrigin} alone`,
      )
    }
    if (request.headers.get("x-vbz-key") !== STAND_IN_PAGE_KEY) {
      throw new Refused("E_UNAUTHORIZED", "the page key is not the stand-in's")
    }
  }

  /** The bearer token, when the request carries the local player's. */
  function playerOf(request: Request): boolean {
    const header = request.headers.get("authorization")
    return token !== null && header === `Bearer ${token}`
  }

  function requirePlayer(request: Request): void {
    pageKeyOf(request)
    if (!playerOf(request)) {
      throw new Refused("E_SIGN_IN_REQUIRED", "sign the local player in first")
    }
  }

  async function bodyOf(request: Request, limit?: number): Promise<unknown> {
    const text = await request.text()
    if (
      limit !== undefined &&
      new TextEncoder().encode(text).byteLength > limit
    ) {
      throw new Refused("E_BODY_TOO_LARGE", `the body is over ${limit} bytes`)
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Refused("E_BAD_REQUEST", "the body is not JSON")
    }
  }

  function sessionOf(id: string): Session {
    const session = sessions.get(id)
    if (session === undefined) throw new Refused("E_NO_SESSION", "no such run")
    return session
  }

  async function route(request: Request, url: URL): Promise<unknown> {
    const path = url.pathname
    const key = `${request.method} ${path}`
    if (key === "GET /v1/game") {
      pageKeyOf(request)
      return game()
    }
    if (key === "POST /v1/oauth/token") return trade(await bodyOf(request))
    if (key === "POST /v1/runs") {
      requirePlayer(request)
      return start(await bodyOf(request))
    }
    if (key === "GET /v1/board") {
      pageKeyOf(request)
      return board(url, playerOf(request))
    }
    const run = /^\/v1\/runs\/([^/]+)(\/chunks|\/submit|\/result)?$/.exec(path)
    if (run !== null) {
      const id = decodeURIComponent(run[1] as string)
      const part = run[2] ?? ""
      if (request.method === "POST" && part === "/chunks") {
        requirePlayer(request)
        return chunk(
          sessionOf(id),
          await bodyOf(request, STAND_IN_LIMITS.chunkBytes),
        )
      }
      if (request.method === "POST" && part === "/submit") {
        requirePlayer(request)
        return submit(
          sessionOf(id),
          await bodyOf(request, STAND_IN_LIMITS.runBytes),
        )
      }
      if (request.method === "GET" && part === "/result") {
        requirePlayer(request)
        return result(sessionOf(id))
      }
      if (request.method === "GET" && part === "") {
        pageKeyOf(request)
        return watch(id, playerOf(request))
      }
    }
    throw new Refused("E_NOT_FOUND", `no route ${key}`)
  }

  function game(): PageGame {
    const paused = options.ranked === "paused"
    return {
      game: {
        id: options.gameId,
        slug: String(manifest.id),
        title:
          typeof manifest.name === "string"
            ? manifest.name
            : String(manifest.id),
        dailySeed: true,
        practice: true,
        rankedRunsPerDay: null,
      },
      studio: { slug: "local", name: "This machine" },
      day: dayOf(now()).day,
      today: {
        seedCommit: sha256Hex(new TextEncoder().encode(options.seed)),
        line: releaseLine(parseReleaseVersion(version)),
        ranked: paused ? "paused" : "open",
        version: paused ? null : pageVersion,
      },
      practiceVersion: pageVersion,
    }
  }

  function trade(body: unknown): SignedInPlayer {
    const refused = new Refused(
      "E_SIGNIN_GRANT_INVALID",
      "the code is not one this window handed this page, or was already traded",
    )
    if (!isRecord(body)) throw refused
    const grant =
      typeof body.code === "string" ? grants.get(body.code) : undefined
    if (
      grant === undefined ||
      grant.used ||
      body.clientId !== STAND_IN_PAGE_KEY ||
      typeof body.codeVerifier !== "string" ||
      challengeOf(body.codeVerifier) !== grant.challenge
    ) {
      throw refused
    }
    grant.used = true
    token ??= `stand-in-${crypto.randomUUID()}`
    return { token, expiresIn: TOKEN_SECONDS, player: LOCAL_PLAYER }
  }

  function start(body: unknown): StartedRun {
    const mode: RunMode =
      isRecord(body) && body.practice === true ? "practice" : "ranked"
    if (options.barredUntil !== undefined && options.barredUntil !== null) {
      throw new Refused(
        "E_PLAYER_BARRED",
        "the local player is barred from this game for now",
        { until: options.barredUntil },
      )
    }
    if (mode === "ranked" && options.ranked === "paused") {
      throw new Refused(
        "E_RANKED_PAUSED",
        "ranked play is paused today; practice is open",
      )
    }
    const today = dayOf(now()).day
    // A refresh before anything reached the server is the same run again.
    for (const session of sessions.values()) {
      const open = session.recording === null && session.settled === null
      if (
        open &&
        session.started.mode === mode &&
        session.started.day === today
      ) {
        if (session.chunks.size === 0) return session.started
        // One that committed a chunk is closed, as the platform closes it.
        session.settled = {
          counters: {},
          endTick: session.throughTick,
          inputs: [],
        }
      }
    }
    const started: StartedRun = {
      sessionId: crypto.randomUUID(),
      mode,
      day: today,
      rankedRunsLeft: null,
      seed: options.seed,
      config: {},
      game: {
        id: STAND_IN_VERSION_ID,
        presentUrl: options.presentUrl,
        manifestHash: pageVersion.manifestHash,
        manifest: options.manifest,
        tickHz: manifest.session.tickHz,
        maxTicks: manifest.session.maxTicks,
        maxWallSeconds: manifest.session.maxWallSeconds,
      },
      limits: STAND_IN_LIMITS,
      token: token as string,
      expiresIn: TOKEN_SECONDS,
    }
    sessions.set(started.sessionId, {
      started,
      chunks: new Map(),
      committedBytes: 0,
      throughTick: -1,
      recording: null,
      settled: null,
    })
    return started
  }

  function chunk(session: Session, body: unknown): ChunkAccepted {
    if (
      !isRecord(body) ||
      !Number.isSafeInteger(body.seq) ||
      !Number.isSafeInteger(body.throughTick) ||
      !Array.isArray(body.inputs) ||
      !Array.isArray(body.checkpoints)
    ) {
      throw new Refused(
        "E_BAD_REQUEST",
        "a chunk is a seq, a throughTick, checkpoints and inputs",
      )
    }
    const sent = body as unknown as RunChunk
    const text = JSON.stringify(body)
    const earlier = session.chunks.get(sent.seq)
    if (earlier !== undefined) {
      if (earlier.body === text) return earlier.answer
      throw new Refused(
        "E_CHUNK_CONFLICT",
        `chunk ${sent.seq} was sent before with another body`,
      )
    }
    if (session.recording !== null || session.settled !== null) {
      throw new Refused("E_SESSION_CLOSED", "the run is closed")
    }
    const highest = Math.max(-1, ...session.chunks.keys())
    if (sent.seq <= highest || sent.throughTick <= session.throughTick) {
      throw new Refused(
        "E_CHUNK_NOT_FORWARD",
        "a chunk reaches back past one already taken",
      )
    }
    // A tick an earlier chunk reached is committed, checkpoint and all, so a
    // checkpoint there is a rewrite, as the platform refuses it.
    for (const checkpoint of sent.checkpoints) {
      if (checkpoint.tick <= session.throughTick) {
        throw new Refused(
          "E_CHUNK_NOT_FORWARD",
          `chunk ${sent.seq} carries a checkpoint at tick ${checkpoint.tick}, which an earlier chunk already committed`,
        )
      }
    }
    try {
      checkInputSpan(sent.inputs as readonly InputEvent[], manifest.inputs, {
        afterTick: session.throughTick,
        throughTick: sent.throughTick,
      })
    } catch (error) {
      throw inputRefusal(error)
    }
    const bytes = new TextEncoder().encode(text).byteLength
    if (session.committedBytes + bytes > STAND_IN_LIMITS.runBytes) {
      throw new Refused(
        "E_RUN_TOO_LARGE",
        "the run's chunks would be over its limit",
      )
    }
    const accepted: ChunkAccepted = {
      seq: sent.seq,
      throughTick: sent.throughTick,
    }
    session.chunks.set(sent.seq, { body: text, answer: accepted })
    session.committedBytes += bytes
    session.throughTick = sent.throughTick
    return accepted
  }

  function submit(session: Session, body: unknown): SubmittedRun {
    const raw = isRecord(body) ? body.recording : undefined
    const text = JSON.stringify(raw)
    if (session.recording !== null) {
      if (session.recording.text === text) return session.recording.answer
      throw new Refused(
        "E_SESSION_CLOSED",
        "the run was submitted with another recording",
      )
    }
    if (session.settled !== null)
      throw new Refused("E_SESSION_CLOSED", "the run is closed")
    let recording: ReturnType<typeof decodeRecording>
    try {
      recording = decodeRecording(raw)
      checkInputs(recording.inputs, manifest.inputs, {
        endTick: recording.endTick,
      })
    } catch (error) {
      throw inputRefusal(error)
    }
    if (session.chunks.size > 0 && session.throughTick < recording.endTick) {
      throw new Refused(
        "E_CHUNKS_INCOMPLETE",
        "the run's chunks stop short of its end",
      )
    }
    const answer: SubmittedRun = {
      sessionId: session.started.sessionId,
      recordingSha256: sha256Hex(new TextEncoder().encode(text)),
    }
    session.recording = { text, answer }
    session.settled = {
      counters: { ...recording.counters },
      endTick: recording.endTick,
      inputs: recording.inputs,
    }
    if (session.started.mode === "ranked") {
      boardRow = {
        rank: 1,
        playerId: LOCAL_PLAYER.id,
        displayName: LOCAL_PLAYER.displayName,
        counters: { ...recording.counters },
        day: session.started.day,
        sessionId: session.started.sessionId,
        version,
      }
    }
    log(
      `stand-in: ${session.started.mode} run ${session.started.sessionId} settled with the counters its page sent, unreplayed; the platform replays a run before it counts`,
    )
    return answer
  }

  function result(session: Session): RunResult {
    const { started, settled } = session
    return {
      sessionId: started.sessionId,
      mode: started.mode,
      day: started.day,
      state:
        settled === null
          ? "open"
          : session.recording === null
            ? "expired"
            : "settled",
      committed: session.chunks.size > 0,
      replay:
        settled === null || session.recording === null
          ? null
          : {
              fault: null,
              code: null,
              counters: settled.counters,
              endTick: settled.endTick,
            },
    }
  }

  /**
   * A settled run, to watch. Watching replays the log, which needs the seed,
   * and the day's seed is everybody's that day, so a run from a day still
   * open is its own player's alone; to anybody else it is a run that does
   * not exist, as the platform answers it.
   */
  function watch(id: string, asPlayer: boolean): WatchedRun {
    const session = sessions.get(id)
    const dayOpen =
      session !== undefined && session.started.day >= dayOf(now()).day
    if (
      session === undefined ||
      session.recording === null ||
      session.settled === null ||
      (dayOpen && !asPlayer)
    ) {
      throw new Refused("E_NO_SESSION", "no settled run by that id")
    }
    const { started, settled } = session
    return {
      sessionId: started.sessionId,
      gameSlug: String(manifest.id),
      gameTitle:
        typeof manifest.name === "string" ? manifest.name : String(manifest.id),
      gameVersionId: STAND_IN_VERSION_ID,
      day: started.day,
      counters: settled.counters,
      endTick: settled.endTick,
      tickHz: started.game.tickHz,
      maxTicks: started.game.maxTicks,
      seed: started.seed,
      config: started.config,
      inputs: settled.inputs,
      presentUrl: started.game.presentUrl,
      manifestHash: started.game.manifestHash,
      replayTicks:
        settled.endTick === 0
          ? null
          : Math.min(Math.max(settled.endTick, 1), started.game.maxTicks),
    }
  }

  function board(url: URL, asPlayer: boolean): Board {
    const asked = url.searchParams.get("period")
    const period: BoardPeriod =
      asked === "week" || asked === "all" ? asked : "day"
    const { day, from, to } = dayOf(now())
    const row = period === "day" && boardRow?.day !== day ? null : boardRow
    return {
      gameId: options.gameId,
      period,
      from:
        period === "all"
          ? null
          : period === "week"
            ? new Date(new Date(from).getTime() - 6 * 86_400_000).toISOString()
            : from,
      to,
      total: row === null ? 0 : 1,
      rows: row === null ? [] : [row],
      you: asPlayer ? row : null,
      rankBy: manifest.rankBy,
      tiePolicy: manifest.tiePolicy,
    }
  }

  return {
    apiOrigin,
    signInOrigin,
    pageKey: STAND_IN_PAGE_KEY,
    stop: async () => {
      await Promise.all([api.stop(true), signIn.stop(true)])
    },
  }
}
