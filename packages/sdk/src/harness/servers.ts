/**
 * Two servers, because a game needs two origins to be tested honestly.
 *
 * The bundles origin serves the game's two modules and its files with the
 * headers a host serving them to another origin sends, at the paths vbz.gg's
 * public store uses. The host origin serves the page that loads the page
 * module from it, as a page on another origin does, under the
 * Content-Security-Policy such a page is meant to send. Two ports on one
 * host are two origins, which is what puts an author in front of the
 * cross-origin module import such a page makes in front of players.
 */

import { type BlobReader, createBlobServer } from "../serve/index.js"
import { type BuiltGame, blobKeys } from "./artifacts.js"

/** A certificate and its private key, as PEM text. */
export interface Tls {
  readonly cert: string
  readonly key: string
}

/** Where a server listens, which is also the host its origin names. */
export interface Listen {
  readonly hostname: string
  /** Serve https with this, or plain http when null. */
  readonly tls: Tls | null
}

/** This machine, over plain http: what `vbz dev` does unless told otherwise. */
export const LOOPBACK: Listen = { hostname: "127.0.0.1", tls: null }

/** The origin a server listening this way on `port` is reached at. */
export function originOf(listen: Listen, port: number): string {
  const host = listen.hostname.includes(":")
    ? `[${listen.hostname}]`
    : listen.hostname
  return `${listen.tls === null ? "http" : "https"}://${host}:${port}`
}

/** What `Bun.serve` takes for where and how to listen. */
export function serveOptions(
  listen: Listen,
  port: number,
): {
  readonly port: number
  readonly hostname: string
  readonly tls?: Tls
} {
  return {
    port,
    hostname: listen.hostname,
    ...(listen.tls === null ? {} : { tls: listen.tls }),
  }
}

export interface BundleServerOptions {
  readonly port: number
  readonly built: BuiltGame
  /** Every path the browser asked for, so a test can read the network. */
  readonly log?: (path: string) => void
  readonly listen?: Listen
}

export interface RunningServer {
  readonly origin: string
  stop(): Promise<void>
}

/** Serves the game's two modules and its files, as a host serving them to another origin does. */
export function startBundleServer(options: BundleServerOptions): RunningServer {
  const keys = blobKeys(options.built)
  const blobs = new Map<string, Uint8Array>([
    [keys.sim, options.built.sim],
    [keys.present, options.built.present],
  ])
  const read: BlobReader = async (key) => {
    const module = blobs.get(key)
    if (module !== undefined) return module
    if (!key.startsWith(keys.files)) return undefined
    // Read from the folder each time, as listed when the game was built.
    const onDisk = options.built.filesOnDisk.get(key.slice(keys.files.length))
    return onDisk === undefined ? undefined : await Bun.file(onDisk).bytes()
  }
  const serveBlob = createBlobServer(read)
  const listen = options.listen ?? LOOPBACK

  const server = Bun.serve({
    ...serveOptions(listen, options.port),
    fetch: async (request) => {
      options.log?.(new URL(request.url).pathname)
      return serveBlob(request)
    },
  })

  return {
    origin: originOf(listen, server.port ?? options.port),
    stop: async () => {
      await server.stop(true)
    },
  }
}

/** One path the host origin answers besides its page. */
export type Route = (request: Request) => Response | Promise<Response>

export interface HostServerOptions {
  readonly port: number
  readonly page?: string
  /** The bundled page script, served from this same origin. */
  readonly script: string
  /** The page's stylesheet, served from this same origin. */
  readonly style?: string
  /** The Content-Security-Policy the page is served under. */
  readonly csp?: string
  /** Further paths, by pathname. */
  readonly routes?: Readonly<Record<string, Route>>
  readonly listen?: Listen
}

export interface RunningHostServer extends RunningServer {
  /**
   * Replaces the page after the server is listening.
   *
   * The page has to name the bundles origin, so it is written once both are
   * bound. Asking for port 0 makes that plain: an origin is the port the
   * socket *got*, not the port it was asked for.
   */
  setPage(html: string, csp?: string): void
}

/** Nothing the harness serves is cached: a rebuild changes what it names. */
const NO_STORE = "no-store"

/** Serves the page that loads the game. */
export function startHostServer(options: HostServerOptions): RunningHostServer {
  let page = options.page ?? ""
  let csp = options.csp
  const listen = options.listen ?? LOOPBACK
  const server = Bun.serve({
    ...serveOptions(listen, options.port),
    fetch: (request) => {
      const { pathname } = new URL(request.url)
      const route = options.routes?.[pathname]
      if (route !== undefined) return route(request)
      if (pathname === "/harness.js") {
        return new Response(options.script, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": NO_STORE,
          },
        })
      }
      if (pathname === "/harness.css") {
        return new Response(options.style ?? "", {
          headers: {
            "content-type": "text/css; charset=utf-8",
            "cache-control": NO_STORE,
          },
        })
      }
      return new Response(page, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": NO_STORE,
          ...(csp === undefined ? {} : { "content-security-policy": csp }),
        },
      })
    },
  })

  return {
    origin: originOf(listen, server.port ?? options.port),
    setPage: (html: string, policy?: string) => {
      page = html
      if (policy !== undefined) csp = policy
    },
    stop: async () => {
      await server.stop(true)
    },
  }
}
