/**
 * A studio's own server's client for the vbz.gg platform.
 *
 * A studio that runs a backend beside its game, for matches, coins or
 * anything else the platform does not hold, signs nobody in itself: its page
 * signs the player in on the platform and hands the server the player's
 * token, and the server asks the platform who the token names. This client
 * makes that call, and the studio's other secret-key routes that take JSON,
 * through `sendRoute`, keyed by `PlatformRoutes` as the page's client is.
 *
 * The secret key comes from the caller alone: nothing here reads the
 * environment, a file or a browser's storage. It is sent as
 * `Authorization: Bearer`, with no `Origin`, which is how the platform tells
 * a server from a browser, only over https or to this machine, and a client
 * is not made at all where a page's `document` is, because a key in a page's
 * code is a key anybody can read.
 */

import type {
  PlatformRoute,
  PlatformRoutes,
  SecretKey,
  VerifiedPlayer,
} from "../api/index.js"
import {
  type RouteFetch,
  type RouteOptions,
  sendRoute,
} from "../platform/request.js"
import {
  keyOriginOf,
  PAGE_KEY_PREFIX,
  SECRET_KEY_PREFIX,
} from "../wire/keys.js"

/**
 * The routes a studio's server calls: every secret-key route whose body is
 * JSON or nothing. A version's upload and a file's, whose bodies are a form
 * and bytes, are `vbz publish`'s.
 */
export type ServerRoute = {
  [Route in PlatformRoute]: PlatformRoutes[Route]["auth"] extends "secret-key"
    ? [PlatformRoutes[Route]["body"]] extends [never]
      ? Route
      : PlatformRoutes[Route]["body"] extends string
        ? never
        : Route
    : never
}[PlatformRoute]

export type ServerRequester = <Route extends ServerRoute>(
  route: Route,
  options: RouteOptions<Route>,
) => Promise<PlatformRoutes[Route]["response"]>

export interface ServerClientOptions {
  /**
   * Where the platform's API answers: `https://api.vbz.gg`. https, or http
   * to this machine, and the origin alone, because every request carries the
   * key.
   */
  readonly apiOrigin: string
  /** One of the studio's secret keys, `vbz_sk_...`, from the dashboard. */
  readonly secretKey: SecretKey
  /** The `fetch` to send with: the runtime's own by default. */
  readonly fetch?: RouteFetch
}

export interface ServerClient {
  /** Every route `ServerRoute` names, typed by `PlatformRoutes`. */
  readonly request: ServerRequester
  /**
   * Who a player's token names, as the key's studio sees them, and when the
   * token expires. A token that is not good at the key's studio, for any
   * reason, rejects with a `PlatformRefusal` whose code is
   * `E_PLAYER_TOKEN_INVALID`; the page that sent it signs the player in
   * again.
   */
  verifyPlayer(token: string): Promise<VerifiedPlayer>
}

export function createServerClient(options: ServerClientOptions): ServerClient {
  if ("document" in globalThis) {
    throw new Error(
      "a studio's secret key belongs on a server, and this is a page: anybody who loads it can read the key, so no client is made; verify a player from the studio's own server",
    )
  }
  const key: string = options.secretKey
  if (!key.startsWith(SECRET_KEY_PREFIX)) {
    throw new Error(
      key.startsWith(PAGE_KEY_PREFIX)
        ? "secretKey holds a page key, which is public and verifies nobody; use one of the studio's secret keys"
        : `secretKey is not a studio's secret key, which starts ${SECRET_KEY_PREFIX}`,
    )
  }
  const origin = keyOriginOf(options.apiOrigin)
  if (!origin.ok) {
    throw new Error(
      `the platform origin ${JSON.stringify(options.apiOrigin)} cannot be used: ${origin.problem}`,
    )
  }
  // Called as a plain function, because a runtime may refuse a `fetch`
  // called on another object.
  const send: RouteFetch = options.fetch ?? ((url, init) => fetch(url, init))
  const target = { apiOrigin: origin.origin, fetch: send }
  const credentials = { authorization: `Bearer ${key}` }

  const request: ServerRequester = (route, routeOptions) =>
    sendRoute(target, route, routeOptions, credentials)

  return {
    request,
    verifyPlayer: (token) =>
      request("POST /v1/players/verify", { body: { token } }),
  }
}
