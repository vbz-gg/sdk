/**
 * The run the browser played, replayed away from it.
 *
 * This is the claim the platform is built on, checked here so an author meets
 * it on a laptop: the input log a browser produced, replayed against the same
 * rules code, reaches the same counters at the same tick. The rules code is
 * fetched from the bundles origin at its content address rather than
 * imported from the source tree, so it is the module the page loaded and not
 * a second build of the same file. The harness says the same in its own
 * report, from its own replay, and both are asserted.
 */

import { devices, expect, test } from "@playwright/test"
import {
  checkpointCadence,
  endRun,
  log,
  open,
  play,
  replay,
  stagePoint,
  waitForTick,
} from "../src/run"

/**
 * Past two seconds of play at 60 Hz, so a recording holds two checkpoints
 * before the one on its last tick and the interval between them shows.
 */
const PAST_TWO_SECONDS = 2 * 60 + 1

/**
 * On a phone, so a tap is a finger: the template's two buttons are its own,
 * and a keyboard is the paddle's fallback for a device with no sensor.
 */
test.use({ ...devices["Pixel 7"] })

test("a run on the template's buttons replays to the score the browser showed", async ({
  page,
}) => {
  await open(page, "template")
  await play(page)

  // The middle of the left button, then of the right one, twice.
  for (const [fx, fy] of [
    [75 / 480, 660 / 720],
    [405 / 480, 660 / 720],
    [405 / 480, 660 / 720],
  ] as const) {
    const at = await stagePoint(page, fx, fy)
    await page.touchscreen.tap(at.x, at.y)
  }

  const run = await endRun(page)
  expect(run.recording.format).toBe("cw2-recording")
  expect(run.recording.gameId).toBe("lane-runner")
  // A recording with no inputs replays perfectly and proves nothing, so the
  // presses have to be in it before the comparison is worth making.
  expect(log(run.recording).filter((entry) => entry === "touch0=1")).toEqual([
    "touch0=1",
    "touch0=1",
    "touch0=1",
  ])
  expect(run.result.tick).toBeGreaterThan(0)

  expect(run.report.replay.kind).toBe("matches")
  expect(run.report.inputs.problem).toBeNull()
  const replayed = await replay("template", run.encoded)
  expect(replayed.comparison.differences).toEqual([])
  expect(replayed.comparison.divergedAt).toBeNull()
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.endTick).toBe(run.result.tick)
  expect(replayed.counters).toEqual(run.result.counters)
})

/**
 * The same, from a keyboard, on the paddle, which lasts past two seconds
 * whatever its player does. The template's runner can hit something sooner,
 * so the checkpoint interval is held here.
 */
test("a keyboard run keeps one checkpoint a second and replays to its score", async ({
  page,
}) => {
  await open(page, "paddle")
  await play(page)

  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowRight")
  await waitForTick(page, PAST_TWO_SECONDS)

  const run = await endRun(page)
  expect(run.recording.gameId).toBe("paddle")
  // Without this the test passes on a run that recorded nothing, and an
  // empty log replays perfectly.
  expect(log(run.recording).filter((entry) => entry.endsWith("=1"))).toEqual([
    "left=1",
    "left=1",
    "centre=1",
    "right=1",
  ])
  const cadence = checkpointCadence(run.recording)
  expect(cadence.seconds).toBeGreaterThanOrEqual(2)
  expect(cadence.off).toEqual([])

  expect(run.report.replay.kind).toBe("matches")
  const replayed = await replay("paddle", run.encoded)
  expect(replayed.comparison.differences).toEqual([])
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.endTick).toBe(run.result.tick)
  expect(replayed.counters).toEqual(run.result.counters)
})
