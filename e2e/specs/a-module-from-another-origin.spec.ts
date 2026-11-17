/**
 * A page module, imported by a studio's page from the platform's bundles
 * origin, under the Content-Security-Policy the SDK recommends.
 *
 * The policy names one game's path on the bundles origin and nothing else
 * there: `script-src 'self' https://files.vbz.gg/g/<game id>/` in production,
 * the suite's bundles origin here. Three engines, because whether a path in
 * `script-src` admits a dynamic `import()` and the module's own static import
 * of its rules code is each browser's to decide, and the docs recommend the
 * policy only because this passes in all three. And another game's path on
 * the same origin has to be refused, by the policy and before the network,
 * or a studio's page would run any game the platform serves.
 */

import { expect, test } from "@playwright/test"
import { SUBJECTS } from "../src/env"
import { clearRequests, requests } from "../src/run"
import {
  failOnce,
  openModule,
  published,
  startModule,
  studio,
} from "../src/studio"

test("the page module and its rules code load from the bundles origin, and play", async ({
  page,
}) => {
  await clearRequests("studio")
  expect(await openModule(page, "template")).toBe("ready")
  // Both modules, each from the game's own path, fetched by the browser.
  const asked = await requests("studio")
  const path = `/g/${SUBJECTS.template.gameId}/`
  expect(asked.some((p) => p.startsWith(`${path}present/`))).toBe(true)
  expect(asked.some((p) => p.startsWith(`${path}sim/`))).toBe(true)
  expect(await published(page, "violations")).toEqual([])
  await startModule(page)
})

test("another game's module on the same origin is refused by the policy, before the network", async ({
  page,
}) => {
  await clearRequests("studio")
  // The page's policy names the template's path, and this is the paddle's.
  expect(await openModule(page, "paddle", "template")).toBe("E_GAME_UNLOADABLE")
  const paddle = `/g/${SUBJECTS.paddle.gameId}/`
  expect(
    (await requests("studio")).filter((p) => p.startsWith(paddle)),
  ).toEqual([])
  const violations = await published<{ blockedURI: string }[]>(
    page,
    "violations",
  )
  expect(violations.length).toBeGreaterThan(0)

  // The same module under a policy naming its own game's path loads, so
  // what refused it above was the path.
  expect(await openModule(page, "paddle", "paddle")).toBe("ready")
})

/**
 * Whether a browser keeps a failed module import for the life of the page.
 *
 * The HTML standard's module map records a failed fetch and answers every
 * later import of the same URL with that failure without asking the network
 * again, so `E_GAME_UNLOADABLE` tells a player to reload the page rather than
 * to try again. This is the measurement that sentence rests on.
 */
test("a module that failed to load fails again in the same page, without a second request", async ({
  page,
}) => {
  const { modules } = await studio()
  const present = new URL(modules.template?.presentUrl ?? "").pathname
  await clearRequests("studio")
  await failOnce("template")
  expect(await openModule(page, "template")).toBe("E_GAME_UNLOADABLE")

  await page.getByRole("button", { name: "Load again" }).click()
  await expect(page.locator("body")).toHaveAttribute("data-attempts", "2")
  const after = (await requests("studio")).filter((p) => p === present)
  expect(await page.locator("body").getAttribute("data-loaded")).toBe(
    "E_GAME_UNLOADABLE",
  )
  expect(after).toHaveLength(1)

  // A new page is a new module map, and loads it.
  await page.reload()
  await expect(page.locator("body")).toHaveAttribute("data-loaded", "ready")
})
