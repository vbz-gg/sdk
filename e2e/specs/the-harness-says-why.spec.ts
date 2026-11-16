/**
 * What the harness page says when a run cannot start.
 *
 * The status line is how an author learns why nothing is playing, so a
 * refusal stays on it: a module that refuses the run at mount, and a tilt
 * request that fails rather than answering, each show their code there and
 * on the body, and nothing after them writes over it.
 */

import { expect, test } from "@playwright/test"
import { open } from "../src/run"

test("a run the module refuses at mount says why, and is not said to be playing", async ({
  page,
}) => {
  // The page asks for a run at another rate from the game's, which the page
  // module refuses on the spot, before a tick runs. The config is edited as
  // the parser inserts it, before the page's module script reads it.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      const block = document.getElementById("harness-config")
      if (block === null) return
      const config = JSON.parse(block.textContent ?? "{}") as {
        tickHz: number
      }
      block.textContent = JSON.stringify({ ...config, tickHz: 30 })
      observer.disconnect()
    }).observe(document, { childList: true, subtree: true })
  })
  await open(page, "template")
  await page.getByRole("button", { name: "Start" }).click()
  await expect(page.locator("body")).toHaveAttribute(
    "data-refused",
    "E_WRONG_GAME",
  )
  await expect(page.locator("#status")).toHaveText(
    /^E_WRONG_GAME: the run ticks at 30 Hz/,
  )
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
