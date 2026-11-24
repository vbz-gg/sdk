/**
 * A build served from another origin by a host that is not this SDK's.
 *
 * `vbz build --addressed` writes `dist/addressed/`, and a plain file server
 * serves it as it is from its root, sending only the headers the guide's
 * "Distributing the build" lists, by each file's extension, with nothing of
 * `createBlobServer`. A page on an origin of its own, under `pageCsp` naming
 * that origin, the game id and the needs `addressed.json` gives, loads the
 * page module at the path the file names and plays the template with
 * `playLocal`. Every engine, because whether that list and that policy
 * admit the page module and its import of the rules code is each browser's
 * to decide: passing in all three is what lets the guide say the list is
 * enough for any host.
 */

import { expect, test } from "@playwright/test"
import type { AddressedBuild } from "../../packages/sdk/src/harness"
import { CONTROL_ORIGIN } from "../src/env"
import { clearRequests, replayAgainst, requests } from "../src/run"
import { type ModuleEnd, moduleAt, published } from "../src/studio"

interface AddressedInfo {
  readonly pageOrigin: string
  readonly filesOrigin: string
  readonly build: AddressedBuild
}

async function addressed(): Promise<AddressedInfo> {
  return (await (
    await fetch(`${CONTROL_ORIGIN}/addressed`)
  ).json()) as AddressedInfo
}

test("a page on another origin plays the build a plain file server holds at its root", async ({
  page,
}) => {
  const { pageOrigin, filesOrigin, build } = await addressed()
  await clearRequests("addressed")
  const asked: string[] = []
  page.on("request", (request) => asked.push(request.url()))
  const body = page.locator("body")
  await page.goto(`${pageOrigin}/`)
  await expect(body).toHaveAttribute("data-loaded", "ready")

  // The page module at the path addressed.json names, and the rules code at
  // the path the page module names, from the host and nothing else there.
  expect((await requests("addressed")).sort()).toEqual(
    [build.present, build.sim].sort(),
  )
  expect(await published(page, "violations")).toEqual([])

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

  // A run was played, and recorded what was pressed.
  expect(ended.recording.seed).toMatch(/^local:[0-9a-f]{32}$/)
  expect(
    ended.recording.inputs
      .filter((input) => input.value === 1)
      .map((input) => input.code),
  ).toEqual(["left", "right"])
  // The page's own origin and the host's, and nobody else.
  expect([...new Set(asked.map((url) => new URL(url).origin))].sort()).toEqual(
    [pageOrigin, filesOrigin].sort(),
  )
  // And it replays to what the page showed against the rules code the host
  // served, the bytes the browser ran.
  const replayed = await replayAgainst(
    `${filesOrigin}${build.sim}`,
    JSON.stringify(ended.recording),
  )
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.counters).toEqual(ended.counters)
})

/**
 * The run above passes only if the policy admitted the game, so the same
 * page under a policy naming another game's path on the host has to load
 * nothing, or the first test proves nothing about the policy.
 */
test("under a policy naming another game's path on the host, the page loads nothing", async ({
  page,
}) => {
  const { pageOrigin, build } = await addressed()
  const other = "11111111-2222-4333-8444-555555555555"
  expect(other).not.toBe(build.gameId)
  await clearRequests("addressed")
  await page.goto(`${pageOrigin}/?id=${other}`)
  await expect(page.locator("body")).toHaveAttribute(
    "data-loaded",
    "E_GAME_UNLOADABLE",
  )
  expect(await requests("addressed")).toEqual([])
  const violations = await published<{ blockedURI: string }[]>(
    page,
    "violations",
  )
  expect(violations.length).toBeGreaterThan(0)
})

/**
 * What the host sent is what the guide lists, so a pass above is a pass on
 * those headers and not on something a server adds by itself.
 */
test("the host sends the guide's headers and nothing of createBlobServer's", async () => {
  const { filesOrigin, build } = await addressed()
  const response = await fetch(`${filesOrigin}${build.present}`)
  expect(response.status).toBe(200)
  const headers = Object.fromEntries(response.headers)
  expect(headers).toMatchObject({
    "content-type": "text/javascript",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
    "cache-control": "public, max-age=31536000, immutable",
  })
  expect(headers.etag).toBeUndefined()
  expect(headers["access-control-allow-methods"]).toBeUndefined()
  const missing = await fetch(`${filesOrigin}${build.files}missing.json`)
  expect(missing.status).toBe(404)
  expect(missing.headers.get("access-control-allow-origin")).toBe("*")
  expect(missing.headers.get("content-security-policy")).toBe(
    "default-src 'none'; sandbox",
  )
})
