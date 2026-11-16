/**
 * The host origin, and the harness started whole.
 *
 * Two ports are two origins, which is the point of the harness: an author
 * meets a cross-origin module import on a laptop rather than on a studio's
 * page. These tests drive both servers over real HTTP, because a handler
 * called directly would not prove the ports differ.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashCanonical } from "@clockwork2/engine"
import {
  HARNESS_GAME_ID,
  HARNESS_SEED,
  type Harness,
  harnessPageEntry,
  startHarness,
} from "../../src/harness"
import { startHostServer } from "../../src/harness/servers"

describe("the host origin", () => {
  let server: { origin: string; stop(): Promise<void> }

  beforeAll(() => {
    server = startHostServer({
      port: 0,
      page: "<!doctype html><title>page</title>",
      script: "export const script = 1",
    })
  })

  afterAll(async () => {
    await server.stop()
  })

  test("the page is served as a document", async () => {
    const response = await fetch(server.origin)
    expect(await response.text()).toContain("<title>page</title>")
    expect(response.headers.get("content-type")).toContain("text/html")
  })

  test("the page script is served as a module from this same origin", async () => {
    const response = await fetch(`${server.origin}/harness.js`)
    expect(await response.text()).toBe("export const script = 1")
    expect(response.headers.get("content-type")).toContain("text/javascript")
  })

  /**
   * A rebuild changes the module hashes the page names, so a cached page
   * would load a game that is no longer served and show a blank stage with a
   * 404 nobody sees.
   */
  test("nothing from the harness is cached", async () => {
    for (const path of ["/", "/harness.js"]) {
      const response = await fetch(`${server.origin}${path}`)
      expect(response.headers.get("cache-control")).toBe("no-store")
    }
  })

  test("any other path is the page, so a deep link still works", async () => {
    const response = await fetch(`${server.origin}/play/anything`)
    expect(await response.text()).toContain("<title>page</title>")
  })
})

const SOURCE = {
  simEntry: "src/sim/index.ts",
  presentEntry: "src/present.ts",
  captureEntry: "src/capture.ts",
}

/** What `vbz build` would have written beside the artifacts. */
const DIST_MANIFEST = {
  name: "Probe Game",
  session: { tickHz: 30, maxTicks: 900 },
  inputs: { left: { min: 0, max: 1 } },
}

describe("the harness, started whole", () => {
  let root: string
  let harness: Harness

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "sdk-harness-"))
    await mkdir(join(root, "src", "sim"), { recursive: true })
    await writeFile(
      join(root, "src", "sim", "index.ts"),
      `export const MANIFEST = ${JSON.stringify(DIST_MANIFEST)}\n`,
    )
    await writeFile(
      join(root, "src", "present.ts"),
      `import { MANIFEST } from "cw2:sim"\ndocument.title = MANIFEST.name\n`,
    )
    // The manifest is read from dist, which is what `vbz build` writes.
    await mkdir(join(root, "dist"), { recursive: true })
    await writeFile(
      join(root, "dist", "manifest.json"),
      JSON.stringify(DIST_MANIFEST),
    )
    harness = await startHarness({
      source: { root, ...SOURCE },
      hostPort: 0,
      bundlesPort: 0,
    })
  })

  afterAll(async () => {
    await harness.stop()
    await rm(root, { recursive: true, force: true })
  })

  /**
   * The whole reason for two servers. One origin would hide the cross-origin
   * module import a studio's page makes, and the CORS headers it needs.
   */
  test("the game's code and the page that loads it are on different origins", () => {
    expect(harness.bundlesOrigin).not.toBe(harness.hostOrigin)
    expect(harness.presentUrl.startsWith(`${harness.bundlesOrigin}/g/`)).toBe(
      true,
    )
  })

  test("the page carries the manifest's own session settings", async () => {
    const html = await (await fetch(harness.hostOrigin)).text()
    expect(html).toContain("Probe Game")
    expect(html).toContain(`"tickHz":30`)
    expect(html).toContain(`"maxTicks":900`)
    // The seed is fixed, so a run an author is debugging is the run they had
    // a moment ago.
    expect(html).toContain(`"seed":"${HARNESS_SEED}"`)
  })

  /**
   * The page checks the module it loads against the manifest the build wrote,
   * as a studio's page checks it against the version the platform names.
   */
  test("the page is told where the page module is and which manifest it must be", async () => {
    const html = await (await fetch(harness.hostOrigin)).text()
    expect(html).toContain(`"presentUrl":"${harness.presentUrl}"`)
    expect(html).toContain(`"manifestHash":"${hashCanonical(DIST_MANIFEST)}"`)
    expect(harness.presentUrl).toContain(`/g/${HARNESS_GAME_ID}/present/`)
  })

  test("the page's script bundles and is served", async () => {
    const script = await (
      await fetch(`${harness.hostOrigin}/harness.js`)
    ).text()
    expect(script.length).toBeGreaterThan(0)
    // It loads the game the way a studio's page does.
    expect(script).toContain("E_PAGE_ALTERS_BUILTINS")
  })

  test("the page module is served from the bundles origin with the edge's headers", async () => {
    const response = await fetch(harness.presentUrl)
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })

  test("a game with no manifest on disk still starts, on defaults", async () => {
    const bare = await mkdtemp(join(tmpdir(), "sdk-bare-"))
    try {
      await mkdir(join(bare, "src", "sim"), { recursive: true })
      await writeFile(
        join(bare, "src", "sim", "index.ts"),
        "export const a = 1",
      )
      await writeFile(
        join(bare, "src", "present.ts"),
        `import { a } from "cw2:sim"\ndocument.title = String(a)\n`,
      )
      const plain = await startHarness({
        source: { root: bare, ...SOURCE },
        hostPort: 0,
        bundlesPort: 0,
        seed: "chosen",
      })
      try {
        const html = await (await fetch(plain.hostOrigin)).text()
        expect(html).toContain(`"tickHz":60`)
        // An empty manifest's hash, which no page module carries, so the
        // page refuses the game rather than playing one it cannot check.
        expect(html).toContain(`"manifestHash":"${hashCanonical({})}"`)
        expect(html).toContain(`"seed":"chosen"`)
      } finally {
        await plain.stop()
      }
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })
})

describe("the page script the harness bundles at start", () => {
  /**
   * The path is built from `import.meta.dir`, so it resolves to the
   * TypeScript here and has to resolve to the compiled file in an installed
   * copy - `tsc` compiles TypeScript and does not copy it. Hard-coding `.ts`
   * builds nothing anywhere but this repository, and the failure arrives when
   * somebody runs `vbz dev` rather than when anything is imported.
   */
  test("its entry is a file that exists, whichever tree this is", () => {
    const entry = harnessPageEntry()
    expect(existsSync(entry)).toBe(true)
    expect(entry.endsWith("main.ts") || entry.endsWith("main.js")).toBe(true)
  })

  test("a compiled tree resolves to the compiled file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdk-page-"))
    try {
      await writeFile(join(dir, "main.js"), "export const a = 1\n")
      expect(harnessPageEntry(dir).endsWith("main.js")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a tree with neither says so, rather than handing back a path", () => {
    // The bundler's own error for a missing entry names a path and not a
    // cause, which is a bad half hour for whoever installed the package.
    expect(() => harnessPageEntry("/nowhere/that/exists")).toThrow(
      /harness page's entry is missing/,
    )
  })
})
