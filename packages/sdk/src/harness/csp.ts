/**
 * The Content-Security-Policy the harness serves its pages under.
 *
 * It is the policy a studio's page is meant to run a game under: scripts
 * from the page's own origin and from one game's own path on the bundles
 * origin and nowhere else, no `unsafe-eval` and no inline script but the
 * ones named by hash. A page module that needs more, or a rules code it
 * cannot import under it, is refused here, on a laptop, rather than on a
 * studio's page. Naming the game's path rather than the whole bundles
 * origin is what keeps another game's code out of the page. In production
 * the bundles origin is `https://files.vbz.gg`, so a studio's page names
 * `https://files.vbz.gg/g/<game id>/`.
 *
 * A version may need more than its two modules, and each need is named, so
 * a page allows what its game uses and nothing else. A renderer that
 * compiles WebAssembly needs `'wasm-unsafe-eval'`, which compiles WebAssembly
 * and evaluates no JavaScript, so `unsafe-eval` stays out whatever a game
 * needs. One that starts workers needs `worker-src blob:` and the game's
 * path. One that fetches its own files, data packs or art needs the game's
 * path in `connect-src`, and a version whose folder lists any file is one:
 * a page module of contract 2 fetches every data pack the manifest declares
 * from the folder, and the folder holds every one.
 *
 * A page that signs a player in frames the platform's sign-in, so its
 * policy names the sign-in origin in `frame-src`. Measured in Chromium and
 * Firefox: under `default-src 'none'` with no `frame-src` the frame is never
 * requested. A page that signs nobody in, such as the harness's, names none
 * and frames nothing.
 */

import type { FilesListing } from "../build/files.js"

/** What a version needs of a page's policy, beyond its two modules. */
export interface GameNeeds {
  /** It compiles WebAssembly: `'wasm-unsafe-eval'` in `script-src`. */
  readonly wasm?: boolean
  /** It starts workers: `worker-src blob:` and the game's path. */
  readonly workers?: boolean
  /**
   * It fetches files of its folder: the game's path in `connect-src`. Any
   * version whose folder lists a file does.
   */
  readonly files?: boolean
}

/**
 * What a game says it needs, in its `package.json`: what its build cannot
 * show. Whether it fetches files of its folder is the folder's to show, so
 * it is never said.
 */
export type DeclaredNeeds = Omit<GameNeeds, "files">

interface PolicyOptions {
  /** Origins the page's own code talks to, beside its own. */
  readonly connect?: readonly string[]
  /** What the version needs beyond its two modules. Nothing by default. */
  readonly needs?: GameNeeds
  /**
   * Inline scripts the page carries, by their exact text, such as an import
   * map: each is allowed by its hash, and no other inline script is.
   */
  readonly inlineScripts?: readonly string[]
}

export interface PageCspOptions extends PolicyOptions {
  /** Where the game's two modules are served from. */
  readonly bundlesOrigin: string
  /** The game whose path the page may load scripts from. */
  readonly gameId: string
  /**
   * Where the platform's sign-in is, `https://signin.vbz.gg`, which the page
   * frames in its sign-in box; or null for a page that signs nobody in. Named
   * either way, so a page that signs players in cannot leave it out by
   * forgetting it.
   */
  readonly signInOrigin: string | null
}

/**
 * What a version needs of a page's policy: what its game says it needs, in
 * its `package.json`, held to what its build shows, and what the build
 * shows on its own. A page module that starts a worker cannot start one
 * under a policy without `worker-src`, so a game whose page module does is
 * refused until it says it needs workers. A folder that lists any file is
 * fetched from, so the game's path goes in `connect-src` whatever the game
 * says.
 */
export function versionNeeds(
  declared: DeclaredNeeds,
  build: { readonly workers: number; readonly files: FilesListing },
): GameNeeds {
  if (build.workers > 0 && declared.workers !== true) {
    throw new Error(
      `the page module starts a worker with new Worker ${build.workers === 1 ? "once" : `${build.workers} times`}, which a page's policy admits only with worker-src blob: and the game's path; say the game needs workers in its package.json, as "vbz": { "needs": { "workers": true } }`,
    )
  }
  return build.files.files.length > 0 ? { ...declared, files: true } : declared
}

/** The path every module and file of one game is served under. */
export function gamePath(bundlesOrigin: string, gameId: string): string {
  return `${bundlesOrigin}/g/${gameId}/`
}

/** The source that allows one inline script, by the SHA-256 of its exact text. */
export function inlineScriptSource(text: string): string {
  return `'sha256-${new Bun.CryptoHasher("sha256").update(text).digest("base64")}'`
}

/**
 * An origin, exactly: a scheme, a host and a port, with no path. It is
 * written into a header, where a `;` would start a directive of its own.
 */
export function assertOrigin(value: string, what: string): string {
  let origin: string | null = null
  try {
    origin = new URL(value).origin
  } catch {
    origin = null
  }
  if (origin !== value) {
    throw new Error(
      `${what} has to be an origin, such as https://signin.vbz.gg, and ${JSON.stringify(value)} is not one`,
    )
  }
  return value
}

/** The policy for a page whose game is served from `game`: a path, or `'self'`. */
function policy(
  game: string,
  options: PolicyOptions,
  signInOrigin: string | null,
): string {
  const needs = options.needs ?? {}
  const own = (sources: readonly string[]) =>
    [...new Set(["'self'", ...sources])].join(" ")
  return [
    "default-src 'none'",
    `script-src ${own([
      game,
      ...(needs.wasm === true ? ["'wasm-unsafe-eval'"] : []),
      ...(options.inlineScripts ?? []).map(inlineScriptSource),
    ])}`,
    ...(needs.workers === true ? [`worker-src blob: ${game}`] : []),
    "style-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src ${own([
      ...(needs.files === true ? [game] : []),
      ...(options.connect ?? []),
    ])}`,
    ...(signInOrigin === null
      ? []
      : [`frame-src ${assertOrigin(signInOrigin, "the sign-in origin")}`]),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ")
}

/** The policy for a studio's page playing a game served from the bundles origin. */
export function pageCsp(options: PageCspOptions): string {
  return policy(
    gamePath(options.bundlesOrigin, options.gameId),
    options,
    options.signInOrigin,
  )
}

/**
 * The policy for a page that serves its game from its own origin, as a game
 * played only on its own page does: everything the game loads is `'self'`,
 * and nobody signs in.
 */
export function localPageCsp(options: PolicyOptions = {}): string {
  return policy("'self'", options, null)
}
