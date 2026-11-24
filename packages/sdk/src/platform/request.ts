/**
 * One function for every request a page makes, keyed by the route table.
 *
 * The route is named the way `PlatformRoutes` names it, so a route the
 * platform does not declare does not compile, its path parameters and its
 * body are the ones the table gives, and the answer is typed by the table.
 * Only the page's routes are offered: a secret key's routes are for a build
 * system or a studio's own server and never belong in a page.
 *
 * `sendRoute` below is the one way either sends a route and reads its answer:
 * the page's requester here, and `/server`'s client with the studio's secret
 * key, so the two cannot build a path or read a refusal two ways.
 */

import type {
  ApiErrorBody,
  PageKey,
  PageKeyHeader,
  PlatformRoute,
  PlatformRoutes,
  PublicRefusalCode,
} from "../api/index.js"
import { PlatformClientError, PlatformRefusal } from "./errors.js"

/** The routes a page calls: every route but a secret key's. */
export type PageRoute = {
  [Route in PlatformRoute]: PlatformRoutes[Route]["auth"] extends "secret-key"
    ? never
    : Route
}[PlatformRoute]

type PathOf<Route extends string> = Route extends `${string} ${infer Path}`
  ? Path
  : never

type ParamNames<Path extends string> =
  Path extends `${string}:${infer Name}/${infer Rest}`
    ? Name | ParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Name}`
      ? Name
      : never

type ParamsOf<Route extends PlatformRoute> = [
  ParamNames<PathOf<Route>>,
] extends [never]
  ? { readonly params?: never }
  : { readonly params: Readonly<Record<ParamNames<PathOf<Route>>, string>> }

type BodyOf<Route extends PlatformRoute> = [
  PlatformRoutes[Route]["body"],
] extends [never]
  ? { readonly body?: never }
  : { readonly body: PlatformRoutes[Route]["body"] }

/** What any route's request carries: its path parameters, its body and a query. */
export type RouteOptions<Route extends PlatformRoute> = ParamsOf<Route> &
  BodyOf<Route> & {
    readonly query?: Readonly<Record<string, string | number | undefined>>
  }

export type RequestOptions<Route extends PageRoute> = RouteOptions<Route> & {
  /** The player's token, sent as `Authorization: Bearer`. */
  readonly token?: string | undefined
}

export type Requester = <Route extends PageRoute>(
  route: Route,
  options: RequestOptions<Route>,
) => Promise<PlatformRoutes[Route]["response"]>

export interface RequesterOptions {
  readonly apiOrigin: string
  readonly pageKey: PageKey
  readonly fetch: typeof fetch
}

const PAGE_KEY_HEADER: PageKeyHeader = "x-vbz-key"

/**
 * Each page route's credential, as `PlatformRoutes` declares it. A route the
 * table gains has to be named here with the same `auth`, or this fails to
 * compile, so whether a request carries the page key is the table's to say.
 */
const ROUTE_AUTH = {
  "GET /v1/game": "page-key",
  "POST /v1/oauth/token": "public",
  "POST /v1/runs": "player",
  "POST /v1/runs/:id/chunks": "player",
  "POST /v1/runs/:id/submit": "player",
  "GET /v1/runs/:id/result": "player",
  "GET /v1/runs/:id": "page-key",
  "GET /v1/board": "page-key",
} as const satisfies {
  readonly [Route in PageRoute]: PlatformRoutes[Route]["auth"]
}

export function createRequester(options: RequesterOptions): Requester {
  return (route, request) => {
    const headers: Record<string, string> = {}
    // A public route takes no key header: the code trade reads the page key
    // from its body, as `clientId`.
    if (ROUTE_AUTH[route] !== "public") {
      headers[PAGE_KEY_HEADER] = options.pageKey
    }
    if (request.token !== undefined) {
      headers.authorization = `Bearer ${request.token}`
    }
    return sendRoute(options, route, request, headers)
  }
}

/** What a route is sent through: `fetch`, or anything called the same way. */
export type RouteFetch = (url: string, init: RequestInit) => Promise<Response>

/** Where a request goes, and the `fetch` it goes through. */
export interface RouteTarget {
  /** An origin: scheme, host and port, nothing after. */
  readonly apiOrigin: string
  readonly fetch: RouteFetch
}

/**
 * Sends one route with the credential headers its caller gives, and reads
 * its answer: the route's response on a 2xx, a `PlatformRefusal` carrying
 * the platform's own code otherwise, and a `PlatformClientError` when no
 * answer came or the answer could not be read. No `credentials` and no
 * `Origin` of its own: the platform reads no cookie and sets none, and a
 * browser adds an `Origin` itself where it sends one.
 */
export async function sendRoute<Route extends PlatformRoute>(
  target: RouteTarget,
  route: Route,
  request: RouteOptions<Route>,
  credentials: Readonly<Record<string, string>>,
): Promise<PlatformRoutes[Route]["response"]> {
  const space = route.indexOf(" ")
  const method = route.slice(0, space)
  const template = route.slice(space + 1)
  const params = (request.params ?? {}) as Readonly<Record<string, string>>
  const path = template.replace(/:([a-zA-Z0-9]+)/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) {
      throw new Error(`${route} needs the path parameter ${name}`)
    }
    return encodeURIComponent(value)
  })

  const url = new URL(`${target.apiOrigin}${path}`)
  for (const [name, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value))
  }

  const headers: Record<string, string> = { ...credentials }
  if (request.body !== undefined) headers["content-type"] = "application/json"

  let response: Response
  try {
    response = await target.fetch(url.toString(), {
      method,
      headers,
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    })
  } catch (error) {
    throw new PlatformClientError("E_UNREACHABLE", { cause: error })
  }

  let answer: unknown
  try {
    answer = await response.json()
  } catch (error) {
    throw new PlatformClientError("E_ANSWER_UNREADABLE", {
      status: response.status,
      cause: error,
    })
  }
  if (response.ok) return answer as never
  if (!isErrorBody(answer)) {
    throw new PlatformClientError("E_ANSWER_UNREADABLE", {
      status: response.status,
    })
  }
  throw new PlatformRefusal(response.status, {
    error: answer.error as PublicRefusalCode,
    message: answer.message,
    ...(answer.detail === undefined ? {} : { detail: answer.detail }),
  })
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false
  const body = value as Partial<ApiErrorBody>
  return typeof body.error === "string" && typeof body.message === "string"
}
