import { describe, expect, test } from "bun:test"
import { createBlobServer } from "../../src/serve/blobs"

const GAME = "0b6f3c1e-2d4a-4e8b-9c7d-5a1f2e3b4c6d"
const OTHER_GAME = "11111111-2222-4333-8444-555555555555"
const HASH = "a".repeat(64)
const BODY = new TextEncoder().encode("export const x = 1")
const SIM = `/g/${GAME}/sim/${HASH}.js`

const serve = createBlobServer(async (key) =>
  key === `g/${GAME}/sim/${HASH}.js` ? BODY : undefined,
)

function get(
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
): Promise<Response> {
  return serve(new Request(`http://bundle.invalid${path}`, { method, headers }))
}

describe("serving a module", () => {
  test("a stored module comes back with its bytes", async () => {
    const response = await get(SIM)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("export const x = 1")
    expect(response.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    )
  })

  /**
   * A studio's page imports the module from another origin, and a module
   * import is a CORS request. The public bucket answers `*`, so this does.
   */
  test("every response lets any page read it, as the edge does", async () => {
    for (const path of [SIM, `/g/${GAME}/sim/nope.js`, "/anything"]) {
      const response = await get(path)
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
    }
  })

  /**
   * A 404 without CORS is reported to the page as a network failure, which
   * sends whoever hit it looking at the wrong layer entirely.
   */
  test("a miss is a 404 that still carries the header", async () => {
    const response = await get(`/g/${GAME}/sim/${"b".repeat(64)}.js`)
    expect(response.status).toBe(404)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })

  test("content is never sniffed", async () => {
    const response = await get(SIM)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  /** A module is named by the digest of its own body, so it never changes. */
  test("a hit is cached for a year and never revalidated", async () => {
    const response = await get(SIM)
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    )
  })

  test("its entity tag is the digest its path names", async () => {
    const response = await get(SIM)
    expect(response.headers.get("etag")).toBe(`"${HASH}"`)
  })

  /**
   * A browser that kept the module asks again with the tag. The answer has
   * no body and the same CORS and cache headers, or a cached module would be
   * refused the second time a page imports it.
   */
  test("a request naming its tag is answered 304 with the same headers", async () => {
    for (const tag of [`"${HASH}"`, `W/"${HASH}"`, `"other", "${HASH}"`, "*"]) {
      const response = await get(SIM, "GET", { "if-none-match": tag })
      expect(response.status).toBe(304)
      expect(await response.text()).toBe("")
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      expect(response.headers.get("cache-control")).toContain("immutable")
      expect(response.headers.get("etag")).toBe(`"${HASH}"`)
    }
    const stale = await get(SIM, "GET", { "if-none-match": '"other"' })
    expect(stale.status).toBe(200)
  })

  test("HEAD answers with the headers and no body", async () => {
    const response = await get(SIM, "HEAD")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-length")).toBe(String(BODY.byteLength))
    expect(await response.text()).toBe("")
  })

  test("a preflight is answered without touching the store", async () => {
    const response = await get(SIM, "OPTIONS")
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "GET",
    )
  })

  test("anything but a read is refused", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect((await get(SIM, method)).status).toBe(405)
    }
  })

  /**
   * A path that is not a game's module never reaches the store, so a
   * traversal attempt is refused before anything touches a filesystem, and
   * the old unnamespaced paths are gone.
   */
  test("a path outside a game's two kinds never reaches the store", async () => {
    let asked: string | null = null
    const guarded = createBlobServer(async (key) => {
      asked = key
      return undefined
    })
    for (const path of [
      `/g/${GAME}/sim/../../etc/passwd`,
      `/g/${GAME}/sim/short.js`,
      `/g/${GAME}/other/${HASH}.js`,
      `/g/${GAME}/frame/${HASH}.js`,
      `/g/${GAME.toUpperCase()}/sim/${HASH}.js`,
      `/g/not-a-game/sim/${HASH}.js`,
      `/g/${GAME}/sim/${HASH.toUpperCase()}.js`,
      `/sim/${HASH}.js`,
      `/frame/${HASH}.js`,
      "/",
    ]) {
      const response = await guarded(
        new Request(`http://bundle.invalid${path}`),
      )
      expect(response.status).toBe(404)
    }
    expect(asked).toBeNull()
  })

  test("both kinds are served, each under its own game", async () => {
    const keys: string[] = []
    const both = createBlobServer(async (key) => {
      keys.push(key)
      return BODY
    })
    for (const path of [
      `/g/${GAME}/present/${HASH}.js`,
      `/g/${OTHER_GAME}/sim/${HASH}.js`,
    ]) {
      expect((await both(new Request(`http://x.invalid${path}`))).status).toBe(
        200,
      )
    }
    expect(keys).toEqual([
      `g/${GAME}/present/${HASH}.js`,
      `g/${OTHER_GAME}/sim/${HASH}.js`,
    ])
  })
})
