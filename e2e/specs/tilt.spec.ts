/**
 * Tilt, from Chromium's orientation override, on the paddle.
 *
 * The paddle maps tilt through the engine's device helpers, so its page
 * module reports `needsMotion`, and a page asks for motion in the click that
 * starts the run, before it asks the platform for one. The override stands
 * in for a phone's sensor: a reading of how far the screen leans becomes one
 * level from -10 to 10, recorded only when it changes, and the run replays
 * to where the paddle went.
 *
 * A game steered by tilt starts no run without it. A refusal and a device
 * with no sensor each stop the run on a studio's page before it asks the
 * platform for anything, and say why in the client's own sentence, so a
 * ranked run is never spent on a game nobody can steer.
 */

import { expect, test } from "@playwright/test"
import { CLIENT_ERROR } from "../../packages/sdk/src/platform/errors"
import { endRun, log, open, play, replay, waitForTick } from "../src/run"
import { openRuns, routesOf, sentBy, signIn } from "../src/studio"
import { answerTilt, tiltAsked, tiltSensor } from "../src/tilt"

test("a lean is recorded as a level when it changes, and replays", async ({
  page,
  context,
}) => {
  const lean = await tiltSensor(context, page)

  await open(page, "paddle")
  await play(page)
  // The request in the click was granted, so nothing about motion was said.
  await expect(page.locator("#status")).not.toHaveText(/E_MOTION/)

  // Full deflection is at 30 degrees, so 30 is the top of the range and 15
  // the other way is half of it.
  await lean(30)
  await waitForTick(page, 60)
  await lean(-15)
  await waitForTick(page, 120)

  const run = await endRun(page)
  const levels = log(run.recording).filter((entry) => entry.startsWith("tilt="))
  // The first reading is recorded as it is, level, and after that a level
  // only when it changes.
  expect(levels).toEqual(["tilt=0", "tilt=10", "tilt=-5"])

  expect(run.report.replay.kind).toBe("matches")
  const replayed = await replay("paddle", run.encoded)
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.counters).toEqual(run.result.counters)
})

/**
 * iOS once the player taps "Cancel" on its motion prompt (the button's name,
 * measured on iPadOS 26.7): every later request is answered with a refusal,
 * at once and without a prompt. The page asked once, inside the tap, and
 * then asked the platform for nothing.
 */
test("a refused tilt starts no run on a studio's page, and says why", async ({
  page,
}) => {
  await answerTilt(page, "denied")
  const sent = sentBy(page)
  await openRuns(page, "paddle")
  await signIn(page)
  await page.getByRole("button", { name: "Play" }).click()

  await expect(page.locator("body")).toHaveAttribute("data-phase", "failed")
  await expect(page.locator("body")).toHaveAttribute(
    "data-code",
    "E_MOTION_DENIED",
  )
  await expect(page.locator("#state")).toHaveText(
    `failed E_MOTION_DENIED: ${CLIENT_ERROR.E_MOTION_DENIED}`,
  )
  expect(await tiltAsked(page)).toEqual([{ active: true }])
  expect(routesOf(sent)).not.toContain("POST /v1/runs")
  await expect(page.locator("#stage > *")).toHaveCount(0)
})

/**
 * A laptop: Chromium here has orientation events and no sensor behind them,
 * so a request for tilt is granted and no reading ever arrives.
 */
test("a device with no tilt sensor starts no run on a studio's page, and says why", async ({
  page,
}) => {
  const sent = sentBy(page)
  await openRuns(page, "paddle")
  await signIn(page)
  await page.getByRole("button", { name: "Play" }).click()

  await expect(page.locator("body")).toHaveAttribute(
    "data-code",
    "E_MOTION_NO_SENSOR",
  )
  await expect(page.locator("#state")).toHaveText(
    `failed E_MOTION_NO_SENSOR: ${CLIENT_ERROR.E_MOTION_NO_SENSOR}`,
  )
  expect(routesOf(sent)).not.toContain("POST /v1/runs")
  await expect(page.locator("#stage > *")).toHaveCount(0)
})
