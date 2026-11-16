/**
 * Keys on a studio's page, where the game is one element among others and
 * the Play button that started the run sits beside it.
 *
 * The device helpers listen for keys on the window, so a key the game maps
 * reaches it wherever focus is, and they cancel a mapped key's default, so
 * the page does not scroll under the game. Space is the key to watch: it
 * also presses a focused button, and a Play button pressed again in the
 * middle of a run asks the platform for another one, which closes this one
 * and counts a new ranked run against the player. The paddle maps Space,
 * and reads tilt, so the page is given a sensor held level: a game that
 * reads tilt starts no run without one.
 */

import { expect, test } from "@playwright/test"
import { openRuns, reach, routesOf, sentBy, signIn } from "../src/studio"
import { tiltSensor } from "../src/tilt"

test("keys reach the game while Play still has focus, and a mapped Space does not press it", async ({
  page,
  context,
}) => {
  await tiltSensor(context, page)
  const sent = sentBy(page)
  await openRuns(page, "paddle")
  await signIn(page)
  await page.getByRole("button", { name: "Play" }).click()
  await reach(page, "playing")

  // `playRun` moved focus from Play to the game.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("stage")
  await page.keyboard.press("ArrowRight")

  // Focus back on Play, as after a player tabs to it, or a page that keeps it.
  await page.getByRole("button", { name: "Play" }).focus()
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("play")
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowLeft")
  // A page three thousand pixels tall, and neither key scrolled it.
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  await page.getByRole("button", { name: "End" }).click()
  await reach(page, "done")

  // One run was asked for: Space reached the game and not the button.
  expect(routesOf(sent).filter((route) => route === "POST /v1/runs")).toEqual([
    "POST /v1/runs",
  ])
  const submit = sent.find((request) => request.url().endsWith("/submit"))
  const { recording } = JSON.parse(submit?.postData() ?? "{}") as {
    readonly recording: {
      readonly inputs: readonly { code: string; value: number }[]
    }
  }
  const presses = recording.inputs
    .filter((input) => input.value === 1)
    .map((input) => input.code)
  expect(presses).toEqual(["right", "centre", "left"])
})
