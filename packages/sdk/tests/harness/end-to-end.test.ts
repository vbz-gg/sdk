/**
 * A whole game, built and served, against a real port.
 *
 * The game here is two files with no dependency on the engine, which is
 * deliberate: what is under test is the build, the addressing and the serving,
 * and a real engine in the graph would make a failure ambiguous between this
 * package and that one. A game that does use the engine is the browser suite's
 * subject.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type BuiltGame,
  blobKeys,
  buildAndAddress,
} from "../../src/build/address"
import { buildGameArtifacts } from "../../src/build/build"
import { sha256Hex } from "../../src/build/digest"
import { readManifestFromSim } from "../../src/cli/manifest"
import { escapeHtml, harnessPage } from "../../src/harness/page/document"
import { startBundleServer } from "../../src/harness/servers"

const GAME = "0b6f3c1e-2d4a-4e8b-9c7d-5a1f2e3b4c6d"

const SOURCE = {
  simEntry: "src/sim/index.ts",
  presentEntry: "src/present.ts",
  captureEntry: "src/capture.ts",
  filesDir: null,
}

const MANIFEST = {
  schemaVersion: 2,
  id: "probe",
  version: "1.0.0",
  name: "Probe",
  session: { tickHz: 60, maxTicks: 600, maxWallSeconds: 60, hasEnding: true },
}

let root: string
let built: BuiltGame

async function writeGame(dir: string, present: string): Promise<void> {
  await mkdir(join(dir, "src", "sim"), { recursive: true })
  await writeFile(
    join(dir, "src", "sim", "index.ts"),
    `export const MANIFEST = ${JSON.stringify(MANIFEST)}\n` +
      `export const TINT = "#3bd68a"\n`,
  )
  await writeFile(join(dir, "src", "present.ts"), present)
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sdk-e2e-"))
  await writeGame(
    root,
    `import { MANIFEST, TINT } from "cw2:sim"\n` +
      `document.title = MANIFEST.name + TINT\n`,
  )
  built = await buildAndAddress({ root, ...SOURCE }, GAME)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("building a game", () => {
  test("the simulation carries no import and the page module carries one", async () => {
    const { sim, present } = await buildGameArtifacts({ root, ...SOURCE })
    const simText = new TextDecoder().decode(sim)
    expect(simText).not.toContain("cw2:sim")
    expect(new TextDecoder().decode(present)).toContain("cw2:sim")
  })

  /**
   * The page module must not carry a copy of the simulation. Minification
   * renames identifiers and leaves string literals alone, so a colour the
   * simulation declares is a probe that survives the build: finding it in the
   * page module means the module was inlined rather than imported.
   */
  test("the simulation's own literals do not appear in the page module", () => {
    expect(new TextDecoder().decode(built.present)).not.toContain("#3bd68a")
  })

  test("a build repeated in one process gives the same bytes", async () => {
    const again = await buildGameArtifacts({ root, ...SOURCE })
    expect(sha256Hex(again.sim)).toBe(built.simSha256)
  })

  test("a page module that inlines its simulation is refused at build time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdk-inline-"))
    try {
      // Reaching the simulation by a relative path rather than by the one
      // bare specifier is how a page module ends up carrying its own copy.
      await writeGame(
        dir,
        `import { MANIFEST } from "./sim/index"\ndocument.title = MANIFEST.name\n`,
      )
      await expect(
        buildGameArtifacts({ root: dir, ...SOURCE }),
      ).rejects.toThrow(/does not import cw2:sim/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a build of a file that is not there fails with what bun said", async () => {
    await expect(
      buildGameArtifacts({ root, ...SOURCE, simEntry: "src/nowhere.ts" }),
    ).rejects.toThrow(/build failed/)
  })
})

describe("addressing a game", () => {
  /**
   * The page module is hashed after its import is rewritten, not before.
   * That is what makes a stored page module name exactly one game's
   * simulation forever, and it is the property "the browser and the
   * validator ran the same code" rests on.
   */
  test("the stored page module already names the game's simulation", () => {
    const text = new TextDecoder().decode(built.present)
    expect(text).toContain(`/g/${GAME}/sim/${built.simSha256}.js`)
    expect(text).not.toContain("cw2:sim")
    expect(built.presentSha256).toBe(sha256Hex(built.present))
    expect(built.presentSha256).not.toBe(built.presentSourceSha256)
  })

  test("each hash is the digest of the bytes served under it", () => {
    expect(built.simSha256).toBe(sha256Hex(built.sim))
    expect(blobKeys(built)).toEqual({
      sim: `g/${GAME}/sim/${built.simSha256}.js`,
      present: `g/${GAME}/present/${built.presentSha256}.js`,
      files: `g/${GAME}/t/${built.filesSha256}/`,
    })
  })
})

describe("reading the manifest out of the built simulation", () => {
  /**
   * The manifest an upload carries has to be the one the code carries, so it
   * is read from the module's own export rather than from a file beside it.
   */
  test("the exported MANIFEST comes back", async () => {
    expect(await readManifestFromSim(built.sim)).toEqual(MANIFEST)
  })

  test("a simulation exporting none says so", async () => {
    const bytes = new TextEncoder().encode("export const other = 1")
    await expect(readManifestFromSim(bytes)).rejects.toThrow(/no MANIFEST/)
  })

  test("a simulation that throws on import says that instead", async () => {
    const bytes = new TextEncoder().encode(`throw new Error("boom")`)
    await expect(readManifestFromSim(bytes)).rejects.toThrow(/boom/)
  })
})

describe("serving it", () => {
  let server: { origin: string; stop(): Promise<void> }
  const asked: string[] = []

  beforeAll(() => {
    server = startBundleServer({
      port: 0,
      built,
      log: (path) => asked.push(path),
    })
  })

  afterAll(async () => {
    await server.stop()
  })

  /** The page module's rewritten import resolves against its own URL. */
  test("both modules are fetchable where the page module's import points", async () => {
    const keys = blobKeys(built)
    const present = await fetch(`${server.origin}/${keys.present}`)
    const sim = await fetch(`${server.origin}/${keys.sim}`)
    expect(present.status).toBe(200)
    expect(sim.status).toBe(200)
    expect(sha256Hex(new Uint8Array(await sim.arrayBuffer()))).toBe(
      built.simSha256,
    )
    expect(new TextDecoder().decode(built.present)).toContain(`/${keys.sim}`)
    // The headers a host serving the game to another origin sends.
    expect(present.headers.get("access-control-allow-origin")).toBe("*")
    expect(present.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    )
  })

  test("the request log is what the network did, for a test to read", () => {
    expect(asked).toContain(`/${blobKeys(built).sim}`)
  })

  test("a module that was never built is a 404", async () => {
    const response = await fetch(
      `${server.origin}/g/${GAME}/sim/${"c".repeat(64)}.js`,
    )
    expect(response.status).toBe(404)
  })
})

describe("the harness page", () => {
  /**
   * `</script>` inside the config would end the block early and put the rest
   * of it into the document as markup. The escape keeps it valid JSON.
   */
  test("config that looks like a closing tag cannot end the block", () => {
    const html = harnessPage({
      title: "Probe",
      config: { note: "</script><img src=x onerror=alert(1)>" },
    })
    expect(html).not.toContain("</script><img")
    expect(html).toContain("<\\/script>")
  })

  test("the title is escaped and the script is a module from this origin", () => {
    const html = harnessPage({ title: `<b>x</b>`, config: {} })
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).toContain('<script type="module" src="/harness.js">')
  })

  test("every character that could leave an attribute or a tag is escaped", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    )
  })
})
