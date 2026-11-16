/**
 * `vbz dev --site`: a game's own page, served as a studio serves one, beside
 * the game's bundles origin and the stand-in for the platform.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HARNESS_GAME_ID, HARNESS_SEED } from "../../src/harness"
import { type RunningSite, siteFile, startSite } from "../../src/harness/site"
import { STAND_IN_PAGE_KEY } from "../../src/harness/stand-in"

const SOURCE = {
  simEntry: "src/sim/index.ts",
  presentEntry: "src/present.ts",
  captureEntry: "src/capture.ts",
}

const MANIFEST = {
  id: "probe",
  version: "1.2.3",
  name: "Probe",
  session: { tickHz: 60, maxTicks: 600, maxWallSeconds: 60 },
  inputs: {},
  rankBy: [],
  tiePolicy: "shared",
}

let root: string

async function writeGame(dir: string, withSite: boolean): Promise<void> {
  await mkdir(join(dir, "src", "sim"), { recursive: true })
  await writeFile(
    join(dir, "src", "sim", "index.ts"),
    `export const MANIFEST = ${JSON.stringify(MANIFEST)}\n`,
  )
  await writeFile(
    join(dir, "src", "present.ts"),
    `import { MANIFEST } from "cw2:sim"\nexport default MANIFEST\n`,
  )
  await mkdir(join(dir, "dist"), { recursive: true })
  await writeFile(join(dir, "dist", "manifest.json"), JSON.stringify(MANIFEST))
  if (!withSite) return
  await mkdir(join(dir, "site", "art"), { recursive: true })
  await writeFile(
    join(dir, "site", "index.html"),
    '<!doctype html><title>Site</title><script type="module" src="/main.js"></script>\n',
  )
  await writeFile(
    join(dir, "site", "main.ts"),
    `const config: { pageKey: string } = await (await fetch("/config.json")).json()\ndocument.title = config.pageKey\n`,
  )
  await writeFile(join(dir, "site", "art", "site.css"), "body { margin: 0 }\n")
}

describe("the site, served with its stand-in", () => {
  let site: RunningSite

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "sdk-site-"))
    await writeGame(root, true)
    site = await startSite({
      source: { root, ...SOURCE },
      gameId: HARNESS_GAME_ID,
      seed: HARNESS_SEED,
      hostPort: 0,
      bundlesPort: 0,
    })
  })

  afterAll(async () => {
    await site.stop()
    await rm(root, { recursive: true, force: true })
  })

  test("four origins: the site, the game's code, the API and the sign-in window", () => {
    const origins = new Set([
      site.siteOrigin,
      site.bundlesOrigin,
      site.apiOrigin,
      site.signInOrigin,
    ])
    expect(origins.size).toBe(4)
  })

  test("the page is the site's own, under a policy naming the game's path and the API", async () => {
    const response = await fetch(site.siteOrigin)
    expect(await response.text()).toContain("<title>Site</title>")
    const csp = response.headers.get("content-security-policy") ?? ""
    expect(csp).toBe(site.csp)
    expect(csp).toContain(
      `script-src 'self' ${site.bundlesOrigin}/g/${HARNESS_GAME_ID}/`,
    )
    expect(csp).toContain(`connect-src 'self' ${site.apiOrigin}`)
    expect(csp).not.toContain("unsafe-eval")
    expect((await fetch(`${site.siteOrigin}/index.html`)).status).toBe(200)
  })

  test("its script is bundled for the browser, and its config names the stand-in", async () => {
    const script = await fetch(`${site.siteOrigin}/main.js`)
    expect(script.headers.get("content-type")).toContain("text/javascript")
    const text = await script.text()
    expect(text).toContain("/config.json")
    expect(text).not.toContain(": { pageKey: string }")
    const config = await (await fetch(`${site.siteOrigin}/config.json`)).json()
    expect(config).toEqual({
      apiOrigin: site.apiOrigin,
      signInOrigin: site.signInOrigin,
      pageKey: STAND_IN_PAGE_KEY,
    })
  })

  test("any other file in site/ is served as it is, and nothing outside it", async () => {
    const css = await fetch(`${site.siteOrigin}/art/site.css`)
    expect(await css.text()).toBe("body { margin: 0 }\n")
    expect((await fetch(`${site.siteOrigin}/art/none.css`)).status).toBe(404)
    expect(
      (await fetch(`${site.siteOrigin}/%2e%2e/dist/manifest.json`)).status,
    ).toBe(404)
  })

  test("the stand-in hands out the build the bundles origin serves", async () => {
    const game = await fetch(`${site.apiOrigin}/v1/game`, {
      headers: { origin: site.siteOrigin, "x-vbz-key": STAND_IN_PAGE_KEY },
    })
    const body = (await game.json()) as {
      today: { line: string; version: { presentUrl: string } }
    }
    expect(body.today.line).toBe("1.2")
    expect(body.today.version.presentUrl).toBe(site.presentUrl)
    expect((await fetch(site.presentUrl)).status).toBe(200)
  })
})

describe("a game without a site", () => {
  test("is refused, naming the file --site looks for", async () => {
    const bare = await mkdtemp(join(tmpdir(), "sdk-site-bare-"))
    try {
      await writeGame(bare, false)
      await expect(
        startSite({
          source: { root: bare, ...SOURCE },
          gameId: HARNESS_GAME_ID,
          seed: HARNESS_SEED,
          hostPort: 0,
          bundlesPort: 0,
        }),
      ).rejects.toThrow(/site\/main\.ts is not there/)
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })
})

describe("which file a path names", () => {
  test("a path inside the site is its file, and one that climbs out is none", () => {
    expect(siteFile("/game/site", "/art/a.css")).toBe("/game/site/art/a.css")
    expect(siteFile("/game/site", "/../dist/sim.js")).toBeNull()
    expect(siteFile("/game/site", "/%2e%2e/dist/sim.js")).toBeNull()
    expect(siteFile("/game/site", "/")).toBeNull()
    expect(siteFile("/game/site", "/%E0%A4%A")).toBeNull()
  })
})
