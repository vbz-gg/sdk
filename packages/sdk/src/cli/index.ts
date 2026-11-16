#!/usr/bin/env bun
/**
 * `vbz`, the commands an author runs.
 *
 * `build` produces the three files an upload carries. `dev` serves the game
 * the way production serves it, on two origins, so the first time a game's
 * page module is imported from another origin is on a laptop.
 *
 * Entry points are excluded from the coverage floor, so everything with a
 * decision in it lives beside this file rather than in it.
 */

import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { DIST_DIR, DIST_FILES } from "../build/dist.js"
import { buildGameArtifacts, type GameSource } from "../build/index.js"
import {
  DEFAULT_BUNDLES_PORT,
  DEFAULT_HOST_PORT,
  startHarness,
} from "../harness/index.js"
import { type Options, parseArgs } from "./args.js"
import { readManifestFromSim } from "./manifest.js"
import { createGame } from "./new.js"
import {
  API_ORIGIN_VARIABLE,
  DEFAULT_API_ORIGIN,
  publish,
  publishSettings,
  STUDIO_KEY_VARIABLE,
  verdictOf,
} from "./publish.js"

const USAGE = `vbz - build and run a game for vbz.gg

  vbz new     [dir]   copy a game that already conforms, and rename it
  vbz build   [dir]   write dist/sim.js, dist/present.js and dist/manifest.json
  vbz dev     [dir]   serve the game the way production does
  vbz publish [dir]   upload dist/ and wait for the platform's verdict

  --sim <path>       the simulation's entry   (default src/sim/index.ts)
  --present <path>   the page module's entry  (default src/present.ts)
  --capture <path>   the input mapping        (default src/capture.ts)
  --host <port>      the page that loads it   (default ${DEFAULT_HOST_PORT})
  --bundles-port <p> the game's code origin   (default ${DEFAULT_BUNDLES_PORT})
  --game <id>      publish: the game to upload to
  --api <origin>   publish: the platform    (default ${DEFAULT_API_ORIGIN},
                   or ${API_ORIGIN_VARIABLE})

  publish reads the studio's secret key from ${STUDIO_KEY_VARIABLE}, and exits 0
  only when the version went live.
`

function sourceOf(options: Options): GameSource {
  return {
    root: options.dir,
    simEntry: options.simEntry,
    presentEntry: options.presentEntry,
    captureEntry: options.captureEntry,
  }
}

/**
 * Writes the three files an upload carries.
 *
 * The page module is written unrewritten, with its `cw2:sim` specifier
 * intact. The platform rewrites it to the simulation's content address on the
 * way in, so a page module that arrived already pointing somewhere would be
 * one naming a module nobody checked.
 */
async function build(options: Options): Promise<void> {
  const { sim, present } = await buildGameArtifacts(sourceOf(options))
  const manifest = await readManifestFromSim(sim)
  const dist = join(options.dir, DIST_DIR)
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  await writeFile(join(dist, DIST_FILES.sim), sim)
  await writeFile(join(dist, DIST_FILES.present), present)
  await writeFile(
    join(dist, DIST_FILES.manifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  process.stdout.write(
    `sim ${sim.byteLength} bytes, page module ${present.byteLength} bytes\n`,
  )
}

async function dev(options: Options): Promise<void> {
  // Built first, so the manifest beside the artifacts is this build's.
  await build(options)
  const harness = await startHarness({
    source: sourceOf(options),
    hostPort: options.hostPort,
    bundlesPort: options.bundlesPort,
  })
  process.stdout.write(
    `\n  play     ${harness.hostOrigin}\n` +
      `  bundles  ${harness.bundlesOrigin}\n` +
      `  sim      ${harness.built.simSha256.slice(0, 12)}\n` +
      `  present  ${harness.built.presentSha256.slice(0, 12)}\n\n` +
      "  Ctrl-C to stop.\n",
  )
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  switch (options.command) {
    case "new": {
      const made = await createGame({ dir: options.dir })
      process.stdout.write(
        `${made.dir}\n\n` +
          `  ${made.id}, which is the id its board will be kept under\n\n` +
          "  bun install\n" +
          "  bun run dev\n\n",
      )
      return 0
    }
    case "build":
      await build(options)
      return 0
    case "dev":
      await dev(options)
      // Resolves only when the process is killed: the servers are the point.
      await new Promise(() => {})
      return 0
    case "publish": {
      const settings = publishSettings(
        { dir: options.dir, game: options.game, api: options.api },
        process.env,
      )
      const status = await publish(settings, {
        fetch: (url, init) => fetch(url, init),
        sleep: (ms) => Bun.sleep(ms),
        now: () => Date.now(),
        log: (line) => process.stdout.write(`${line}\n`),
      })
      const verdict = verdictOf(status)
      for (const line of verdict.lines) process.stdout.write(`${line}\n`)
      return verdict.exitCode
    }
    default:
      process.stdout.write(USAGE)
      return options.command === "" ? 0 : 1
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exit(code)
    })
    .catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`)
      process.exit(1)
    })
}
