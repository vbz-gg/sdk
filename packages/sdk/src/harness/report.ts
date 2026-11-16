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

/** One sentence about the replay, one about the inputs, one about the size. */
export function reportLines(report: DevReport): string[] {
  const { replay, inputs } = report
  const replayed =
    replay.kind === "matches"
      ? `replayed: it matches, ending at tick ${count(replay.endTick)}${counters(replay.counters)}`
      : replay.kind === "differs"
        ? `replayed: it differs${replay.divergedAt === null ? "" : ` from tick ${count(replay.divergedAt)}`}: ${replay.differences[0] ?? "no difference named"}`
        : replay.kind === "nothing"
          ? "replayed: nothing, because the run ended at tick 0"
          : `replayed: it failed, ${replay.code}: ${replay.message}`
  const checked =
    inputs.problem === null
      ? `inputs: ${count(inputs.count)}, within the budget of ${count(inputs.budget)}`
      : `inputs: ${count(inputs.count)}, refused as ${inputs.problem.code}: ${inputs.problem.message}`
  return [replayed, checked, `recording: ${count(report.bytes)} bytes`]
}

/** Whether a report says the platform would take this run as it is. */
export function reportPasses(report: DevReport): boolean {
  return report.replay.kind === "matches" && report.inputs.problem === null
}
