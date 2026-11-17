/**
 * What the harness page says when a run cannot start.
 *
 * The status line is how an author learns why nothing is playing, so a
 * refusal stays on it: a module that refuses the run at mount, a tilt
 * request the player refuses, and one that fails rather than answering, each
 * show their code there and on the body, and nothing after them writes over
 * it.
 */

import { expect, test } from "@playwright/test"
import { CLIENT_ERROR } from "../../packages/sdk/src/platform/errors"
import { open } from "../src/run"
import { answerTilt, tiltAsked } from "../src/tilt"

/**
 * A run's clock starts only once the game's presentation is ready, so a
 * device the game cannot draw on is told before a tick runs. Here the
 * browser hands the template's canvas no 2d context, as one with canvas
 * switched off does.
 */
test("a game this browser cannot draw says why before a tick, and is not said to be playing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null
  })
  await open(page, "template")
  await page.getByRole("button", { name: "Start" }).click()
  await expect(page.locator("body")).toHaveAttribute(
    "data-refused",
    "E_PRESENTATION_FAILED",
  )
  await expect(page.locator("#status")).toHaveText(
    /^E_PRESENTATION_FAILED: .*no 2d canvas context/,
  )
})

/**
 * The harness plays a game as a studio's page does, so a game steered by
 * tilt starts no run here without it either: the refusal iOS gives once the
 * player taps "Cancel" on its motion prompt (the button's name, measured on
 * iPadOS 26.7), in the client's own sentence, with nothing mounted.
 */
test("a refused tilt says why, and starts no run", async ({ page }) => {
  await answerTilt(page, "denied")
  await open(page, "paddle")
  await page.getByRole("button", { name: "Start" }).click()
  await expect(page.locator("body")).toHaveAttribute(
    "data-refused",
    "E_MOTION_DENIED",
  )
  await expect(page.locator("#status")).toHaveText(
    `E_MOTION_DENIED: ${CLIENT_ERROR.E_MOTION_DENIED}`,
  )
  expect(await tiltAsked(page)).toEqual([{ active: true }])
  await expect(page.locator("#stage > *")).toHaveCount(0)
})

/**
 * The engine's own request for tilt never fails. A page module built from
 * other code can, and a browser call can throw before there is anything to
 * fail, so both are held: one answering with a promise that fails, and one
 * that throws.
 */
for (const how of ["fails", "throws"] as const) {
  test(`a tilt request that ${how} says why, and starts no run`, async ({
    page,
  }) => {
    await page.addInitScript((answer) => {
      const orientation = DeviceOrientationEvent as unknown as {
        requestPermission: () => unknown
      }
      const broke = new Error("the sensor broke")
      orientation.requestPermission =
        answer === "throws"
          ? () => {
              throw broke
            }
          : () => ({
              // biome-ignore lint/suspicious/noThenProperty: a promise-like answer that fails is the case under test
              then: () => Promise.reject(broke),
            })
    }, how)
    await open(page, "paddle")
    await page.getByRole("button", { name: "Start" }).click()
    await expect(page.locator("body")).toHaveAttribute(
      "data-refused",
      "E_UNEXPECTED",
    )
    await expect(page.locator("#status")).toHaveText(
      "E_UNEXPECTED: the sensor broke",
    )
    // Nothing was mounted: a run fills the stage as it starts.
    await expect(page.locator("#stage > *")).toHaveCount(0)
  })
}
