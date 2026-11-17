/**
 * The step allowance at upload is what one step of an hour of a game's own
 * play may cost its replay. Rounded up, an hour of steps at 120 a second,
 * each at 695 microseconds, took 300.24 seconds of CPU, over the replay's
 * five minutes, so a game the checks passed could not replay an hour.
 */

import { describe, expect, test } from "bun:test"
import { TICK_RATES } from "@clockwork2/engine/manifest"
import {
  CHECK_STEP_BUDGET_US,
  REPLAY_CPU_BUDGET_MS,
} from "../../src/build/limits"

/** The microseconds of CPU an hour of steps at `rate` takes at `perStep`. */
function hourAt(rate: number, perStep: number): number {
  return 60 * 60 * rate * perStep
}

describe("the step allowance at each tick rate", () => {
  test("an hour of steps at the allowance fits one replay's CPU budget, and a microsecond more a step does not", () => {
    const budget = REPLAY_CPU_BUDGET_MS * 1000
    for (const rate of TICK_RATES) {
      const allowance = CHECK_STEP_BUDGET_US[rate]
      expect(`${rate}: ${hourAt(rate, allowance) <= budget}`).toBe(
        `${rate}: true`,
      )
      expect(`${rate}: ${hourAt(rate, allowance + 1) > budget}`).toBe(
        `${rate}: true`,
      )
    }
  })
})
