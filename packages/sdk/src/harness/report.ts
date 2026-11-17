/**
 * The harness page's sentences about a run's report.
 *
 * Kept out of the page's own script, which the coverage floor does not
 * measure, so what an author is told about a replay is held by a test.
 * Types and plain functions only: the page bundles this for the browser.
 */

import type { DevReport } from "./replay.js"

function count(value: number): string {
  return value.toLocaleString("en")
}

function counters(values: Readonly<Record<string, number>>): string {
  const listed = Object.entries(values).map(
    ([name, value]) => `${name} ${value}`,
  )
  return listed.length === 0 ? "" : ` with ${listed.join(", ")}`
}

/**
 * Whether the inputs' only problem is the budget, which binds a ranked or
 * practice run and not a game played on its own page.
 */
function overBudgetOnly(report: DevReport): boolean {
  return report.inputs.problem?.code === "E_INPUT_BUDGET"
}

/**
 * One sentence about the replay, one about the inputs, one about the size.
 * The input budget is a ranked or practice run's, so it is said as theirs,
 * and held to only when the run is `ranked`.
 */
export function reportLines(report: DevReport, ranked: boolean): string[] {
  const { replay, inputs } = report
  const replayed =
    replay.kind === "matches"
      ? `replayed: it matches, ending at tick ${count(replay.endTick)}${counters(replay.counters)}`
      : replay.kind === "differs"
        ? `replayed: it differs${replay.divergedAt === null ? "" : ` from tick ${count(replay.divergedAt)}`}: ${replay.differences[0] ?? "no difference named"}`
        : replay.kind === "nothing"
          ? "replayed: nothing, because the run ended at tick 0"
          : `replayed: it failed, ${replay.code}: ${replay.message}`
  const budget = `the budget of ${count(inputs.budget)} a ranked or practice run is held to`
  const checked =
    inputs.problem === null
      ? `inputs: ${count(inputs.count)}, within ${budget}`
      : overBudgetOnly(report) && !ranked
        ? `inputs: ${count(inputs.count)}, over ${budget}, which a game played on its own page is not`
        : `inputs: ${count(inputs.count)}, refused as ${inputs.problem.code}: ${inputs.problem.message}`
  return [replayed, checked, `recording: ${count(report.bytes)} bytes`]
}

/**
 * Whether a report says the run is sound: it replays, and its inputs are
 * ones the platform takes. Over the input budget passes unless the run is
 * `ranked`, since the budget binds only ranked and practice runs.
 */
export function reportPasses(report: DevReport, ranked: boolean): boolean {
  return (
    report.replay.kind === "matches" &&
    (report.inputs.problem === null || (overBudgetOnly(report) && !ranked))
  )
}
