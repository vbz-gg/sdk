/**
 * Driving one run: the game's page module plays it, this commits it as it
 * goes, submits the recording at the end, and waits for the replay's answer.
 *
 * The page module is reached through `mount`, which `playRun` in `/host`
 * points at the module's own `mount`. So this file holds no engine and no
 * DOM, and a test drives it with a mount that reports what a real one would.
 *
 * What it holds:
 *
 * - **The module plays the game the run was issued for.** The mount is told
 *   the run's manifest hash and refuses before a tick runs if it is not its
 *   own.
 * - **Chunks do not overlap, and each ends at the last complete tick**
 *   (`throughTickFor`). One goes every `CHUNK_SECONDS` of play and one more
 *   when the run ends. A chunk over the run's `chunkBytes` is cut between
 *   ticks (`splitChunk`). They are sent one at a time, in order; one that got
 *   no answer goes again, unchanged, before the next; and after a refusal
 *   nothing more is sent.
 * - **A run stops before it outgrows what the platform takes.** Once what it
 *   committed is within one chunk of `runBytes`, it ends the way a player
 *   leaving ends it, and is submitted.
 * - **The last chunk reaches the platform before the recording.** A submit
 *   whose chunks stop short of the run's end is refused.
 * - **A submit that got no answer goes again.** The same recording answers
 *   the same, so a retry cannot score a run twice.
 * - **Nothing here reads a score.** The counters go into a chunk as evidence.
 *   The result's counters are what the replay computed.
 */

import type { RunChunk, RunResult, StartedRun } from "../api/index.js"
import type {
  MountError,
  MountedEnd,
  MountHandle,
  MountHandlers,
  MountOptions,
} from "../game/contract.js"
import {
  byteLengthOf,
  type ChunkBody,
  splitChunk,
  throughTickFor,
} from "./chunks.js"
import type { PlatformClient } from "./client.js"
import {
  type ClientErrorCode,
  PlatformClientError,
  PlatformRefusal,
  worthRetrying,
} from "./errors.js"

export const RUN_PHASE = {
  /** The run is being started, and its game's code loaded. */
  LOADING: "loading",
  PLAYING: "playing",
  /** The run ended, and its recording is going to the platform. */
  SUBMITTING: "submitting",
  /** The platform took the recording, and a server is replaying it. */
  REPLAYING: "replaying",
  /** The result is final: `result` says what the replay decided. */
  DONE: "done",
  FAILED: "failed",
} as const

export type RunPhase = (typeof RUN_PHASE)[keyof typeof RUN_PHASE]

export interface RunState {
  readonly phase: RunPhase
  /**
   * Why it failed: a `PlatformRefusal`'s, a `PlatformClientError`'s, or the
   * engine's own code from the game.
   */
  readonly errorCode: string | null
  /** For a failure, what the game or the platform said about it. */
  readonly detail: string | null
  /** Once the phase is `done`. */
  readonly result: RunResult | null
}

/**
 * What the run asks of the game: plays it with these options, which carry
 * the handlers the run listens with. `playRun` binds it to the page module's
 * own `mount` and the element the game is drawn in.
 */
export type MountRun = (options: MountOptions) => MountHandle

export interface RunOptions {
  readonly client: Pick<PlatformClient, "sendChunk" | "submit" | "awaitResult">
  readonly onState?: (state: RunState) => void
  /** Told about a device the player should hear about, which stops nothing. */
  readonly onNotice?: MountHandlers["onNotice"]
  /** How many times a submit is sent before the run fails. */
  readonly submitAttempts?: number
  /** The wait before the first resend of a submit, doubled each time after. */
  readonly retryDelayMs?: number
  /** Seconds of play between two chunks. */
  readonly chunkSeconds?: number
}

export const SUBMIT_ATTEMPTS = 5
export const SUBMIT_RETRY_MS = 1_000

/**
 * Seconds of play between two chunks. What a chunk is for is a run whose tab
 * closed: the platform settles it from what it committed, so this is how
 * much play a crash can lose.
 */
export const CHUNK_SECONDS = 2

export class Run {
  private readonly options: RunOptions
  private readonly abort = new AbortController()
  private state: RunState = {
    phase: RUN_PHASE.LOADING,
    errorCode: null,
    detail: null,
    result: null,
  }

  private run: StartedRun | null = null
  private handle: MountHandle | null = null

  /** Arrived from the game and not yet in a chunk. */
  private checkpoints: Array<{ tick: number; hash: string }> = []
  private counters: Record<string, number> = {}
  private tick = 0
  private ended = false
  /** How many of the recorded inputs a chunk has carried. */
  private inputsSent = 0
  /** Ticks of play between two chunks, at the run's own rate. */
  private chunkTicks = 0
  private committedAtTick = 0
  private committedBytes = 0

  private seq = 0
  private postedThrough = -1
  /** Chunks that got no answer, oldest first, sent again before the next. */
  private unsent: RunChunk[] = []
  /** Sends in order: two chunks in flight could arrive out of sequence. */
  private posting: Promise<unknown> = Promise.resolve()

  constructor(options: RunOptions) {
    this.options = options
  }

  get current(): RunState {
    return this.state
  }

  /** The run as the platform started it, once it has. */
  get started(): StartedRun | null {
    return this.run
  }

  /**
   * Plays `run` through `mount`. Called once, while the run is loading; a
   * second call, or one after the run failed, does nothing.
   */
  play(run: StartedRun, mount: MountRun): void {
    if (this.abort.signal.aborted || this.run !== null) return
    this.run = run
    this.chunkTicks =
      (this.options.chunkSeconds ?? CHUNK_SECONDS) * run.game.tickHz
    this.move(RUN_PHASE.PLAYING)
    let handle: MountHandle
    try {
      handle = this.mountWith(run, mount)
    } catch (error) {
      // A module that throws rather than reporting is not one this release
      // built, and the run ends where the page can see it.
      this.failWith(error)
      return
    }
    // A mount the game refused has already failed the run, and its handle
    // holds nothing to keep.
    if (!this.abort.signal.aborted) this.handle = handle
  }

  private mountWith(run: StartedRun, mount: MountRun): MountHandle {
    return mount({
      mode: "play",
      seed: run.seed,
      config: run.config,
      tickHz: run.game.tickHz,
      maxTicks: run.game.maxTicks,
      expect: { manifestHash: run.game.manifestHash },
      handlers: {
        onCheckpoint: (checkpoint) => {
          if (this.abort.signal.aborted) return
          this.checkpoints.push({
            tick: checkpoint.tick,
            hash: checkpoint.hash,
          })
        },
        onFrame: (frame) => {
          if (this.abort.signal.aborted) return
          this.tick = Math.max(this.tick, frame.tick)
          this.counters = { ...frame.counters }
          if (this.tick - this.committedAtTick >= this.chunkTicks) {
            this.commit()
          }
        },
        onEnded: (ended) => this.onEnded(ended),
        onError: (error) => this.onError(error),
        ...(this.options.onNotice === undefined
          ? {}
          : { onNotice: this.options.onNotice }),
      },
    })
  }

  /**
   * Ends a run that has not started playing, with the reason: the start
   * refused, the game's code not loaded, or a tap that has to come again.
   */
  refuse(error: unknown): void {
    if (this.state.phase !== RUN_PHASE.LOADING) return
    this.failWith(error)
  }

  private onEnded(ended: MountedEnd): void {
    if (this.abort.signal.aborted || this.ended) return
    this.tick = Math.max(this.tick, ended.tick)
    this.counters = { ...ended.counters }
    this.ended = true
    this.commit()
    this.move(RUN_PHASE.SUBMITTING)
    // After the chunks, so the last chunk reaches the platform first.
    const recording = ended.recording
    this.posting = this.posting.then(() => this.submit(recording))
  }

  private onError(error: MountError): void {
    this.fail(error.code, error.message)
  }

  /** Sends what is complete since the last chunk, if anything is. */
  private commit(): void {
    const run = this.run
    if (run === null) return
    const log = this.handle?.recorded() ?? []
    const inputs = log.slice(this.inputsSent)
    this.committedAtTick = this.tick
    if (this.checkpoints.length === 0 && inputs.length === 0 && !this.ended) {
      return
    }
    const throughTick = throughTickFor({
      tick: this.tick,
      inputTicks: inputs.map((input) => input.tick),
      ended: this.ended,
      postedThrough: this.postedThrough,
    })
    // Nothing new is complete: keep what arrived for the next chunk.
    if (throughTick === null) return

    const body: ChunkBody = {
      throughTick,
      checkpoints: this.checkpoints,
      inputs,
      counters: this.counters,
    }
    this.inputsSent = log.length
    this.postedThrough = throughTick
    this.checkpoints = []
    for (const piece of splitChunk(body, run.limits.chunkBytes)) {
      const chunk: RunChunk = { seq: this.seq, ...piece }
      this.seq += 1
      this.committedBytes += byteLengthOf(chunk)
      this.posting = this.posting.then(() => this.send(chunk))
    }
    // One more chunk's room is what the tail and the recording's own
    // envelope need, so the run stops there, as a player leaving it.
    if (
      !this.ended &&
      this.committedBytes + run.limits.chunkBytes >= run.limits.runBytes
    ) {
      this.handle?.stop("abandoned")
    }
  }

  /** Sends the chunks that got no answer, then this one, in order. */
  private async send(chunk?: RunChunk): Promise<void> {
    const run = this.run
    if (run === null) return
    const queue = chunk === undefined ? this.unsent : [...this.unsent, chunk]
    this.unsent = []
    for (const [index, body] of queue.entries()) {
      if (this.abort.signal.aborted) return
      try {
        await this.options.client.sendChunk(run, body)
      } catch (error) {
        if (worthRetrying(error)) {
          // Keep it, and everything after it, for the next send.
          this.unsent = queue.slice(index)
          return
        }
        // A refusal is the platform's answer to this body, and a later chunk
        // would build on one it did not take, so nothing more is sent.
        this.failWith(error)
        return
      }
    }
  }

  private async submit(recording: unknown): Promise<void> {
    const run = this.run
    if (run === null) return
    const attempts = this.options.submitAttempts ?? SUBMIT_ATTEMPTS
    let delay = this.options.retryDelayMs ?? SUBMIT_RETRY_MS
    for (let attempt = 1; ; attempt += 1) {
      if (this.abort.signal.aborted) return
      let failure: unknown
      // A chunk that got no answer has to arrive before the recording: one
      // still unsent is this attempt's failure, and nothing is submitted.
      if (this.unsent.length > 0) await this.send()
      if (this.abort.signal.aborted) return
      if (this.unsent.length > 0) {
        failure = new PlatformClientError("E_UNREACHABLE")
      } else {
        try {
          await this.options.client.submit(run, recording)
          break
        } catch (error) {
          failure = error
        }
      }
      if (!worthRetrying(failure) || attempt >= attempts) {
        this.failWith(failure)
        return
      }
      await this.wait(delay)
      delay *= 2
    }

    this.move(RUN_PHASE.REPLAYING)
    try {
      const result = await this.options.client.awaitResult(
        run.sessionId,
        // The run's own token: the page may have signed out, or somebody
        // else in, since the run started.
        { signal: this.abort.signal, token: run.token },
      )
      this.settle(result)
    } catch (error) {
      if (this.abort.signal.aborted) return
      this.failWith(error)
    }
  }

  /** The pause before a resend, cut short when the run is stopped. */
  private wait(ms: number): Promise<void> {
    const signal = this.abort.signal
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      signal.addEventListener("abort", done, { once: true })
    })
  }

  /**
   * The player leaving. The run ends where they left it and is submitted as
   * abandoned. Before it plays, there is nothing to submit, so it stops.
   */
  end(): void {
    if (this.handle === null) {
      if (this.state.phase === RUN_PHASE.LOADING) this.destroy()
      return
    }
    this.handle.stop("abandoned")
  }

  /** Stops everything: the game, and any request still to be sent. */
  destroy(): void {
    this.abort.abort()
    this.handle?.destroy()
  }

  private move(phase: RunPhase): void {
    if (this.abort.signal.aborted) return
    this.state = { phase, errorCode: null, detail: null, result: null }
    this.options.onState?.(this.state)
  }

  private settle(result: RunResult): void {
    if (this.abort.signal.aborted) return
    this.state = {
      phase: RUN_PHASE.DONE,
      errorCode: null,
      detail: null,
      result,
    }
    this.options.onState?.(this.state)
  }

  /**
   * Final: nothing is sent after a failure and the state never leaves it,
   * so a page shown a failure is never shown a result after it. A game still
   * playing is stopped where it stands, so nobody plays on into a run that
   * can no longer count; what it drew stays, for the page to take down.
   */
  private fail(code: ClientErrorCode | string, detail: string | null): void {
    if (this.abort.signal.aborted) return
    this.state = {
      phase: RUN_PHASE.FAILED,
      errorCode: code,
      detail,
      result: null,
    }
    this.abort.abort()
    this.handle?.stop("abandoned")
    this.options.onState?.(this.state)
  }

  /**
   * A refusal or a client error fails the run with its own code. Anything
   * else is a bug, and it still ends the run where the page can see it,
   * rather than leaving it waiting forever behind a rejection nobody holds.
   */
  private failWith(error: unknown): void {
    if (error instanceof PlatformRefusal) {
      this.fail(error.code, error.message)
      return
    }
    if (error instanceof PlatformClientError) {
      this.fail(
        error.code,
        error.cause === undefined
          ? error.message
          : `${error.message}: ${causeOf(error.cause)}`,
      )
      return
    }
    this.fail("E_UNEXPECTED", String(error))
  }
}

function causeOf(cause: unknown): string {
  if (cause instanceof Error) return String(cause)
  return typeof cause === "string" ? cause : JSON.stringify(cause)
}
