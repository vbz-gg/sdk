/**
 * Two servers, because a game needs two origins to be tested honestly.
 *
 * The bundles origin serves the game's two modules at the paths and with the
 * headers the platform's edge uses. The host origin serves the page that
 * loads the page module from it, as a studio's page does. Two ports on
 * localhost are two origins, which is what puts an author in front of the
 * cross-origin module import a studio's page makes in production.
 */

import { type BlobReader, createBlobServer } from "../serve/index.js"
import { type BuiltGame, blobKeys } from "./artifacts.js"

export interface BundleServerOptions {
  readonly port: number
  readonly built: BuiltGame
  /** Every path the browser asked for, so a test can read the network. */
  readonly log?: (path: string) => void
}

export interface RunningServer {
  readonly origin: string
  stop(): Promise<void>
}

/** Serves the game's two modules, as the platform's edge does. */
export function startBundleServer(options: BundleServerOptions): RunningServer {
  const keys = blobKeys(options.built)
  const blobs = new Map<string, Uint8Array>([
    [keys.sim, options.built.sim],
    [keys.present, options.built.present],
  ])
  const read: BlobReader = async (key) => blobs.get(key)
  const serveBlob = createBlobServer(read)

  const server = Bun.serve({
    port: options.port,
    fetch: async (request) => {
      options.log?.(new URL(request.url).pathname)
      return serveBlob(request)
    },
  })

  return {
    origin: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      await server.stop(true)
    },
  }
}

export interface HostServerOptions {
  readonly port: number
  readonly page?: string
  /** The bundled page script, served from this same origin. */
  readonly script: string
}

export interface RunningHostServer extends RunningServer {
  /**
   * Replaces the page after the server is listening.
   *
   * The page has to name the bundles origin, so it is written once both are
   * bound. Asking for port 0 makes that plain: an origin is the port the
   * socket *got*, not the port it was asked for.
   */
  setPage(html: string): void
}

/** Serves the page that loads the game. */
export function startHostServer(options: HostServerOptions): RunningHostServer {
  let page = options.page ?? ""
  const server = Bun.serve({
    port: options.port,
    fetch: (request) => {
      const { pathname } = new URL(request.url)
      if (pathname === "/harness.js") {
        return new Response(options.script, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
          },
        })
      }
      return new Response(page, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      })
    },
  })

  return {
    origin: `http://127.0.0.1:${server.port}`,
    setPage: (html: string) => {
      page = html
    },
    stop: async () => {
      await server.stop(true)
    },
  }
}
