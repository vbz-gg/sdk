/**
 * A studio's page and a game's page module are built at different times,
 * often against different releases of this package. Every release drives
 * every contract version an earlier one drove, and refuses a newer one by
 * name rather than misreading it.
 *
 * The earlier release here is the first one whose page modules speak
 * contract 1: the template as it built it, committed under `e2e/frozen/` and
 * never rebuilt, played by a page built from this tree. The later one is
 * this package packed, with its contract raised to 2, as a release that has
 * moved on would be.
 */

import { expect, test } from "@playwright/test"
import { replayAgainst } from "../src/run"
import {
  endModule,
  moduleAt,
  openModule,
  startModule,
  studio,
} from "../src/studio"

test("a page built from this tree plays the module the first release of contract 1 built", async ({
  page,
}) => {
  expect(await openModule(page, "contract-1")).toBe("ready")
  await startModule(page)
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowRight")
  await moduleAt(page, 30)
  const ended = await endModule(page)

  const presses = ended.recording.inputs
    .filter((input) => input.value === 1)
    .map((input) => input.code)
  expect(presses).toEqual(["left", "right"])

  // Against that release's own rules code, which its page module imports.
  const { modules } = await studio()
  const present = await (
    await fetch(modules["contract-1"]?.presentUrl ?? "")
  ).text()
  const simPath = /"(\/g\/[^"]+\/sim\/[0-9a-f]{64}\.js)"/.exec(present)?.[1]
  expect(simPath).toBeDefined()
  const { bundlesOrigin } = await studio()
  const replayed = await replayAgainst(
    `${bundlesOrigin}${simPath}`,
    JSON.stringify(ended.recording),
  )
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.counters).toEqual(ended.counters)
})

test("a module speaking a contract this page does not drive is refused, naming both", async ({
  page,
}) => {
  expect(await openModule(page, "contract-2")).toBe("E_GAME_CONTRACT_UNKNOWN")
  const said = (await page.locator("#state").textContent()) ?? ""
  expect(said).toContain('"module":2')
  expect(said).toContain('"driven":[1]')
})
