/**
 * `vbz dev --site`: a game's own page, served as a studio serves one, beside
 * the game's bundles origin and the stand-in for the platform.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { buildGame, writeBuild } from "../../src/cli/build"
import { isCopied, TEMPLATE_DIR } from "../../src/cli/new"
import { HARNESS_GAME_ID, HARNESS_SEED } from "../../src/harness"
import { inlineScriptSource } from "../../src/harness/csp"
import {
  inlineScriptsOf,
  type RunningSite,
  siteFile,
  startSite,
} from "../../src/harness/site"
import { STAND_IN_PAGE_KEY } from "../../src/harness/stand-in"

const SOURCE = {
  simEntry: "src/sim/index.ts",
  presentEntry: "src/present.ts",
  captureEntry: "src/capture.ts",
  filesDir: null,
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

/** The import map a page playing locally carries, which its policy admits by hash. */
const IMPORT_MAP = `{"imports":{"cw2:sim":"./game/sim.js"}}`

async function writeGame(
  dir: string,
  withSite: boolean,
  mode: "local" | "ranked" = "ranked",
): Promise<void> {
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
    `<!doctype html><title>Site</title><script type="importmap">${IMPORT_MAP}</script><script type="module" src="/main.js"></script>\n`,
  )
  await writeFile(
    join(dir, "site", "config.json"),
    JSON.stringify({ mode, apiOrigin: "https://api.vbz.gg" }),
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

  test("the page is the site's own, under a policy naming the game's path, the API and the sign-in", async () => {
    const response = await fetch(site.siteOrigin)
    expect(await response.text()).toContain("<title>Site</title>")
    const csp = response.headers.get("content-security-policy") ?? ""
    expect(csp).toBe(site.csp)
    expect(csp).toContain(
      `script-src 'self' ${site.bundlesOrigin}/g/${HARNESS_GAME_ID}/`,
    )
    expect(csp).toContain(`connect-src 'self' ${site.apiOrigin}`)
    expect(csp).toContain(`frame-src ${site.signInOrigin};`)
    expect(csp).toContain(inlineScriptSource(IMPORT_MAP))
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
      mode: "ranked",
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

describe("a site played locally", () => {
  let site: RunningSite

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "sdk-site-local-"))
    await writeGame(root, true, "local")
    await writeFile(join(root, "dist", "game.json"), `{"present":"present.js"}`)
    await mkdir(join(root, "dist", "files", "art"), { recursive: true })
    await writeFile(join(root, "dist", "files", "art", "a.png"), "png")
    site = await startSite({
      source: { root, ...SOURCE },
      gameId: HARNESS_GAME_ID,
      seed: HARNESS_SEED,
      hostPort: 0,
      bundlesPort: 0,
      needs: { wasm: true },
    })
  })

  afterAll(async () => {
    await site.stop()
    await rm(root, { recursive: true, force: true })
  })

  /** A page that talks to nobody: no stand-in, no second origin. */
  test("is one origin, and its config is the mode alone", async () => {
    expect(site.mode).toBe("local")
    expect([site.bundlesOrigin, site.apiOrigin, site.signInOrigin]).toEqual([
      null,
      null,
      null,
    ])
    expect(
      await (await fetch(`${site.siteOrigin}/config.json`)).json(),
    ).toEqual({ mode: "local" })
  })

  test("serves the build beside the page as /game/, as a static host serves dist/", async () => {
    const game = await fetch(`${site.siteOrigin}/game/game.json`)
    expect(await game.json()).toEqual({ present: "present.js" })
    const art = await fetch(`${site.siteOrigin}/game/files/art/a.png`)
    expect(art.headers.get("content-type")).toBe("image/png")
    expect(await art.text()).toBe("png")
    expect(site.presentUrl).toBe(`${site.siteOrigin}/game/present.js`)
    expect((await fetch(`${site.siteOrigin}/game/missing.js`)).status).toBe(404)
    expect(
      (await fetch(`${site.siteOrigin}/game/%2e%2e/site/index.html`)).status,
    ).toBe(404)
  })

  test("under the policy for a page playing its own game, its import map admitted", async () => {
    const response = await fetch(site.siteOrigin)
    const csp = response.headers.get("content-security-policy") ?? ""
    expect(csp).toBe(site.csp)
    expect(csp).toContain(
      `script-src 'self' 'wasm-unsafe-eval' ${inlineScriptSource(IMPORT_MAP)}`,
    )
    expect(csp).toContain("connect-src 'self';")
    expect(csp).not.toContain(" 'unsafe-eval'")
    // Played locally, nobody signs in, so nothing is framed.
    expect(csp).not.toContain("frame-src")
  })
})

describe("a site's config", () => {
  test("naming no mode is refused before anything is served", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdk-site-nomode-"))
    try {
      await writeGame(dir, true)
      await writeFile(
        join(dir, "site", "config.json"),
        JSON.stringify({ pageKey: "vbz_pk_x" }),
      )
      await expect(
        startSite({
          source: { root: dir, ...SOURCE },
          gameId: HARNESS_GAME_ID,
          seed: HARNESS_SEED,
          hostPort: 0,
          bundlesPort: 0,
        }),
      ).rejects.toThrow(/names its mode/)
      await rm(join(dir, "site", "config.json"))
      await expect(
        startSite({
          source: { root: dir, ...SOURCE },
          gameId: HARNESS_GAME_ID,
          seed: HARNESS_SEED,
          hostPort: 0,
          bundlesPort: 0,
        }),
      ).rejects.toThrow(/could not be read/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an inline script is read for its policy, a script with a source or data is not", () => {
    expect(
      inlineScriptsOf(
        `<script type="importmap">{"a":1}</script><script src="x.js"></script>` +
          `<script type="application/json" id="c">{}</script><script>\n</script>` +
          `<SCRIPT type='importmap'>{"b":2}</SCRIPT>`,
      ),
    ).toEqual([`{"a":1}`, `{"b":2}`])
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

describe("the template's own site", () => {
  /**
   * What `vbz new` hands an author has to bundle and serve as it is: its
   * script reaches `@vbz-gg/sdk/platform` and `/host` through the game's own
   * install, as a studio's build would. It plays locally, the build beside
   * it, until its author opts in to ranked play.
   */
  test("bundles, and plays locally, its build beside it and its import map admitted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdk-site-template-"))
    try {
      await cp(TEMPLATE_DIR, dir, {
        recursive: true,
        filter: (path) => isCopied(TEMPLATE_DIR, path),
      })
      await symlink(resolve("node_modules"), join(dir, "node_modules"))
      const source = { root: dir, ...SOURCE }
      await writeBuild(dir, await buildGame(source))
      const site = await startSite({
        source,
        gameId: HARNESS_GAME_ID,
        seed: HARNESS_SEED,
        hostPort: 0,
        bundlesPort: 0,
      })
      try {
        expect(site.mode).toBe("local")
        const page = await fetch(site.siteOrigin)
        const html = await page.text()
        expect(html).toContain('<script type="module" src="main.js">')
        const [map] = inlineScriptsOf(html)
        expect(JSON.parse(map ?? "{}")).toEqual({
          imports: {
            "cw2:sim": "./game/sim.js",
            "cw2:files/": "./game/files/",
          },
        })
        expect(page.headers.get("content-security-policy")).toContain(
          inlineScriptSource(map ?? ""),
        )
        const script = await (await fetch(`${site.siteOrigin}/main.js`)).text()
        expect(script).toContain("Ranked play is paused; practice is open")
        // The page's SDK is bundled, and no engine with it: the page module
        // carries its own.
        expect(script).toContain("E_PAGE_ALTERS_BUILTINS")
        expect(script).not.toContain("ClockworkError")
        const css = await fetch(`${site.siteOrigin}/site.css`)
        expect(css.status).toBe(200)
        // The build, beside the page, where its import map points.
        const build = (await (
          await fetch(`${site.siteOrigin}/game/game.json`)
        ).json()) as { name: string; present: string }
        expect(build.name).toBe("Lane Runner")
        const present = await (
          await fetch(`${site.siteOrigin}/game/${build.present}`)
        ).text()
        expect(present).toContain("cw2:sim")
        expect((await fetch(`${site.siteOrigin}/game/sim.js`)).status).toBe(200)
      } finally {
        await site.stop()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
