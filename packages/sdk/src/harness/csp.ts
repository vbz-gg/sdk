/**
 * The Content-Security-Policy the harness serves its pages under.
 *
 * It is the policy a studio's page is meant to run a game under: scripts
 * from the page's own origin and from one game's own path on the bundles
 * origin and nowhere else, no `unsafe-eval` and no inline script. A page
 * module that needs either, or a rules code it cannot import under it, is
 * refused here, on a laptop, rather than on a studio's page. Naming the
 * game's path rather than the whole bundles origin is what keeps another
 * game's code out of the page. In production the bundles origin is
 * `https://files.vbz.gg`, so a studio's page names
 * `https://files.vbz.gg/g/<game id>/`.
 */

export interface PageCspOptions {
  /** Where the game's two modules are served from. */
  readonly bundlesOrigin: string
  /** The game whose path the page may load scripts from. */
  readonly gameId: string
  /** Origins the page's own code talks to, beside its own. */
  readonly connect?: readonly string[]
}

/** The path every module of one game is served under. */
export function gamePath(bundlesOrigin: string, gameId: string): string {
  return `${bundlesOrigin}/g/${gameId}/`
}

export function pageCsp(options: PageCspOptions): string {
  return [
    "default-src 'none'",
    `script-src 'self' ${gamePath(options.bundlesOrigin, options.gameId)}`,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    ["connect-src 'self'", ...(options.connect ?? [])].join(" "),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ")
}
