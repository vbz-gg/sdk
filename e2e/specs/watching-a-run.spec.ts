/**
 * Watching a run on a studio's page: `watchRun` loads the run's own page
 * module and replays its own inputs, to where the platform's replay stopped.
 *
 * An abandoned run is the case that matters. Its player left at some tick,
 * and a replay that ran on past it would show a game nobody played, ending
 * wherever the rules code happened to end it.
 */

import { expect, test } from "@playwright/test"
import { openRuns, published, reach, signIn } from "../src/studio"

interface Result {
  readonly state: string
  readonly replay: {
    readonly endTick: number
    readonly counters: Record<string, number>
  } | null
}

interface Watched {
  readonly tick: number
  readonly counters: Record<string, number>
  readonly lastFrame: number
}

test("watching an abandoned run stops at the tick its player left", async ({
  page,
}) => {
  await openRuns(page, "template")
  await signIn(page)
  await page.getByRole("button", { name: "Play" }).click()
  await reach(page, "playing")
  // A second of play, well before the template's first rock can reach the
  // runner at about two, so the run ends because its player left it.
  await page.waitForTimeout(1_000)
  await page.getByRole("button", { name: "End" }).click()
  await reach(page, "done")

  const result = await published<Result>(page, "run")
  expect(result.state).toBe("settled")
  const endTick = result.replay?.endTick ?? 0
  expect(endTick).toBeGreaterThan(30)

  await page.getByRole("button", { name: "Watch" }).click()
  await expect(page.locator("body")).toHaveAttribute("data-watched", "ended")
  const watched = await published<Watched>(page, "watched")
  expect(watched.tick).toBe(endTick)
  expect(watched.lastFrame).toBeLessThanOrEqual(endTick)
  expect(watched.lastFrame).toBeGreaterThan(0)
  expect(watched.counters).toEqual(result.replay?.counters)
})
