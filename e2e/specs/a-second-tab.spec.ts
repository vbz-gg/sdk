/**
 * Two tabs of one browser, one player, one run.
 *
 * A refresh resumes a run that has committed nothing, so a second tab that
 * presses Play while the first is playing is handed the same run. Were it to
 * play it, the two tabs would post chunks under the same numbers with
 * different bodies, and the platform counts that against the player as
 * tampering. The page holds a Web Lock named after the run while it plays,
 * and the second tab, finding it held, stops with `E_RUN_OPEN_ELSEWHERE`
 * having sent nothing for the run.
 */

import { expect, test } from "@playwright/test"
import { openRuns, reach, routesOf, sentBy, signIn } from "../src/studio"

/**
 * A long interval between chunks, so the first tab has committed nothing by
 * the time the second presses Play and the platform hands it the same run.
 */
const NO_CHUNK_YET = { chunkSeconds: "600" }

async function startedIn(
  sent: ReturnType<typeof sentBy>,
): Promise<string | undefined> {
  const start = sent.find(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/v1/runs",
  )
  const body = (await (await start?.response())?.json()) as
    | { readonly sessionId?: string }
    | undefined
  return body?.sessionId
}

test("a second tab handed the same run stops, and sends nothing for it", async ({
  context,
}) => {
  const first = await context.newPage()
  const fromFirst = sentBy(first)
  await openRuns(first, "template", NO_CHUNK_YET)
  await signIn(first)

  const second = await context.newPage()
  const fromSecond = sentBy(second)
  await openRuns(second, "template", NO_CHUNK_YET)
  // The player is signed in here too: the token is kept for the page.
  await expect(second.locator("body")).toHaveAttribute(
    "data-player",
    "Local player",
  )

  await first.getByRole("button", { name: "Play" }).click()
  await reach(first, "playing")
  await second.getByRole("button", { name: "Play" }).click()
  await expect(second.locator("body")).toHaveAttribute("data-phase", "failed")
  await expect(second.locator("body")).toHaveAttribute(
    "data-code",
    "E_RUN_OPEN_ELSEWHERE",
  )

  const run = await startedIn(fromFirst)
  expect(run).toBeDefined()
  expect(await startedIn(fromSecond)).toBe(run)
  expect(routesOf(fromSecond)).toEqual(["GET /v1/game", "POST /v1/runs"])

  // The first tab's run goes on to its result, untouched by the second.
  await first.getByRole("button", { name: "End" }).click()
  await reach(first, "done")
  expect(routesOf(fromFirst)).toContain(`POST /v1/runs/${run}/submit`)
})
