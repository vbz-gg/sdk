/**
 * A game page's client for the vbz.gg platform.
 *
 * It holds the protocol `docs/your-game-page.md` in the platform describes:
 * the page key on every request, the sign-in box and the code trade, the
 * player's token kept and renewed, and the run routes. Every request goes
 * through `request`, which is keyed by `PlatformRoutes`, so this file cannot
 * call a route the platform does not declare.
 */

import type { Recording } from "@clockwork2/engine"
import type {
  Board,
  BoardPeriod,
  ChunkAccepted,
  PageGame,
  PageKey,
  RunChunk,
  RunResult,
  SignedInPlayer,
  StartedRun,
  StartRunRequest,
  SubmittedRun,
  WatchedRun,
} from "../api/index.js"
import { browserEnvironment, type PageEnvironment } from "./environment.js"
import {
  PlatformClientError,
  PlatformRefusal,
  worthRetrying,
} from "./errors.js"
import {
  type KeptPlayer,
  keptPlayerKey,
  type PlayerStore,
  storagePlayerStore,
} from "./kept.js"
import { createRequester, type Requester } from "./request.js"
import { openSignIn, SIGN_IN_READY_MS } from "./signin.js"

/**
 * A platform run's recording, as `Run` hands it to `submit`. The brand
 * exists at compile time alone, so a recording from anywhere else, a local
 * run's included, is not one `submit` takes without a cast somebody wrote.
 * `request` stays open to every page route, so nothing at run time stops a
 * page; the platform's own checks on a submit do that. The brand is a named
 * property rather than a symbol, so two copies of this package, built apart,
 * agree on it.
 */
export type RunRecording = Recording & { readonly "vbz:run-recording": true }

export interface PlatformClientOptions {
  /** Where the platform's API answers: `https://api.vbz.gg`. */
  readonly apiOrigin: string
  /** Where the platform's sign-in is: `https://signin.vbz.gg`. */
  readonly signInOrigin: string
  /** The game's page key, from the dashboard. */
  readonly pageKey: PageKey
  /** Where the signed-in player is kept. `localStorage` by default. */
  readonly store?: PlayerStore
  /**
   * Told when the platform says the player's token stopped working. Every
   * change of player, this one included, also reaches `onPlayerChange`.
   */
  readonly onSignedOut?: () => void
  /** The browser, or a test's stand-in for it. */
  readonly environment?: PageEnvironment
  /**
   * How long, in milliseconds, each page of the sign-in has to say it
   * loaded in its box before `signIn()` gives up with
   * `E_SIGNIN_UNREACHABLE`: `SIGN_IN_READY_MS`, 15 seconds, by default. A
   * whole number above zero.
   */
  readonly signInReadyMs?: number
}

export interface BoardOptions {
  readonly period?: BoardPeriod
  readonly limit?: number
  readonly offset?: number
}

export interface ResultOptions {
  readonly signal?: AbortSignal
  /** How long to wait between asks. */
  readonly intervalMs?: number
  /**
   * The token to ask with: a run's own, from its start. The kept player's by
   * default, which may since have signed out or been replaced.
   */
  readonly token?: string
}

/** How long `awaitResult` waits between asks by default. */
export const RESULT_INTERVAL_MS = 2_000

export interface PlatformClient {
  /** The game's page key, which every request carries. */
  readonly pageKey: PageKey
  /** Every page route, typed by `PlatformRoutes`. The methods below use it. */
  readonly request: Requester
  /** The game the page key names, and today's round. */
  game(): Promise<PageGame>
  /** The signed-in player, or null. */
  player(): SignedInPlayer["player"] | null
  /**
   * Calls `listener` with the player each time the client's player changes:
   * a sign-in, a sign-out, a token the platform stopped honouring, or one
   * found expired. A renewed token for the same player is no change. It is
   * called synchronously, inside the call that found the change, and never
   * for the player there already was when it subscribed, which `player()`
   * answers. Returns a function that stops it.
   */
  onPlayerChange(
    listener: (player: SignedInPlayer["player"] | null) => void,
  ): () => void
  /**
   * Puts the sign-in's box over the page, and answers the player once they
   * signed in and the code was traded. Call it from a click, before
   * anything is awaited, so focus moves into the box from the click. While
   * one is open, another call answers the same promise and opens nothing.
   * Rejects with `E_SIGNIN_CANCELLED` when the box is closed, and
   * `E_SIGNIN_UNREACHABLE` when the sign-in does not load in it.
   */
  signIn(): Promise<SignedInPlayer["player"]>
  /**
   * Ends the sign-in open on the page, if there is one: its box comes down
   * and its `signIn()` rejects with `E_SIGNIN_CANCELLED`, also once the
   * player has signed in and the code is being traded, whose answer is then
   * kept for nobody. Nothing otherwise.
   */
  closeSignIn(): void
  /** Forgets the player on this page. No route signs a player out. */
  signOut(): void
  /** Starts a run, or finds again one that has sent nothing yet. */
  startRun(request?: StartRunRequest): Promise<StartedRun>
  sendChunk(run: StartedRun, chunk: RunChunk): Promise<ChunkAccepted>
  /** A run's recording, as `Run` hands it over: never a local run's. */
  submit(run: StartedRun, recording: RunRecording): Promise<SubmittedRun>
  /** The player's own run and what its replay decided, now. */
  result(
    sessionId: string,
    options?: Pick<ResultOptions, "token">,
  ): Promise<RunResult>
  /** Asks until the run's result is final. */
  awaitResult(sessionId: string, options?: ResultOptions): Promise<RunResult>
  board(options?: BoardOptions): Promise<Board>
  /** A settled run, with what its page module needs to play it back. */
  watch(sessionId: string): Promise<WatchedRun>
}

/**
 * Whether a run's result will not change again: its replay has run, or it
 * expired having sent nothing, which is never replayed.
 */
export function isFinalResult(result: RunResult): boolean {
  return (
    result.replay !== null || (result.state === "expired" && !result.committed)
  )
}

export function createPlatformClient(
  options: PlatformClientOptions,
): PlatformClient {
  const readyMs = options.signInReadyMs ?? SIGN_IN_READY_MS
  if (!Number.isInteger(readyMs) || readyMs <= 0) {
    throw new Error(
      `signInReadyMs is how long, in milliseconds, a page of the sign-in has to say it is ready, a whole number above zero, and ${String(readyMs)} is not one`,
    )
  }
  const environment = options.environment ?? browserEnvironment()
  const store =
    options.store ??
    storagePlayerStore({
      key: keptPlayerKey(options.pageKey),
      storage: () => environment.storage(),
      now: () => environment.now(),
    })
  const request = createRequester({
    apiOrigin: options.apiOrigin,
    pageKey: options.pageKey,
    fetch: environment.fetch,
  })

  // Every read and write of the kept player goes through `kept`, `keep` and
  // `forget`, which compare the player with the one last seen and tell the
  // listeners when it moved, so a widget drawn from `player()` follows a
  // change it did not make itself.
  const listeners = new Set<(player: Player) => void>()
  let seen: Player = store.read()?.player ?? null

  const noticed = (player: Player) => {
    if (samePlayer(seen, player)) return
    seen = player
    for (const listener of [...listeners]) listener(player)
  }

  const kept = (): KeptPlayer | null => {
    const found = store.read()
    noticed(found?.player ?? null)
    return found
  }

  const keep = (
    token: string,
    expiresIn: number,
    player: SignedInPlayer["player"],
  ) => {
    store.write({
      token,
      expiresAt: environment.now() + expiresIn * 1000,
      player,
    })
    noticed(player)
  }

  const forget = () => {
    store.clear()
    noticed(null)
  }

  const keptOrThrow = () => {
    const found = kept()
    if (found === null) throw new PlatformClientError("E_NOT_SIGNED_IN")
    return found
  }

  /**
   * A player route. A token the platform stopped honouring forgets the
   * player, but only while it is still the kept one: an older run's token
   * refused after the player signed in again says nothing about the new one.
   */
  const asPlayer = async <T>(
    token: string,
    call: (token: string) => Promise<T>,
  ): Promise<T> => {
    try {
      return await call(token)
    } catch (error) {
      if (
        error instanceof PlatformRefusal &&
        error.code === "E_SIGN_IN_REQUIRED" &&
        kept()?.token === token
      ) {
        forget()
        options.onSignedOut?.()
      }
      throw error
    }
  }

  /** The sign-in open over the page, until its promise settles. */
  let signingIn: {
    readonly player: Promise<SignedInPlayer["player"]>
    readonly close: () => void
  } | null = null

  const result = (
    sessionId: string,
    resultOptions: Pick<ResultOptions, "token"> = {},
  ) =>
    asPlayer(resultOptions.token ?? keptOrThrow().token, (token) =>
      request("GET /v1/runs/:id/result", {
        params: { id: sessionId },
        token,
      }),
    )

  return {
    pageKey: options.pageKey,
    request,

    game: () => request("GET /v1/game", {}),

    player: () => kept()?.player ?? null,

    onPlayerChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    signIn() {
      if (signingIn !== null) return signingIn.player
      // The box is on the page when this returns.
      const asked = openSignIn({
        environment,
        signInOrigin: options.signInOrigin,
        pageKey: options.pageKey,
        readyMs,
      })
      // Closed by the page while the code is traded: what the trade
      // answers is nobody's, and the sign-in ends now rather than then.
      let trading = false
      let abandoned = false
      let abandon: (error: unknown) => void = () => {}
      const closed = new Promise<never>((_, reject) => {
        abandon = reject
      })
      const traded = asked.grant.then(async (grant) => {
        trading = true
        const signedIn = await request("POST /v1/oauth/token", {
          body: {
            code: grant.code,
            codeVerifier: grant.verifier,
            clientId: options.pageKey,
          },
        })
        if (abandoned) throw new PlatformClientError("E_SIGNIN_CANCELLED")
        keep(signedIn.token, signedIn.expiresIn, signedIn.player)
        return signedIn.player
      })
      const player = Promise.race([traded, closed])
      const open = {
        player,
        close: () => {
          abandoned = true
          // Before the code arrived the box is what there is to close, and
          // its own rejection, or the failure already on its way, is the
          // sign-in's answer.
          asked.cancel()
          if (trading) abandon(new PlatformClientError("E_SIGNIN_CANCELLED"))
        },
      }
      signingIn = open
      const done = () => {
        if (signingIn === open) signingIn = null
      }
      player.then(done, done)
      return player
    },

    closeSignIn() {
      signingIn?.close()
    },

    signOut: forget,

    async startRun(body = {}) {
      const kept = keptOrThrow()
      const started = await asPlayer(kept.token, (token) =>
        request("POST /v1/runs", { body, token }),
      )
      // Every start renews the token; the renewed one is the one to keep.
      keep(started.token, started.expiresIn, kept.player)
      return started
    },

    sendChunk: (run, chunk) =>
      asPlayer(run.token, (token) =>
        request("POST /v1/runs/:id/chunks", {
          params: { id: run.sessionId },
          body: chunk,
          token,
        }),
      ),

    submit: (run, recording) =>
      asPlayer(run.token, (token) =>
        request("POST /v1/runs/:id/submit", {
          params: { id: run.sessionId },
          body: { recording },
          token,
        }),
      ),

    result,

    async awaitResult(sessionId, waitOptions = {}) {
      const interval = waitOptions.intervalMs ?? RESULT_INTERVAL_MS
      for (;;) {
        waitOptions.signal?.throwIfAborted()
        try {
          const answer = await result(
            sessionId,
            waitOptions.token === undefined ? {} : { token: waitOptions.token },
          )
          if (isFinalResult(answer)) return answer
        } catch (error) {
          if (!worthRetrying(error)) throw error
        }
        await pause(environment, interval, waitOptions.signal)
      }
    },

    board: (boardOptions = {}) =>
      request("GET /v1/board", {
        query: {
          period: boardOptions.period,
          limit: boardOptions.limit,
          offset: boardOptions.offset,
        },
        // A token that stopped working reads the board as nobody, unrefused.
        token: kept()?.token,
      }),

    watch: (sessionId) =>
      request("GET /v1/runs/:id", {
        params: { id: sessionId },
        token: kept()?.token,
      }),
  }
}

/** A player signed in on the page, or nobody. */
type Player = SignedInPlayer["player"] | null

/** The same player under the same name, or nobody both times. */
function samePlayer(a: Player, b: Player): boolean {
  if (a === null || b === null) return a === b
  return a.id === b.id && a.displayName === b.displayName
}

function pause(
  environment: PageEnvironment,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      environment.clearTimeout(handle)
      reject(signal?.reason)
    }
    const handle = environment.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
