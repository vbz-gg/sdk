/**
 * `@vbz-gg/sdk/game` is bundled into every page module, and a page module may
 * import exactly one module by name, its rules code, through a static import.
 * So the subpath has to load with no browser present, carry no dynamic
 * import, reach nothing of the page's half of this package, and bundle, with
 * the engine it carries, into a page module the platform accepts.
 */

import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertPresentImportsOnlySim } from "../../src/build/contract"
import { DRIVEN_CONTRACTS, PAGE_MODULE_CONTRACT } from "../../src/game/contract"

const PACKAGE = join(import.meta.dir, "..", "..")
const GAME = join(PACKAGE, "src", "game")

type Scanned = { kind: string; path: string }

async function sources(): Promise<Array<{ file: string; text: string }>> {
  const files = (await readdir(GAME)).filter((name) => name.endsWith(".ts"))
  return await Promise.all(
    files.map(async (file) => ({
      file,
      text: await readFile(join(GAME, file), "utf8"),
    })),
  )
}

describe("@vbz-gg/sdk/game", () => {
  /**
   * Imported in a process with no DOM at all: a module that read `window` or
   * `document` while loading would throw here, and on a server rendering a
   * page, and in `vbz check`.
   */
  test("loads with no browser present", async () => {
    const child = Bun.spawn(
      [
        "bun",
        "-e",
        `if (typeof window !== "undefined" || typeof document !== "undefined") process.exit(2)
         const game = await import(${JSON.stringify(join(GAME, "index.ts"))})
         process.stdout.write(JSON.stringify(Object.keys(game).sort()))`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(err).toBe("")
    expect(code).toBe(0)
    expect(JSON.parse(out)).toContain("definePageModule")
  })

  test("has no dynamic import, and imports nothing of the page's half or the CLI", async () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" })
    for (const { file, text } of await sources()) {
      const imports = transpiler.scanImports(text) as Scanned[]
      expect({ file, dynamic: text.includes("import(") }).toEqual({
        file,
        dynamic: false,
      })
      for (const { kind, path } of imports) {
        expect({ file, kind }).toEqual({ file, kind: "import-statement" })
        const reaches =
          path.startsWith("@clockwork2/engine") || path.startsWith("./")
        expect({ file, path, reaches }).toEqual({ file, path, reaches: true })
      }
    }
  })

  /**
   * The check that matters: the subpath and the engine host it pulls in,
   * bundled the way `vbz build` bundles a page module, import only `cw2:sim`.
   */
  test("bundled into a page module, it passes the platform's import check", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdk-present-"))
    try {
      const entry = join(dir, "present.ts")
      await writeFile(
        entry,
        `import createGame, { MANIFEST } from "cw2:sim"
         import { definePageModule } from ${JSON.stringify(join(GAME, "index.ts"))}
         export default definePageModule({
           createGame,
           manifest: MANIFEST,
           createPresentation: () => ({ mount() {}, render() {}, unmount() {} }),
           capture: { keys: { ArrowLeft: "left" } },
         })\n`,
      )
      const built = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        format: "esm",
        external: ["cw2:sim"],
      })
      expect(built.success).toBe(true)
      const text = (await built.outputs[0]?.text()) ?? ""
      expect(assertPresentImportsOnlySim(text)).toBe(1)
      // The host it plays with came along: the page brings no engine.
      expect(text).toContain("requestAnimationFrame")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("is named in the exports map, beside the other halves", async () => {
    const manifest = JSON.parse(
      await readFile(join(PACKAGE, "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string>> }
    expect(manifest.exports["./game"]).toEqual({
      development: "./src/game/index.ts",
      types: "./dist/game/index.d.ts",
      default: "./dist/game/index.js",
    })
    expect(manifest.exports["./controls"]).toBeUndefined()
  })

  /** A release adds to what it drives and removes nothing. */
  test("the contract a module speaks is one this release drives", () => {
    expect(DRIVEN_CONTRACTS).toContain(PAGE_MODULE_CONTRACT)
    expect(DRIVEN_CONTRACTS[0]).toBe(1)
  })
})
