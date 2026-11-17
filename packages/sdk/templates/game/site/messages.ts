/**
 * What the page says to a player, for each state a run reaches.
 *
 * Plain functions over the client's own types, so a test holds every
 * sentence without a browser. Where the client or the platform has a
 * sentence of its own for a failure, that is the one shown: the page keeps
 * wording only for the few cases a player needs told differently.
 */

import type { RunResult } from "@vbz-gg/sdk/api"
import type { LocalEnd } from "@vbz-gg/sdk/host"
import { RUN_PHASE, type RunState } from "@vbz-gg/sdk/platform"

/** Shown when the day's ranked play is paused and practice is offered. */
export const RANKED_PAUSED = "Ranked play is paused; practice is open"

/** Shown when it is paused and there is no practice to offer instead. */
export const RANKED_PAUSED_ALONE = "Ranked play is paused"

export const SIGN_IN_FIRST = "Sign in to play"

/** Shown when the game has no ranked round today: nothing published yet. */
export const NO_ROUND_TODAY = "There is no ranked round today"

export interface MessageContext {
  /** Whether this game offers practice runs today. */
  readonly practiceOpen: boolean
  /** How a time is shown. The browser's own format by default. */
  readonly formatTime?: (time: Date) => string
}

export function pausedMessage(practiceOpen: boolean): string {
  return practiceOpen ? RANKED_PAUSED : RANKED_PAUSED_ALONE
}

/** When a bar on the player ends, or the platform's own sentence without one. */
export function barredMessage(
  until: unknown,
  fallback: string,
  formatTime: (time: Date) => string = (time) => time.toLocaleString(),
): string {
  const time = typeof until === "string" ? new Date(until) : null
  if (time === null || Number.isNaN(time.getTime())) return fallback
  return `You can play this game again from ${formatTime(time)}`
}

/** What a settled run's replay decided, said as a result. */
export function resultMessage(result: RunResult | null): string {
  const replay = result?.replay ?? null
  if (replay === null) {
    return "This run ended before any of it reached the platform"
  }
  if (replay.fault === "mismatch") {
    return "This run did not count: replaying it did not reach what the page showed"
  }
  if (replay.fault === "log_fault") {
    return "This run did not count: its inputs could not be replayed"
  }
  if (replay.fault === "platform_fault") {
    return "This run could not be checked, and does not count"
  }
  return scoredMessage(replay.counters ?? {})
}

/** What a local run's end says: its own counters, which nobody checked. */
export function endedMessage(ended: Pick<LocalEnd, "counters">): string {
  return scoredMessage(ended.counters)
}

/** A run's counters, as a sentence. */
function scoredMessage(scored: Readonly<Record<string, number>>): string {
  const counters = Object.entries(scored)
  if (counters.length === 0) return "Nothing to score in that run"
  return `You scored ${counters.map(([name, value]) => `${name} ${value}`).join(", ")}`
}

/** The sentence for a run's state, or the empty string for none. */
export function stateMessage(state: RunState, context: MessageContext): string {
  switch (state.phase) {
    case RUN_PHASE.LOADING:
      return "Starting"
    case RUN_PHASE.PLAYING:
      return ""
    case RUN_PHASE.SUBMITTING:
      return "Sending your run"
    case RUN_PHASE.REPLAYING:
      return "Checking your run"
    case RUN_PHASE.DONE:
      return resultMessage(state.result)
    default:
      return failureMessage(state, context)
  }
}

function failureMessage(state: RunState, context: MessageContext): string {
  const said = state.detail ?? "The run stopped"
  if (state.errorCode === "E_RANKED_PAUSED") {
    return pausedMessage(context.practiceOpen)
  }
  if (state.errorCode === "E_PLAYER_BARRED") {
    return barredMessage(state.refusalDetail?.until, said, context.formatTime)
  }
  if (
    state.errorCode === "E_NOT_SIGNED_IN" ||
    state.errorCode === "E_SIGN_IN_REQUIRED"
  ) {
    return SIGN_IN_FIRST
  }
  return said
}
