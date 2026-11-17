/**
 * The ports the suite runs on, in one place.
 *
 * Fixed rather than port 0: Playwright's `webServer` waits on a URL it was
 * given before any test runs, so the ports have to be knowable before the
 * process that binds them exists. The two stand-ins for the platform take any
 * free port, because a page reads where they are from its own `config.json`.
 */

export const CONTROL_PORT = 4319

/**
 * The games this suite drives, and why each one is here.
 *
 * `template` is what `vbz new` copies: a game that draws its own two buttons
 * and takes keys and a controller. `paddle` reads tilt, and maps Space, which
 * is what the spec about a focused Play button needs. Each is served by the
 * harness an author runs, on a page origin and a bundles origin of its own,
 * and each also plays on the suite's studio page.
 */
export const SUBJECTS = {
  template: {
    dir: ["packages", "sdk", "templates", "game"],
    hostPort: 4320,
    bundlesPort: 4321,
    /** The id the studio page serves the game under. */
    gameId: "00000000-0000-4000-8000-000000000001",
  },
  paddle: {
    dir: ["fixtures", "paddle"],
    hostPort: 4322,
    bundlesPort: 4323,
    gameId: "00000000-0000-4000-8000-000000000002",
  },
} as const

export type SubjectName = keyof typeof SUBJECTS

/**
 * The suite's studio page, standing in for a page a studio serves its game
 * from, and the bundles origin it loads games from, standing in for the
 * platform's.
 */
export const STUDIO_PORT = 4324
export const STUDIO_BUNDLES_PORT = 4325

/**
 * A page on another origin that frames the studio's page, standing in for a
 * portal a studio's game is embedded in.
 */
export const PORTAL_PORT = 4326

/**
 * The host the stand-ins' sign-ins are reached by. Every other server is
 * 127.0.0.1, and `localhost` is another site from it, so the studio's page
 * frames a sign-in on another site, as a studio's page frames the
 * platform's.
 */
export const SIGN_IN_HOST = "localhost"

/**
 * How long the studio page's client gives each page of the sign-in to say
 * it is ready: 3 seconds, against the 15 a studio's page gets by default, so
 * a spec about a box nothing fills waits seconds rather than a quarter of a
 * minute per engine. Every sign-in here is on this machine.
 */
export const SUITE_SIGN_IN_READY_MS = 3_000

export const CONTROL_ORIGIN = `http://127.0.0.1:${CONTROL_PORT}`
export const STUDIO_ORIGIN = `http://127.0.0.1:${STUDIO_PORT}`
export const PORTAL_ORIGIN = `http://127.0.0.1:${PORTAL_PORT}`

export function hostOrigin(name: SubjectName): string {
  return `http://127.0.0.1:${SUBJECTS[name].hostPort}`
}

export function bundlesOrigin(name: SubjectName): string {
  return `http://127.0.0.1:${SUBJECTS[name].bundlesPort}`
}
