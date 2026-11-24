/**
 * A studio's own server's client for the vbz.gg platform: asking who a
 * player's token names, with the studio's secret key, and the studio's other
 * secret-key routes that take JSON.
 *
 * For a server alone. It reads no environment and no browser, and refuses to
 * be made on a page. The refusals are the page client's own classes, so a
 * server switches on `code` the way a page does.
 */

export {
  PlatformClientError,
  PlatformRefusal,
  worthRetrying,
} from "../platform/errors.js"
export type { RouteFetch, RouteOptions } from "../platform/request.js"
export {
  createServerClient,
  type ServerClient,
  type ServerClientOptions,
  type ServerRequester,
  type ServerRoute,
} from "./client.js"
