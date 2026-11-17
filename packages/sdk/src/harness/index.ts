/**
 * The harness: your game, loaded the way a studio's page loads it.
 *
 * It builds the two real artifacts, serves them content-addressed at the
 * paths and with the headers the platform's edge uses, and serves a page on a
 * second origin that loads the page module from there with `loadGame`, under
 * the Content-Security-Policy a studio's page is meant to send, and plays it
 * through the module's own `mount` on a fixed seed. The point is that the
 * first time a game meets a cross-origin module import under that policy
 * should be on a laptop rather than on a studio's page.
 *
 * When a run ends the page sends its recording back, and the harness replays
 * it against the built rules code, holds its inputs to the manifest with
 * `checkInputs` and its budget, and says how big it is. It settles and ranks
 * nothing: a pass here says the platform's replay would agree, not what the
 * run would score on a board.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  assertManifest,
  hashCanonical,
  type Manifest,
  type ParamValues,
  type PlainValue,
} from "@clockwork2/engine"
import { DIST_DIR, DIST_FILES } from "../build/dist.js"
import type { GameSource } from "../build/index.js"
import { type BuiltGame, blobKeys, buildAndAddress } from "./artifacts.js"
import { CONFIG_WITH_RANKED, givenConfig, servedOrRefused } from "./config.js"
import { type DeclaredNeeds, pageCsp, versionNeeds } from "./csp.js"
import { readBuiltManifest } from "./dist-manifest.js"
import { HARNESS_STYLE, harnessPage } from "./page/document.js"
import { replayInChild } from "./replay.js"
import {
  type Listen,
  LOOPBACK,
  startBundleServer,
  startHostServer,
} from "./servers.js"

export interface HarnessOptions {
  readonly source: GameSource
  readonly hostPort?: number
  readonly bundlesPort?: number
  /** Where both servers listen, and over what. This machine, over http, by default. */
  readonly listen?: Listen
  /** The seed the run is played on. Fixed, so a session is repeatable. */
  readonly seed?: string
  /** Every path the bundles origin was asked for, for a test. */
  readonly onRequest?: (path: string) => void
  /**
   * Whether the page's report holds a run's inputs to the budget a ranked or
   * practice run is held to, `vbz dev --ranked`, or says it as a figure.
   */
  readonly ranked: boolean
  /**
   * What the game says it needs of the page's policy, beyond its two
   * modules; what its build shows is added.
   */
  readonly needs?: DeclaredNeeds
  /**
   * A config of the author's own for the page's runs, `vbz dev --config`,
   * held to the manifest's settings. The served config by default, which a
   * game with a required setting that has no default cannot be served, and
   * which a ranked run always plays, so `ranked` refuses one given here.
   */
  readonly config?: unknown
}

export interface Harness {
  readonly hostOrigin: string
  readonly bundlesOrigin: string
  readonly built: BuiltGame
  /** The page module's absolute address, as the platform would hand it out. */
  readonly presentUrl: string
  /** The policy the page is served under. */
  readonly csp: string
  stop(): Promise<void>
}

/** Where the page sends a run's recording for the harness's report on it. */
export const REPLAY_PATH = "/replay"

export const DEFAULT_HOST_PORT = 4310
export const DEFAULT_BUNDLES_PORT = 4311

/**
 * The game id the harness serves under. The platform issues each game a
 * UUID and every path names it; a game on a laptop has none, so it gets
 * this one.
 */
export const HARNESS_GAME_ID = "00000000-0000-4000-8000-000000000000"

/**
 * A seed that does not move between runs.
 *
 * The platform's is a keyed HMAC of the game and the day, so every player gets
 * the same one; here a constant does the same job, which is that a run an
 * author is debugging is the run they had a moment ago.
 */
export const HARNESS_SEED = "harness"

export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const built = await buildAndAddress(options.source, HARNESS_GAME_ID)
  const manifest = await readManifest(options.source.root)
  const config = configToPlay(manifest, options)
  const listen = options.listen ?? LOOPBACK

  const title = manifest.name

  // Bound first, because the page has to name the bundles origin and an
  // origin is the port the socket got rather than the port it was asked for.
  // The host's page is written last, once both are known.
  const host = startHostServer({
    port: options.hostPort ?? DEFAULT_HOST_PORT,
    script: await bundlePage(),
    style: HARNESS_STYLE,
    listen,
    routes: {
      [REPLAY_PATH]: async (request) => {
        if (request.method !== "POST") {
          return new Response("POST a recording", { status: 405 })
        }
        const report = await replayInChild(
          built.sim,
          manifest,
          await request.text(),
          packsOf(manifest, built.filesOnDisk),
        )
        return Response.json(report, {
          headers: { "cache-control": "no-store" },
        })
      },
    },
  })

  const bundles = startBundleServer({
    port: options.bundlesPort ?? DEFAULT_BUNDLES_PORT,
    built,
    listen,
    ...(options.onRequest === undefined ? {} : { log: options.onRequest }),
  })
  const keys = blobKeys(built)
  const presentUrl = `${bundles.origin}/${keys.present}`
  const filesUrl = `${bundles.origin}/${keys.files}`
  const csp = pageCsp({
    bundlesOrigin: bundles.origin,
    gameId: HARNESS_GAME_ID,
    // The harness page plays local runs, and signs nobody in.
    signInOrigin: null,
    needs: versionNeeds(options.needs ?? {}, built),
  })

  host.setPage(
    harnessPage({
      title,
      config: {
        presentUrl,
        // What the platform would compute from the uploaded manifest, so a
        // page module carrying another one is refused here as it would be on
        // a studio's page.
        manifestHash: hashCanonical(manifest as unknown as PlainValue),
        filesUrl,
        title,
        seed: options.seed ?? HARNESS_SEED,
        tickHz: manifest.session.tickHz,
        config,
        replayPath: REPLAY_PATH,
        ranked: options.ranked,
      },
    }),
    csp,
  )

  return {
    hostOrigin: host.origin,
    bundlesOrigin: bundles.origin,
    built,
    presentUrl,
    csp,
    stop: async () => {
      await Promise.all([host.stop(), bundles.stop()])
    },
  }
}

/**
 * What the page's runs play, decided before anything is served: the
 * author's own config, held to the manifest, or the served config, which a
 * ranked or practice run always plays.
 */
function configToPlay(
  manifest: Manifest,
  options: Pick<HarnessOptions, "config" | "ranked">,
): ParamValues {
  if (options.config === undefined) {
    return servedOrRefused(
      manifest,
      options.ranked
        ? "a ranked run plays every setting at its default, so give each one a default in the manifest"
        : "give vbz dev a config to play with --config <file>, or give each setting a default in the manifest",
    )
  }
  if (options.ranked) throw new Error(CONFIG_WITH_RANKED)
  return givenConfig(manifest, options.config, "--config")
}

/**
 * The manifest `vbz build` wrote, as the harness reads it: held to the
 * engine's schema, so a game with no build on disk stops here, with the
 * engine's own refusal, rather than serving a page that plays nothing.
 */
async function readManifest(root: string): Promise<Manifest> {
  const built = await readBuiltManifest(root)
  try {
    return assertManifest(built)
  } catch (error) {
    throw new Error(
      `the harness plays the manifest vbz build wrote to ${DIST_DIR}/${DIST_FILES.manifest}, and there is none to play: ${error instanceof Error ? error.message : String(error)}; run vbz build first`,
    )
  }
}

/**
 * The data packs the manifest declares, by path, at where each is on disk in
 * the files folder, for the replay of a run.
 */
export function packsOf(
  manifest: Manifest,
  onDisk: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const packs = new Map<string, string>()
  for (const asset of manifest.assets ?? []) {
    const at = onDisk.get(asset.path)
    if (asset.requiredForSim && at !== undefined) packs.set(asset.path, at)
  }
  return packs
}

/**
 * The page script's own entry, wherever this module is running from.
 *
 * In this repository that is `page/main.ts` beside the source. In an installed
 * copy it is `page/main.js` in `dist`, because `tsc` compiles TypeScript and
 * does not copy it - so a hard-coded `.ts` builds nothing on every machine but
 * this one, and the harness fails at start with the bundler's error rather
 * than anything naming the cause.
 *
 * The directory is a parameter so the resolution can be tested against a tree
 * that holds one spelling or neither, rather than only against this one.
 */
export function harnessPageEntry(dir = join(import.meta.dir, "page")): string {
  for (const name of ["main.ts", "main.js"]) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`the harness page's entry is missing from ${dir}`)
}

/** The parent page's script, bundled for the browser at start. */
async function bundlePage(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [harnessPageEntry()],
    target: "browser",
    format: "esm",
    minify: false,
  })
  if (!result.success) {
    throw new Error(
      `the harness page did not build:\n${result.logs.map(String).join("\n")}`,
    )
  }
  const output = result.outputs[0]
  if (output === undefined) throw new Error("the harness page produced nothing")
  return await output.text()
}

export {
  type BuiltGame,
  blobKeys,
  buildAndAddress,
} from "./artifacts.js"
export {
  type DeclaredNeeds,
  type GameNeeds,
  gamePath,
  inlineScriptSource,
  localPageCsp,
  type PageCspOptions,
  pageCsp,
  versionNeeds,
} from "./csp.js"
export { escapeHtml, HARNESS_STYLE, harnessPage } from "./page/document.js"
export {
  type DevReport,
  type InputsReport,
  type Problem,
  type ReplayVerdict,
  replayInChild,
  replayRecording,
} from "./replay.js"
export { reportLines, reportPasses } from "./report.js"
export {
  type Listen,
  LOOPBACK,
  originOf,
  type Route,
  type RunningHostServer,
  type RunningServer,
  startBundleServer,
  startHostServer,
  type Tls,
} from "./servers.js"
export {
  inlineScriptsOf,
  LOCAL_GAME_PATH,
  type RunningSite,
  SITE_DIR,
  SITE_ENTRY,
  SITE_MODES,
  type SiteConfig,
  type SiteMode,
  type SiteOptions,
  siteFile,
  siteModeOf,
  startSite,
} from "./site.js"
export {
  LOCAL_PLAYER,
  type RunningStandIn,
  STAND_IN_LIMITS,
  STAND_IN_PAGE_KEY,
  STAND_IN_VERSION_ID,
  type StandInOptions,
  startStandIn,
} from "./stand-in.js"
