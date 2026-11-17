/**
 * A game played on a studio-style page with no platform: `playLocal`, the
 * same build a ranked run plays, loaded with `loadGame` and played through
 * the module's own `mount`.
 *
 * It asks no platform anything: every request the page makes goes to its
 * own origin or to the origin its game is served from. And its recording
 * can never pass for a ranked run's: posted to the stand-in as one, by a
 * page that casts it past the compiler, it is refused as played on a seed
 * no run was issued, and nothing is stored.
 */

import { expect, test } from "@playwright/test"
import { STUDIO_ORIGIN } from "../src/env"
import { replayAgainst } from "../src/run"
import {
  type ModuleEnd,
  moduleAt,
  published,
  signIn,
  simUrlOf,
  studio,
} from "../src/studio"

test("a game played locally asks no platform anything, and the platform refuses its recording", async ({
  page,
}) => {
  const { bundlesOrigin } = await studio()
  const asked: string[] = []
  page.on("request", (request) => asked.push(request.url()))
  const body = page.locator("body")
  await page.goto(`${STUDIO_ORIGIN}/?game=template&local=template`)
  await expect(body).toHaveAttribute("data-loaded", "ready")

  await page.getByRole("button", { name: "Play" }).click()
  await expect(body).toHaveAttribute("data-tick", /^[1-9]/)
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowRight")
  await moduleAt(page, 30)
  await page.getByRole("button", { name: "End" }).click()
  await expect(body).toHaveAttribute("data-phase", "ended")
  const ended = await published<
    ModuleEnd & { readonly recording: { readonly seed: string } }
  >(page, "run")

  // A fresh seed, always behind `local:`, which no platform seed is.
  expect(ended.recording.seed).toMatch(/^local:[0-9a-f]{32}$/)
  const presses = ended.recording.inputs
    .filter((input) => input.value === 1)
    .map((input) => input.code)
  expect(presses).toEqual(["left", "right"])
  // The page's own origin and the game's, and nobody else.
  expect([...new Set(asked.map((url) => new URL(url).origin))].sort()).toEqual(
    [STUDIO_ORIGIN, bundlesOrigin].sort(),
  )
  const replayed = await replayAgainst(
    await simUrlOf("template"),
    JSON.stringify(ended.recording),
  )
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.counters).toEqual(ended.counters)

  // Then a player signs in, and the page posts the local recording as a
  // ranked run's own.
  await signIn(page)
  await page.getByRole("button", { name: "Post" }).click()
  await expect(body).toHaveAttribute("data-posted", /.+/)
  expect(await published(page, "posted")).toEqual({
    code: "E_PINNED_MISMATCH",
    state: "open",
    rows: 0,
  })
})
