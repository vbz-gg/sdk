/**
 * Serving a game's two modules and its files over HTTP, the way the
 * platform's edge does.
 *
 * In production a published version's rules code and page module sit in a
 * public bucket behind a CDN, under `/g/<gameId>/sim/<sha256>.js` and
 * `/g/<gameId>/present/<sha256>.js`, and its files under
 * `/g/<gameId>/t/<listing sha256>/<path>`, answered with the headers below.
 * This handler answers the same paths with the same headers, so the harness
 * and the platform's development `bundles` role give a page the answer it
 * will meet from the edge.
 *
 * A handler rather than a server, so it is testable without a port and so a
 * caller can mount it beside whatever else an origin serves.
 */

import { ARTIFACT_PATH, isFilePathname } from "../build/paths.js"

/** The paths of a game's two modules, which a bundle server answers. */
export const BLOB_PATH = ARTIFACT_PATH

/**
 * Whether a bundle server answers `pathname`: a module's path, or a file of
 * a version's folder. Anything else never reaches a store.
 */
export function isServedPath(pathname: string): boolean {
  return BLOB_PATH.test(pathname) || isFilePathname(pathname)
}

export const JS_CONTENT_TYPE = "text/javascript; charset=utf-8"

/**
 * The type a file of a version's folder is served as, by its extension. A
 * module script is refused unless it arrives as JavaScript, and a browser
 * compiles WebAssembly by streaming only from `application/wasm`. Anything
 * not named here is `application/octet-stream`, HTML among it, so a file
 * opened on the bundles origin is never a page there.
 */
export const FILE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  js: JS_CONTENT_TYPE,
  mjs: JS_CONTENT_TYPE,
  wasm: "application/wasm",
  json: "application/json",
  css: "text/css; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  wgsl: "text/plain; charset=utf-8",
  glsl: "text/plain; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ktx2: "image/ktx2",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  bin: "application/octet-stream",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
}

/** The type a file at `path` is served as. */
export function contentTypeFor(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1)
  const dot = file.lastIndexOf(".")
  const extension = dot === -1 ? "" : file.slice(dot + 1).toLowerCase()
  return Object.hasOwn(FILE_CONTENT_TYPES, extension)
    ? (FILE_CONTENT_TYPES[extension] as string)
    : "application/octet-stream"
}

/**
 * Every module is named by the digest of its own body, and every file by the
 * digest of a listing naming its body, so neither ever changes.
 */
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

/** Reads a stored module or file by its path, without the leading slash. */
export type BlobReader = (key: string) => Promise<Uint8Array | undefined>

/**
 * The entity tag of what a path names. A module's is the digest its path
 * names; a file's is the listing's digest and its path, which name its bytes
 * as surely, since the listing names every file's.
 */
function etagOf(pathname: string): string {
  if (BLOB_PATH.test(pathname)) {
    const file = pathname.slice(pathname.lastIndexOf("/") + 1)
    return `"${file.slice(0, -".js".length)}"`
  }
  return `"${pathname.split("/").slice(4).join("/")}"`
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
    if (!isServedPath(pathname)) return text(404, "not found")

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
      "content-type": BLOB_PATH.test(pathname)
        ? JS_CONTENT_TYPE
        : contentTypeFor(pathname),
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
