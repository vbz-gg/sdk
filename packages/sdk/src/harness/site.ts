/**
 * `vbz dev --site`: the game's own `site/`, served the way a studio serves
 * its page, against a stand-in for the platform.
 *
 * The site is a page like any studio's: `site/index.html`, its script
 * `site/main.ts`, and whatever else it needs beside them. Its script is
 * bundled for the browser and served as `/main.js`, every other file in
 * `site/` is served as it is, and `/config.json` answers with where the
 * stand-in's API and sign-in window are and the page key it takes, so the
 * page reads them the same way in production from a file of its own. The
 * page is served under the policy a studio's page is meant to send, naming
 * the game's path on the bundles origin and the API it talks to.
 *
 * The game is built and served from a bundles origin exactly as `vbz dev`
 * serves it, and the stand-in hands that build out as the version every run
 * plays, on the harness seed.
 */

import { existsSync } from "node:fs"
import { join, normalize, sep } from "node:path"
import { bundle } from "../build/build.js"
import type { GameSource } from "../build/index.js"
import { type BuiltGame, blobKeys, buildAndAddress } from "./artifacts.js"
import { pageCsp } from "./csp.js"
import { readBuiltManifest } from "./dist-manifest.js"
import {
  type Listen,
  LOOPBACK,
  originOf,
  serveOptions,
  startBundleServer,
} from "./servers.js"
import { startStandIn } from "./stand-in.js"

/** Where a game keeps its page, and the page's script. */
export const SITE_DIR = "site"
export const SITE_ENTRY = "main.ts"

/** What `/config.json` holds: what a page needs to make its platform client. */
export interface SiteConfig {
  readonly apiOrigin: string
  readonly signInOrigin: string
  readonly pageKey: string
}

export interface SiteOptions {
  readonly source: GameSource
  /** The game id the bundles origin serves the game under. */
  readonly gameId: string
  readonly seed: string
  readonly hostPort: number
  readonly bundlesPort: number
  readonly listen?: Listen
  /** A line for the terminal, from the stand-in. */
  readonly log?: (line: string) => void
  /** For a test: the stand-in's ranked play and bar. */
  readonly ranked?: "open" | "paused"
  readonly barredUntil?: string | null
}

export interface RunningSite {
  readonly siteOrigin: string
  readonly bundlesOrigin: string
  readonly apiOrigin: string
  readonly signInOrigin: string
  readonly presentUrl: string
  readonly csp: string
  readonly config: SiteConfig
  readonly built: BuiltGame
  stop(): Promise<void>
}

const NO_STORE = "no-store"

/**
 * The file under `dir` a request path names, or null for one outside it,
 * however the path spells its way out.
 */
export function siteFile(dir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const path = normalize(join(dir, decoded))
  const inside = `${normalize(dir)}${sep}`
  return path.startsWith(inside) && path !== inside ? path : null
}

export async function startSite(options: SiteOptions): Promise<RunningSite> {
  const root = options.source.root
  const dir = join(root, SITE_DIR)
  if (!existsSync(join(dir, SITE_ENTRY))) {
    throw new Error(
      `--site serves the game's own page from ${SITE_DIR}/, and ${join(dir, SITE_ENTRY)} is not there`,
    )
  }
  const built = await buildAndAddress(options.source, options.gameId)
  const manifest = await readBuiltManifest(root)
  const script = new TextDecoder().decode(
    await bundle(root, `${SITE_DIR}/${SITE_ENTRY}`, []),
  )
  const listen = options.listen ?? LOOPBACK

  // The site is bound first: the stand-in lets one origin call it, and an
  // origin is the port the socket got.
  let config: SiteConfig | null = null
  let csp = ""
  const site = Bun.serve({
    ...serveOptions(listen, options.hostPort),
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      if (pathname === "/config.json") {
        return Response.json(config, { headers: { "cache-control": NO_STORE } })
      }
      if (pathname === "/main.js") {
        return new Response(script, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": NO_STORE,
          },
        })
      }
      if (pathname === "/" || pathname === "/index.html") {
        return new Response(Bun.file(join(dir, "index.html")), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": NO_STORE,
            "content-security-policy": csp,
          },
        })
      }
      const path = siteFile(dir, pathname)
      const file = path === null ? null : Bun.file(path)
      if (file === null || !(await file.exists())) {
        return new Response("not found", { status: 404 })
      }
      return new Response(file, { headers: { "cache-control": NO_STORE } })
    },
  })
  const siteOrigin = originOf(listen, site.port ?? options.hostPort)

  const bundles = startBundleServer({
    port: options.bundlesPort,
    built,
    listen,
  })
  const keys = blobKeys(built)
  const presentUrl = `${bundles.origin}/${keys.present}`
  const standIn = startStandIn({
    manifest,
    presentUrl,
    filesUrl: `${bundles.origin}/${keys.files}`,
    gameId: options.gameId,
    siteOrigin,
    seed: options.seed,
    listen,
    ...(options.log === undefined ? {} : { log: options.log }),
    ...(options.ranked === undefined ? {} : { ranked: options.ranked }),
    ...(options.barredUntil === undefined
      ? {}
      : { barredUntil: options.barredUntil }),
  })
  config = {
    apiOrigin: standIn.apiOrigin,
    signInOrigin: standIn.signInOrigin,
    pageKey: standIn.pageKey,
  }
  csp = pageCsp({
    bundlesOrigin: bundles.origin,
    gameId: options.gameId,
    connect: [standIn.apiOrigin],
  })

  return {
    siteOrigin,
    bundlesOrigin: bundles.origin,
    apiOrigin: standIn.apiOrigin,
    signInOrigin: standIn.signInOrigin,
    presentUrl,
    csp,
    config,
    built,
    stop: async () => {
      await Promise.all([site.stop(true), bundles.stop(), standIn.stop()])
    },
  }
}
