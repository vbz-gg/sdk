/**
 * What `vbz` loads before it knows which command it was asked for.
 *
 * Every module the entry point imports statically is loaded to run any
 * command at all, `vbz new` included. A game made by `vbz new` has none of
 * the engine's optional peers until its own install runs, which is after
 * `vbz new`, and `bunx @vbz-gg/sdk new` runs from an install holding the SDK
 * and the engine and nothing else. So nothing the entry point reaches
 * statically may need one: not TypeScript, whose parser the engine's upload
 * checks read a game's code with, and not a renderer. Only `vbz check` runs
 * those checks, and it loads them when it runs.
 *
 * The walk follows what `tsc` emits for `dist`, which is what an installed
 * `vbz` runs, and then into the installed engine. It reads tsc's output
 * rather than the source because the two differ: under `verbatimModuleSyntax`
 * tsc writes `import { type T } from "x"` as `import {} from "x"`, which
 * loads `x`, while bun's transpiler drops the statement.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { isBuiltin } from "node:module"
import { dirname, join, relative } from "node:path"
import ts from "typescript"

const PACKAGE = join(import.meta.dir, "..", "..")
const CLI = join(PACKAGE, "src", "cli")

/** The options the package's own build emits `dist` with. */
const EMIT = (() => {
  const path = join(PACKAGE, "tsconfig.json")
  const read = ts.readConfigFile(path, ts.sys.readFile)
  return ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE).options
})()

const SCANNER = new Bun.Transpiler({ loader: "js" })

/** The engine's own manifest, as installed beside this package. */
const ENGINE = JSON.parse(
  readFileSync(
    Bun.resolveSync("@clockwork2/engine/package.json", PACKAGE),
    "utf8",
  ),
) as { peerDependenciesMeta?: Record<string, { optional?: boolean }> }

/**
 * What no command but `vbz check` may load: the engine's upload checks, and
 * every package the engine declares as an optional peer.
 */
const OPTIONAL_PEERS = Object.entries(ENGINE.peerDependenciesMeta ?? {})
  .filter(([, meta]) => meta.optional === true)
  .map(([name]) => name)
const NOT_AT_STARTUP = ["@clockwork2/engine/validate", ...OPTIONAL_PEERS]

function forbidden(specifier: string): boolean {
  return NOT_AT_STARTUP.some(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  )
}

/** A file's path as a person reads it in a failure. */
function shown(file: string): string {
  const installed = file.lastIndexOf("node_modules/")
  return installed === -1
    ? relative(PACKAGE, file)
    : file.slice(installed + "node_modules/".length)
}

/** What a file imports and loads with it: everything but `import()`. */
function staticImports(file: string): string[] {
  let text = readFileSync(file, "utf8")
  if (file.endsWith(".ts")) {
    text = ts.transpileModule(text, {
      compilerOptions: EMIT,
      fileName: file,
    }).outputText
  }
  // tsc keeps an entry point's `#!` line, which the scanner refuses.
  const scanned = SCANNER.scanImports(text.replace(/^#!.*/, ""))
  return scanned
    .filter((found) => found.kind !== "dynamic-import")
    .map((found) => found.path)
}

/**
 * Walks every module loading `entry` loads, and answers each forbidden
 * specifier it reached with the chain of files that reached it.
 */
function reached(entry: string): string[] {
  const from = new Map<string, string | null>([[entry, null]])
  const queue = [entry]
  const found: string[] = []
  const chain = (file: string): string => {
    const files: string[] = []
    for (let at: string | null = file; at !== null; at = from.get(at) ?? null) {
      files.unshift(shown(at))
    }
    return files.join(" > ")
  }
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const specifier of staticImports(file)) {
      if (forbidden(specifier)) {
        found.push(`${specifier}, through ${chain(file)}`)
        continue
      }
      if (isBuiltin(specifier)) continue
      const resolved = Bun.resolveSync(specifier, dirname(file))
      if (from.has(resolved)) continue
      from.set(resolved, file)
      queue.push(resolved)
    }
  }
  return found
}

describe("starting vbz", () => {
  test("reaches neither the engine's upload checks nor any optional peer of the engine", () => {
    expect(reached(join(CLI, "index.ts"))).toEqual([])
  })

  /**
   * The walk above passes vacuously if it cannot see what it is looking for.
   * So the engine has to name the peers this file is about, the same walk
   * over `vbz check`'s own module has to reach the upload checks, and over
   * the upload checks it has to follow the engine's own files to TypeScript.
   */
  test("the same walk finds them where they are", () => {
    expect(OPTIONAL_PEERS).toEqual(
      expect.arrayContaining(["typescript", "pixi.js", "three"]),
    )
    expect(reached(join(CLI, "check.ts"))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^@clockwork2\/engine\/validate, through /),
      ]),
    )
    const checks = Bun.resolveSync("@clockwork2/engine/validate", PACKAGE)
    expect(reached(checks)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^typescript, through @clockwork2\/engine\/.+ > .+import-graph\.js$/,
        ),
      ]),
    )
  })
})
