/**
 * Serving a game's two modules over HTTP, the way the platform's edge does.
 *
 * In production a published version's rules code and page module sit in a
 * public bucket behind a CDN, under `/g/<gameId>/sim/<sha256>.js` and
 * `/g/<gameId>/present/<sha256>.js`, answered with the headers below. This
 * handler answers the same paths with the same headers, so the harness and
 * the platform's development `bundles` role give a page the answer it will
 * meet from the edge.
 *
 * A handler rather than a server, so it is testable without a port and so a
 * caller can mount it beside whatever else an origin serves.
 */

import { ARTIFACT_PATH } from "../build/paths.js"

/** The paths a bundle server answers. Anything else never reaches a store. */
export const BLOB_PATH = ARTIFACT_PATH

export const JS_CONTENT_TYPE = "text/javascript; charset=utf-8"

/** Every module is named by the digest of its own body, so it never changes. */
export const BLOB_CACHE_CONTROL = "public, max-age=31536000, immutable"

/**
 * The headers every response carries, hit or miss.
 *
 * `access-control-allow-origin: *`, because a page module is imported by a
 * studio's page from another origin and every module import is a CORS
 * request. What these files hold is public: a published game's code. Which
 * page may run it is the studio's Content-Security-Policy to say, naming its
 * own game's path, rather than this server's.
 *
 * The miss carries it too. A 404 without CORS is reported to the page as a
 * network failure, which sends whoever hit it looking at the wrong layer.
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "cross-origin-resource-policy": "cross-origin",
}

/** Reads a stored module by its path, without the leading slash. */
export type BlobReader = (key: string) => Promise<Uint8Array | undefined>

/** The digest a module's path names, which is its entity tag. */
function etagOf(pathname: string): string {
  const file = pathname.slice(pathname.lastIndexOf("/") + 1)
  return `"${file.slice(0, -".js".length)}"`
}

/** Whether `If-None-Match` names this tag, or anything. */
function matches(header: string | null, etag: string): boolean {
  if (header === null) return false
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag)
}

export function createBlobServer(
  read: BlobReader,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url)

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text(405, "method not allowed")
    }
    if (!BLOB_PATH.test(pathname)) return text(404, "not found")

    const body = await read(pathname.slice(1))
    if (body === undefined) return text(404, "not found")

    const etag = etagOf(pathname)
    const cached: Record<string, string> = {
      ...CORS_HEADERS,
      "cache-control": BLOB_CACHE_CONTROL,
      etag,
    }
    if (matches(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers: cached })
    }
    const headers: Record<string, string> = {
      ...cached,
      "content-type": JS_CONTENT_TYPE,
      // Makes a wrong content-type a deterministic refusal rather than a
      // browser-dependent guess.
      "x-content-type-options": "nosniff",
      "content-length": String(body.byteLength),
    }
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers })
    }
    return new Response(body as BodyInit, { status: 200, headers })
  }
}

function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { ...CORS_HEADERS, "content-type": "text/plain; charset=utf-8" },
  })
}
