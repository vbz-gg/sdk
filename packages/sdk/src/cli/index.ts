#!/usr/bin/env bun
/**
 * `vbz`, the commands an author runs.
 *
 * `build` produces what a page plays and a host serves. `dev` serves the game
 * the way production serves it, on two origins, so the first time a game's
 * page module is imported from another origin is on a laptop.
 *
 * Entry points are excluded from the coverage floor, so everything with a
 * decision in it lives beside this file rather than in it.
 */

import {
  DEFAULT_BUNDLES_PORT,
  DEFAULT_HOST_PORT,
  HARNESS_GAME_ID,
  HARNESS_SEED,
  startHarness,
  startSite,
} from "../harness/index.js"
import { DEFAULT_ADDRESS, type Flag, type Options, parseArgs } from "./args.js"
import {
  addressBuild,
  addressedLines,
  addressingOf,
  buildGame,
  buildLines,
  writeAddressed,
  writeBuild,
} from "./build.js"
import { type Command, usageText } from "./commands.js"
import { devSettings } from "./dev.js"
import { failureLine } from "./failure.js"
import { GUIDES, guideLines, refreshGuides, SKILLS_DIR } from "./guides.js"
import { createGame } from "./new.js"
import {
  API_ORIGIN_VARIABLE,
  DEFAULT_API_ORIGIN,
  failureLines,
  PublishError,
  publish,
  publishSettings,
  STUDIO_KEY_VARIABLE,
  verdictOf,
} from "./publish.js"
import { needsOf, sourceOf } from "./source.js"

/** Everything the usage says after the commands: the flags, and publish's key. */
const FLAGS = `  --sim <path>       the simulation's entry   (default src/sim/index.ts)
  --present <path>   the page module's entry  (default src/present.ts)
  --capture <path>   the input mapping        (default src/capture.ts)
  --addressed        build: also write dist/addressed/, every file at the
                     content-addressed path a page on another origin loads
                     it from, to serve as it is from the root of that origin,
                     and dist/addressed.json, what such a page needs to load it
  --host <port>      dev: the page that loads it   (default ${DEFAULT_HOST_PORT})
  --bundles-port <p> dev: the game's code origin   (default ${DEFAULT_BUNDLES_PORT})
  --address <host>   dev: where both listen, and the host their origins name
                     (default ${DEFAULT_ADDRESS}); another machine's needs --https
  --https            dev: serve https, with --cert <file> and --key <file> (PEM)
  --site             dev: serve the game's site/ in the mode its config.json
                     names: local, with the build beside it as /game/, or
                     ranked on vbz.gg, against a stand-in for the platform,
                     which plays one local player and ranks nothing
  --ranked           check: also what a ranked or practice run on vbz.gg needs:
                     the seed changes the state, and the manifest says how a
                     run ranks
                     dev: hold each run to a vbz.gg ranked run's input budget
  --config <file>    dev: a JSON config for the page's runs to play, in place
                     of every setting at its default
  --game <id>        build --addressed: the game id its paths name, a UUID
                     written lowercase; by default one made from the
                     manifest's id, the same for every version
                     publish: the game on vbz.gg to upload to
  --api <origin>     publish: the platform    (default ${DEFAULT_API_ORIGIN},
                     or ${API_ORIGIN_VARIABLE})

  publish is for a game on vbz.gg alone; nothing else needs it. It reads the
  studio's secret key from ${STUDIO_KEY_VARIABLE}, and exits 0 when the version
  passed its checks and is published, printing which runs it serves; anything
  else, a version an operator took down included, is 1.
`

/**
 * Writes the build, and with an addressing the build at its content
 * addresses too, and says what it wrote. Both are worked out before anything
 * is written, so a game id that cannot be made leaves the last build as it
 * was.
 */
async function build(
  options: Options,
  addressing: ReturnType<typeof addressingOf> = null,
): Promise<void> {
  const built = await buildGame(await sourceOf(options))
  const addressed =
    addressing === null ? null : addressBuild(built, addressing.gameId)
  await writeBuild(options.dir, built)
  for (const line of buildLines(built)) process.stdout.write(`${line}\n`)
  if (addressed !== null) {
    await writeAddressed(options.dir, addressed)
    for (const line of addressedLines(addressed)) {
      process.stdout.write(`${line}\n`)
    }
  }
}

async function dev(options: Options): Promise<void> {
  // Checked first, so a flag that cannot work stops before anything builds.
  const settings = await devSettings(options)
  // Built next, so the manifest beside the artifacts is this build's.
  await build(options)
  if (settings.site) {
    const site = await startSite({
      source: await sourceOf(options),
      needs: await needsOf(options.dir),
      gameId: HARNESS_GAME_ID,
      seed: HARNESS_SEED,
      hostPort: settings.hostPort,
      bundlesPort: settings.bundlesPort,
      listen: settings.listen,
      log: (line) => process.stdout.write(`${line}\n`),
    })
    process.stdout.write(
      site.mode === "local"
        ? `\n  site     ${site.siteOrigin}  (played locally: the build as ${site.siteOrigin}/game/)\n\n` +
            "  Ctrl-C to stop.\n"
        : `\n  site     ${site.siteOrigin}\n` +
            `  bundles  ${site.bundlesOrigin}\n` +
            `  api      ${site.apiOrigin}  (a stand-in: one local player, no replay, no ranking)\n` +
            `  sign-in  ${site.signInOrigin}\n\n` +
            "  Ctrl-C to stop.\n",
    )
    return
  }
  const harness = await startHarness({
    source: await sourceOf(options),
    hostPort: settings.hostPort,
    bundlesPort: settings.bundlesPort,
    listen: settings.listen,
    ranked: settings.ranked,
    needs: await needsOf(options.dir),
    ...(settings.config === undefined ? {} : { config: settings.config }),
  })
  process.stdout.write(
    `\n  play     ${harness.hostOrigin}\n` +
      `  bundles  ${harness.bundlesOrigin}\n` +
      `  sim      ${harness.built.simSha256.slice(0, 12)}\n` +
      `  present  ${harness.built.presentSha256.slice(0, 12)}\n\n` +
      "  Ctrl-C to stop.\n",
  )
}

async function newGame(options: Options): Promise<number> {
  const made = await createGame({ dir: options.dir })
  process.stdout.write(
    `${made.dir}\n\n` +
      `  ${made.id}, the game's id, from the directory name; a board on vbz.gg\n` +
      "  keeps it for good if you publish the game there\n\n" +
      guideLines(made.guides)
        .map((line) => `  ${line}\n`)
        .join("") +
      "  AGENTS.md says where they are, for an agent\n\n" +
      "  bun install\n" +
      "  bun run dev\n\n",
  )
  return 0
}

async function guides(options: Options): Promise<number> {
  for (const line of guideLines(await refreshGuides(options.dir))) {
    process.stdout.write(`${line}\n`)
  }
  return 0
}

async function check(options: Options): Promise<number> {
  // Loaded here and by no other command: the engine's checks read code
  // with TypeScript, which a game has only once its own install has run,
  // and `vbz new` runs before that.
  const { checkGame, checkLines } = await import("./check.js")
  const checked = await checkGame(await sourceOf(options), {
    ranked: options.ranked,
  })
  for (const line of checkLines(checked, options.captureEntry)) {
    process.stdout.write(`${line}\n`)
  }
  return checked.ok ? 0 : 1
}

async function serve(options: Options): Promise<number> {
  await dev(options)
  // Resolves only when the process is killed: the servers are the point.
  await new Promise(() => {})
  return 0
}

async function upload(options: Options): Promise<number> {
  const settings = publishSettings(
    { dir: options.dir, game: options.game, api: options.api },
    process.env,
  )
  let status: Awaited<ReturnType<typeof publish>>
  try {
    status = await publish(settings, {
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => Bun.sleep(ms),
      now: () => Date.now(),
      log: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    if (!(error instanceof PublishError)) throw error
    for (const line of failureLines(error)) {
      process.stderr.write(`${line}\n`)
    }
    return 1
  }
  const verdict = verdictOf(status)
  for (const line of verdict.lines) process.stdout.write(`${line}\n`)
  return verdict.exitCode
}

/** Where the game's code is, which every command that builds it reads. */
const ENTRY_FLAGS = ["sim", "present", "capture"] as const satisfies Flag[]

/**
 * Every command `vbz` takes, in the order its usage lists them, with the
 * flags each reads. The dispatcher, the parser, the usage and the agent
 * guide's test all read this, so a new command is one row here.
 */
export const COMMANDS: readonly Command[] = [
  {
    name: "new",
    args: "[dir]",
    summary: ["copy a game that already conforms, and rename it"],
    flags: [],
    run: newGame,
  },
  {
    name: "guides",
    args: "[dir]",
    summary: [
      `replace ${GUIDES.map((guide) => `${SKILLS_DIR}/${guide.name}`).join(" and ")}`,
      "with the guides the game's installed kit and engine ship",
    ],
    flags: [],
    run: guides,
  },
  {
    name: "build",
    args: "[dir]",
    summary: [
      "write dist/sim.js, dist/present.js, dist/manifest.json, and the",
      "files folder package.json names as dist/files/, listed in dist/files.json;",
      "with --addressed, dist/addressed/ too, for the root of another origin",
    ],
    flags: [...ENTRY_FLAGS, "addressed", "game"],
    run: async (options) => {
      // Checked first, so a --game that cannot work stops before anything builds.
      await build(options, addressingOf(options))
      return 0
    },
  },
  {
    name: "check",
    args: "[dir]",
    summary: [
      "run the engine's checks every game needs, or with --ranked the set",
      "ranked play on vbz.gg needs, and hold src/capture.ts to the manifest",
    ],
    flags: [...ENTRY_FLAGS, "ranked"],
    run: check,
  },
  {
    name: "dev",
    args: "[dir]",
    summary: ["serve the game to a page on another origin, and play it there"],
    flags: [
      ...ENTRY_FLAGS,
      "host",
      "bundles-port",
      "address",
      "https",
      "cert",
      "key",
      "site",
      "ranked",
      "config",
    ],
    run: serve,
  },
  {
    name: "publish",
    args: "[dir]",
    summary: ["for vbz.gg: upload dist/ and wait for the platform's verdict"],
    flags: ["game", "api"],
    run: upload,
  },
]

const USAGE = usageText(COMMANDS, FLAGS)

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv, COMMANDS)
  const command = COMMANDS.find((row) => row.name === options.command)
  if (command === undefined) {
    process.stdout.write(USAGE)
    return options.command === "" ? 0 : 1
  }
  return await command.run(options)
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exit(code)
    })
    .catch((error: unknown) => {
      process.stderr.write(`${failureLine(error)}\n`)
      process.exit(1)
    })
}
