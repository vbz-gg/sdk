/**
 * Building a game's source into the two artifacts an upload carries, and
 * listing the files folder that goes with them.
 *
 * The platform takes built bundles and never source, so this is not a step it
 * runs - it is how an author produces what they upload, and how the harness
 * produces what it serves locally. Anyone is free to build another way: what
 * has to be reproduced is the shape of the output, which `contract.ts`
 * describes and the platform re-checks on arrival.
 */

import {
  assertPresentImports,
  assertSimSelfContained,
  assertSize,
  decodeArtifact,
  FILES_SPECIFIER,
  SIM_SPECIFIER,
} from "./contract.js"
import { EMPTY_LISTING, type ListedFolder, listFolder } from "./files.js"
import { runGameProcess } from "./game-process.js"
import { MAX_PRESENT_BYTES, MAX_SIM_BYTES } from "./limits.js"

export interface GameSource {
  /** Absolute path to the game directory. */
  readonly root: string
  /** The simulation's entry, relative to the root. */
  readonly simEntry: string
  /** The page module's entry, relative to the root. */
  readonly presentEntry: string
  /**
   * The input mapping's module, relative to the root: a file that touches no
   * DOM, so `vbz check` can import it under bun and run `checkCapture` over
   * it without loading the page module. The build itself does not read it;
   * the page module imports it.
   */
  readonly captureEntry: string
  /**
   * The version's files folder, absolute, which the game's own tools built,
   * or null for a game with none, whose folder lists nothing. A game names
   * it in its `package.json`, as `"vbz": { "files": "<dir>" }`.
   */
  readonly filesDir: string | null
}

export interface GameArtifacts {
  readonly sim: Uint8Array
  readonly present: Uint8Array
  /** The files folder, listed, and where each file is on disk. */
  readonly files: ListedFolder
}

/**
 * Two bundles, in memory.
 *
 * Each is `bun build` run with the game's own directory as the working
 * directory, writing to stdout. A subprocess rather than `Bun.build`, because
 * the programmatic bundler seeds bare-specifier resolution from the calling
 * module's location: the same tree then builds from the game's directory and
 * fails to resolve its own dependencies from a test three directories away,
 * which would make an artifact's hash depend on where the build was invoked.
 * It is also exactly what a submitter runs.
 *
 * `--target=browser` for both. The simulation has to run in a browser and in a
 * Workers isolate, and the browser conditions are the ones that keep node
 * builtins out of the graph.
 *
 * Nothing passes the `development` export condition. `@clockwork2/engine` maps
 * that to its TypeScript sources, so resolving through it would bundle
 * different bytes from the published `dist`.
 *
 * The bundler runs the macros the game's source imports, which is the game's
 * own code, so it runs through `runGameProcess` with nothing of the
 * environment but `NODE_ENV`, which it builds for.
 *
 * The contract runs against the output here as well as at publish, so a build
 * that quietly inlined the simulation fails where the person who caused it is
 * standing rather than in somebody's upload.
 */
export async function buildGameArtifacts(
  source: GameSource,
): Promise<GameArtifacts> {
  // Listed first: the page module is checked against what the folder holds.
  const files: ListedFolder =
    source.filesDir === null
      ? { listing: EMPTY_LISTING, onDisk: new Map() }
      : await listFolder(source.filesDir)

  const sim = await bundle(source.root, source.simEntry, [])
  const simText = decodeArtifact(sim, "simulation")
  assertSize(sim, MAX_SIM_BYTES, "simulation")
  assertSimSelfContained(simText)

  // Bun never resolves an external bare specifier, so the specifier reaches
  // the output verbatim and no plugin is involved. A file of the folder is
  // external by its prefix, so it stays the import the folder answers.
  const present = await bundle(source.root, source.presentEntry, [
    SIM_SPECIFIER,
    `${FILES_SPECIFIER}*`,
  ])
  const presentText = decodeArtifact(present, "page module")
  assertSize(present, MAX_PRESENT_BYTES, "page module")
  assertPresentImports(presentText, files.listing)

  return { sim, present, files }
}

/**
 * One entry under `root` bundled for the browser, as `buildGameArtifacts`
 * bundles each module, and as `vbz dev --site` bundles a game's page script.
 */
export async function bundle(
  root: string,
  entry: string,
  external: readonly string[],
): Promise<Uint8Array> {
  const command = [
    "build",
    `./${entry}`,
    "--target=browser",
    "--format=esm",
    "--minify",
    ...external.flatMap((name) => ["--external", name]),
  ]

  const child = await runGameProcess(command, {
    cwd: root,
    env: { NODE_ENV: "production" },
  })

  if (child.code !== 0) {
    throw new Error(
      `build failed for ${entry} in ${root}:\n${child.stderr.trim()}`,
    )
  }
  if (child.stdout.byteLength === 0) {
    throw new Error(`build of ${entry} in ${root} produced nothing`)
  }
  return child.stdout
}
