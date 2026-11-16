/**
 * Tilt, from Chromium's orientation override, on the paddle.
 *
 * The paddle maps tilt through the engine's device helpers, so its page
 * module reports `needsMotion`, and the harness asks for motion in the Start
 * button's click before it mounts the run. The override stands in for a
 * phone's sensor: a reading of how far the screen leans becomes one level
 * from -10 to 10, recorded only when it changes, and the run replays to where
 * the paddle went. Firefox and WebKit have no sensor override in Playwright.
 */

import { expect, test } from "@playwright/test"
import { endRun, log, open, play, replay, waitForTick } from "../src/run"

test("a lean is recorded as a level when it changes, and replays", async ({
  page,
  context,
}) => {
  // Without the grant Chromium sends one reading with every angle null and
  // nothing after, which the helpers rightly drop.
  await context.grantPermissions(["accelerometer", "gyroscope"])
  const cdp = await context.newCDPSession(page)
  // Flat on the table, the right edge `gamma` degrees down.
  const lean = (gamma: number) =>
    cdp.send("DeviceOrientation.setDeviceOrientationOverride", {
      alpha: 0,
      beta: 0,
      gamma,
    })

  await open(page, "paddle")
  await lean(0)
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
