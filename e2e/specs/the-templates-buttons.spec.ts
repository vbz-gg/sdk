/**
 * The template's own two buttons, under real fingers.
 *
 * The template draws its controls itself and decides in `tick` what a finger
 * landed on; the device helpers only record where each finger is and whether
 * it is down. Two things about that only a browser can settle: that two
 * thumbs at once are two pointers, each with a slot of its own, so lifting
 * one leaves the other held; and that a thumb which slides off its button,
 * and off the game altogether, still records its release, which without a
 * pointer capture is sent to whatever the finger ended up over instead.
 *
 * The fingers are Chromium's own input protocol, through `Fingers`.
 */

import { devices, expect, test } from "@playwright/test"
import { Fingers } from "../src/fingers"
import {
  endRun,
  log,
  open,
  play,
  replay,
  stagePoint,
  waitForTick,
} from "../src/run"
import { endModule, openModule, startModule } from "../src/studio"

test.use({ ...devices["Pixel 7"] })

/**
 * The middle of each button, as a fraction of the 480 by 720 field: the
 * left one spans 0 to 150 across and the right one 330 to 480, both 600 to
 * 720 down, as `src/sim/field.ts` has them.
 */
const LEFT = { fx: 75 / 480, fy: 660 / 720 }
const RIGHT = { fx: 405 / 480, fy: 660 / 720 }

/** The tick of the first input in the log with this name and value. */
function tickOf(
  inputs: readonly { tick: number; code: string; value: number }[],
  code: string,
  value: number,
): number {
  const found = inputs.find(
    (input) => input.code === code && input.value === value,
  )
  if (found === undefined) throw new Error(`no ${code}=${value} in the log`)
  return found.tick
}

test("two thumbs are two fingers, and lifting one leaves the other on its button", async ({
  page,
}) => {
  await open(page, "template")
  await play(page)

  const fingers = await Fingers.on(page)
  const left = await stagePoint(page, LEFT.fx, LEFT.fy)
  const right = await stagePoint(page, RIGHT.fx, RIGHT.fy)
  await fingers.down(1, left.x, left.y)
  await fingers.down(2, right.x, right.y)
  await fingers.up(1)
  // Long enough for a release of the second finger, sent by mistake with the
  // first, to show as the two releases landing on different ticks.
  const lifted = Number(
    /^tick (\d+)/.exec(
      (await page.locator("#status").textContent()) ?? "",
    )?.[1],
  )
  await waitForTick(page, lifted + 20)
  await fingers.up(2)

  const run = await endRun(page)
  const { inputs } = run.recording
  const entries = log(run.recording)
  // Each finger landed where the game draws a button: in steps of 30 units,
  // the left button is x 0 to 5 and the right one 11 to 16, both from y 20.
  const at = (code: string) =>
    inputs.filter((input) => input.code === code).map((input) => input.value)
  expect(at("touch0X")[0]).toBeLessThanOrEqual(5)
  expect(at("touch1X")[0]).toBeGreaterThanOrEqual(11)
  expect(at("touch0Y")[0]).toBeGreaterThanOrEqual(20)
  expect(at("touch1Y")[0]).toBeGreaterThanOrEqual(20)
  // Slot 0 is the first finger down and slot 1 the second.
  expect(entries.indexOf("touch0=1")).toBeLessThan(entries.indexOf("touch1=1"))
  expect(entries.indexOf("touch1=1")).toBeLessThan(entries.indexOf("touch0=0"))
  expect(entries.indexOf("touch0=0")).toBeLessThan(entries.indexOf("touch1=0"))
  expect(
    tickOf(inputs, "touch1", 0) - tickOf(inputs, "touch0", 0),
  ).toBeGreaterThanOrEqual(15)

  expect(run.report.replay.kind).toBe("matches")
  const replayed = await replay("template", run.encoded)
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.counters).toEqual(run.result.counters)
})

test("a thumb that slides off its button and off the game still lets go", async ({
  page,
}) => {
  // The studio page, whose game is a box in a larger page, so a finger can
  // leave the game for the page around it. The harness's game fills the
  // whole window, and there is nowhere off it to slide.
  expect(await openModule(page, "template")).toBe("ready")
  await startModule(page)

  const box = await page.locator("#stage").boundingBox()
  if (box === null) throw new Error("the game is not on the page")
  const on = await stagePoint(page, RIGHT.fx, RIGHT.fy)
  const fingers = await Fingers.on(page)
  await fingers.down(1, on.x, on.y)
  // Across the left edge of the right button, then off the game's right
  // edge and below it, onto the page.
  await fingers.move(1, box.x + box.width * 0.6, on.y)
  await fingers.move(1, box.x + box.width + 24, on.y)
  await fingers.move(1, box.x + box.width + 24, box.y + box.height + 24)
  await fingers.up(1)

  const ended = await endModule(page)
  const entries = ended.recording.inputs.map(
    (input) => `${input.code}=${input.value}`,
  )
  expect(entries).toContain("touch0=1")
  // The release arrived, after the finger had left the game: its last
  // position is held at the field's far corner, which is where the helpers
  // clamp a finger outside the element.
  expect(entries).toContain("touch0=0")
  const xs = ended.recording.inputs
    .filter((input) => input.code === "touch0X")
    .map((input) => input.value)
  expect(xs[xs.length - 1]).toBe(16)
  expect(entries.indexOf("touch0X=16")).toBeLessThan(
    entries.indexOf("touch0=0"),
  )

  const replayed = await replay("template", JSON.stringify(ended.recording))
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.counters).toEqual(ended.counters)
})
