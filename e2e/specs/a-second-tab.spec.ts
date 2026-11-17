/**
 * Two tabs of one browser, one player, one game.
 *
 * The platform keeps one open run per player, game and mode. A start while
 * one is open and has committed nothing hands back that run, and two tabs
 * playing it would post chunks under the same numbers with different bodies,
 * which the platform counts against the player as tampering. A start once it
 * has committed a chunk closes it and answers a new run, which ends the first
 * tab's run under its player. So the page takes a Web Lock named for the game
 * and the mode in the click, before it asks for a run, and holds it until the
 * platform has the run. A second tab finding it held stops with
 * `E_RUN_OPEN_ELSEWHERE` having asked the platform for nothing.
 */

import { expect, type Page, test } from "@playwright/test"
import { openRuns, reach, routesOf, sentBy, signIn } from "../src/studio"

/** Every chunk the platform took from a page, as the page sent them. */
function takenChunks(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /^\/v1\/runs\/[^/]+\/chunks$/.test(new URL(response.url()).pathname) &&
      response.ok(),
  )
}

for (const [when, chunkSeconds] of [
  ["before the first has committed anything", "600"],
  ["once the first has committed a chunk", "1"],
] as const) {
  test(`a second tab stops before it asks for a run, ${when}`, async ({
    context,
  }) => {
    const first = await context.newPage()
    const fromFirst = sentBy(first)
    await openRuns(first, "template", { chunkSeconds })
    await signIn(first)

    const second = await context.newPage()
    const fromSecond = sentBy(second)
    await openRuns(second, "template", { chunkSeconds })
    // The player is signed in here too: the token is kept for the page.
    await expect(second.locator("body")).toHaveAttribute(
      "data-player",
      "Local player",
    )

    const committed = chunkSeconds === "1" ? takenChunks(first) : null
    await first.getByRole("button", { name: "Play" }).click()
    await reach(first, "playing")
    await committed
    await second.getByRole("button", { name: "Play" }).click()
    await expect(second.locator("body")).toHaveAttribute("data-phase", "failed")
    await expect(second.locator("body")).toHaveAttribute(
      "data-code",
      "E_RUN_OPEN_ELSEWHERE",
    )
    expect(routesOf(fromSecond)).toEqual(["GET /v1/game"])

    // The first tab's run goes on to its result, untouched by the second.
    await first.getByRole("button", { name: "End" }).click()
    await reach(first, "done")
    const starts = routesOf(fromFirst).filter(
      (route) => route === "POST /v1/runs",
    )
    expect(starts).toHaveLength(1)
    expect(routesOf(fromFirst).some((route) => route.endsWith("/submit"))).toBe(
      true,
    )
  })
}
