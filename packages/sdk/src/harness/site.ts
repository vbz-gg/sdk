/**
 * `vbz dev --site`: the game's own `site/`, served the way a studio serves
 * its page, in the mode its `site/config.json` names.
 *
 * The site is a page like any studio's: `site/index.html`, its script
 * `site/main.ts`, and whatever else it needs beside them. Its script is
 * bundled for the browser and served as `/main.js`, and every other file in
 * `site/` is served as it is.
 *
 * Played locally, `{ "mode": "local" }`, the build `vbz build` wrote is
 * served beside the page as `/game/`, the way a plain static host would
 * serve `dist/`, and the page talks to nobody. It is served under the policy
 * for a page playing its own game, `localPageCsp`.
 *
 * Ranked, `{ "mode": "ranked", ... }`, `/config.json` answers with where the
 * stand-in's API and sign-in window are and the page key it takes, so the
 * page reads them the same way in production from a file of its own. The
 * game is built and served from a bundles origin exactly as `vbz dev` serves
 * it, the stand-in hands that build out as the version every run plays, on
 * the harness seed, and the page is served under the policy a studio's page
 * is meant to send, naming the game's path and the API it talks to.
 *
 * Either way an inline script the page carries, such as the import map a
 * page playing locally maps `cw2:sim` with, is admitted by its hash.
 */

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join, normalize, sep } from "node:path"
import { bundle } from "../build/build.js"
import { DIST_DIR, DIST_FILES } from "../build/dist.js"
import type { GameSource } from "../build/index.js"
import { contentTypeFor } from "../serve/blobs.js"
import { type BuiltGame, blobKeys, buildAndAddress } from "./artifacts.js"
import {
  type DeclaredNeeds,
  localPageCsp,
  pageCsp,
  versionNeeds,
} from "./csp.js"
import { readBuiltManifest, readBuiltPresent } from "./dist-manifest.js"
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

/** The modes a site's `config.json` names. */
export const SITE_MODES = ["local", "ranked"] as const

export type SiteMode = (typeof SITE_MODES)[number]

/**
 * What `/config.json` holds: the mode, and for ranked play what a page needs
 * to make its platform client.
 */
export type SiteConfig =
  | { readonly mode: "local" }
  | {
      readonly mode: "ranked"
      readonly apiOrigin: string
      readonly signInOrigin: string
      readonly pageKey: string
    }

/** Where a site playing locally is served the build: `dist/` as `/game/`. */
export const LOCAL_GAME_PATH = "/game/"

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
  /**
   * What the game says it needs of the page's policy, beyond its two
   * modules; what its build shows is added.
   */
  readonly needs?: DeclaredNeeds
  /** For a test: the stand-in's ranked play and bar. */
  readonly ranked?: "open" | "paused"
  readonly barredUntil?: string | null
}

export interface RunningSite {
  readonly mode: SiteMode
  readonly siteOrigin: string
  /** Ranked: where the game's code is served from. Null played locally. */
  readonly bundlesOrigin: string | null
  /** Ranked: the stand-in's origins. Null played locally. */
  readonly apiOrigin: string | null
  readonly signInOrigin: string | null
  readonly presentUrl: string
  readonly csp: string
  readonly config: SiteConfig
  stop(): Promise<void>
}

const NO_STORE = "no-store"

/**
 * The mode a site's own `config.json` names, read before anything is
 * served. A file naming none is refused rather than read as either.
 */
export async function siteModeOf(dir: string): Promise<SiteMode> {
  const where = join(dir, "config.json")
  let config: unknown
  try {
    config = JSON.parse(await readFile(where, "utf8"))
  } catch (error) {
    throw new Error(
      `--site reads the page's mode from ${where}, which could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const mode = (config as { readonly mode?: unknown } | null)?.mode
  const known = SITE_MODES.find((name) => name === mode)
  if (known === undefined) {
    throw new Error(
      `${where} names its mode: "local", to play with no platform, or "ranked", against the platform`,
    )
  }
  return known
}

/** The text of every import map, or other inline script, the page carries. */
export function inlineScriptsOf(html: string): string[] {
  const scripts: string[] = []
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    const attributes = match[1] ?? ""
    const text = match[2] ?? ""
    // A script with a source is not inline, and JSON data never runs.
    if (/\bsrc\s*=/i.test(attributes)) continue
    if (/type\s*=\s*["']?application\/json/i.test(attributes)) continue
    if (text.trim() === "") continue
    scripts.push(text)
  }
  return scripts
}

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
  const mode = await siteModeOf(dir)
  const html = await readFile(join(dir, "index.html"), "utf8").catch(() => "")
  const inlineScripts = inlineScriptsOf(html)
  const script = new TextDecoder().decode(
    await bundle(root, `${SITE_DIR}/${SITE_ENTRY}`, []),
  )
  const listen = options.listen ?? LOOPBACK
  const needs = options.needs ?? {}

  // The site is bound first: the stand-in lets one origin call it, and an
  // origin is the port the socket got.
  let config: SiteConfig = { mode: "local" }
  let csp = ""
  const dist = join(root, DIST_DIR)
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
      // Played locally, the build as vbz build wrote it, as a static host
      // serves `dist/`.
      if (mode === "local" && pathname.startsWith(LOCAL_GAME_PATH)) {
        const path = siteFile(dist, pathname.slice(LOCAL_GAME_PATH.length - 1))
        const file = path === null ? null : Bun.file(path)
        if (file === null || !(await file.exists())) {
          return new Response("not found", { status: 404 })
        }
        return new Response(file, {
          headers: {
            "content-type": contentTypeFor(pathname),
            "cache-control": NO_STORE,
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

  if (mode === "local") {
    config = { mode: "local" }
    const { imports, listing } = await readBuiltPresent(root)
    csp = localPageCsp({
      needs: versionNeeds(needs, { workers: imports.workers, files: listing }),
      inlineScripts,
    })
    return {
      mode,
      siteOrigin,
      bundlesOrigin: null,
      apiOrigin: null,
      signInOrigin: null,
      presentUrl: `${siteOrigin}${LOCAL_GAME_PATH}${DIST_FILES.present}`,
      csp,
      config,
      stop: async () => {
        await site.stop(true)
      },
    }
  }

  const built: BuiltGame = await buildAndAddress(options.source, options.gameId)
  const manifest = await readBuiltManifest(root)
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
    mode: "ranked",
    apiOrigin: standIn.apiOrigin,
    signInOrigin: standIn.signInOrigin,
    pageKey: standIn.pageKey,
  }
  csp = pageCsp({
    bundlesOrigin: bundles.origin,
    gameId: options.gameId,
    connect: [standIn.apiOrigin],
    signInOrigin: standIn.signInOrigin,
    needs: versionNeeds(needs, built),
    inlineScripts,
  })

  return {
    mode,
    siteOrigin,
    bundlesOrigin: bundles.origin,
    apiOrigin: standIn.apiOrigin,
    signInOrigin: standIn.signInOrigin,
    presentUrl,
    csp,
    config,
    stop: async () => {
      await Promise.all([site.stop(true), bundles.stop(), standIn.stop()])
    },
  }
}
