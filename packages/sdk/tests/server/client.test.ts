/**
 * A studio's own server asking the platform who a player's token names.
 *
 * The client carries the studio's secret key, so what matters is where the
 * key goes and what goes with it: never to an origin a key may not travel
 * to, never with an `Origin` header, which the platform refuses a secret key
 * beside, and never from a page, where anybody could read it.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import type {
  PlatformRoute,
  SecretKey,
  VerifiedPlayer,
} from "../../src/api/index.js"
import type { PageRoute } from "../../src/platform/request.js"
import type { ServerRoute } from "../../src/server/client.js"
import {
  createServerClient,
  PlatformClientError,
  PlatformRefusal,
  worthRetrying,
} from "../../src/server/index.js"

const API = "https://api.vbz.example"
const KEY: SecretKey = "vbz_sk_studio-secret"
const SRC = join(import.meta.dir, "..", "..", "src")

interface Sent {
  readonly url: string
  readonly method: string | undefined
  readonly headers: Record<string, string>
  readonly body: unknown
}

/** A `fetch` that records each request and answers from a queue. */
function platform(...answers: Array<{ status: number; body: string }>) {
  const sent: Sent[] = []
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    sent.push({
      url,
      method: init.method,
      headers: { ...(init.headers as Record<string, string>) },
      body:
        typeof init.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : undefined,
    })
    const answer = answers.shift()
    if (answer === undefined) throw new Error("no answer queued")
    return new Response(answer.body, { status: answer.status })
  }
  return { sent, fetch }
}

const VERIFIED: VerifiedPlayer = {
  player: { id: "6f1c0d5e-0000-4000-8000-000000000001", displayName: "ada" },
  expiresAt: "2027-02-22T10:00:00.000Z",
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error("expected a failure")
}

function thrown(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected a throw")
}

describe("verifying a player", () => {
  test("posts the token with the secret key, and no Origin and no cookie", async () => {
    const { sent, fetch } = platform({
      status: 200,
      body: JSON.stringify(VERIFIED),
    })
    const client = createServerClient({ apiOrigin: API, secretKey: KEY, fetch })
    expect(await client.verifyPlayer("player.jwt.token")).toEqual(VERIFIED)
    expect(sent).toEqual([
      {
        url: `${API}/v1/players/verify`,
        method: "POST",
        headers: {
          authorization: `Bearer ${KEY}`,
          "content-type": "application/json",
        },
        body: { token: "player.jwt.token" },
      },
    ])
    const headers = Object.keys(sent[0]?.headers ?? {}).map((name) =>
      name.toLowerCase(),
    )
    expect(headers).not.toContain("origin")
    expect(headers).not.toContain("cookie")
    expect(headers).not.toContain("x-vbz-key")
  })

  test("a token the platform will not vouch for is its refusal, by code", async () => {
    const { fetch } = platform({
      status: 401,
      body: JSON.stringify({
        error: "E_PLAYER_TOKEN_INVALID",
        message: "that player's token is not good at this studio",
      }),
    })
    const client = createServerClient({ apiOrigin: API, secretKey: KEY, fetch })
    const error = await caught(() => client.verifyPlayer("stale"))
    expect(error).toBeInstanceOf(PlatformRefusal)
    expect((error as PlatformRefusal).code).toBe("E_PLAYER_TOKEN_INVALID")
    expect((error as PlatformRefusal).status).toBe(401)
    // Asking again with the same token gets the same answer.
    expect(worthRetrying(error)).toBe(false)
  })

  test("no answer, and an answer that is not JSON, are the client's own codes", async () => {
    const unreachable = createServerClient({
      apiOrigin: API,
      secretKey: KEY,
      fetch: async () => {
        throw new TypeError("connection refused")
      },
    })
    const lost = await caught(() => unreachable.verifyPlayer("t"))
    expect((lost as PlatformClientError).code).toBe("E_UNREACHABLE")
    expect(worthRetrying(lost)).toBe(true)

    const { fetch } = platform({ status: 502, body: "<html>bad gateway" })
    const proxied = createServerClient({
      apiOrigin: API,
      secretKey: KEY,
      fetch,
    })
    const unreadable = await caught(() => proxied.verifyPlayer("t"))
    expect(unreadable).toBeInstanceOf(PlatformClientError)
    expect((unreadable as PlatformClientError).code).toBe("E_ANSWER_UNREADABLE")
  })
})

describe("the studio's other routes", () => {
  test("a version read back fills its path, encoded, and carries the key", async () => {
    const { sent, fetch } = platform({ status: 200, body: "{}" })
    const client = createServerClient({ apiOrigin: API, secretKey: KEY, fetch })
    await client.request("GET /v1/studios/:studioId/versions/:versionId", {
      params: { studioId: "s/1", versionId: "v-2" },
    })
    expect(sent[0]?.url).toBe(`${API}/v1/studios/s%2F1/versions/v-2`)
    expect(sent[0]?.method).toBe("GET")
    expect(sent[0]?.headers).toEqual({ authorization: `Bearer ${KEY}` })
  })

  /**
   * Held at compile time: a server is offered the secret-key routes that
   * take JSON, and a page none of them.
   */
  test("are the secret-key routes with JSON bodies, and none is a page's", () => {
    "POST /v1/players/verify" satisfies ServerRoute
    "POST /v1/games/:gameId/files/missing" satisfies ServerRoute
    type Upload = Extract<
      ServerRoute,
      "POST /v1/games/:gameId/versions" | "PUT /v1/games/:gameId/files/:sha256"
    >
    const noUpload: [Upload] extends [never] ? true : Upload = true
    type Shared = Extract<ServerRoute, PageRoute>
    const noneShared: [Shared] extends [never] ? true : Shared = true
    type Page = Extract<ServerRoute, "GET /v1/game" | "POST /v1/runs">
    const noPage: [Page] extends [never] ? true : Page = true
    expect([noUpload, noneShared, noPage]).toEqual([true, true, true])
    const route: PlatformRoute = "POST /v1/players/verify"
    expect(route).toBe("POST /v1/players/verify")
  })
})

describe("where the key may go", () => {
  test("https, or http to this machine, as vbz publish sends it", () => {
    for (const apiOrigin of [
      "https://api.vbz.gg",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(() =>
        createServerClient({
          apiOrigin,
          secretKey: KEY,
          fetch: async () => new Response(),
        }),
      ).not.toThrow()
    }
  })

  test("never plain http to another machine, and never an address that is not an origin", () => {
    for (const [apiOrigin, why] of [
      ["http://api.vbz.gg", "must be https, or http to this machine"],
      ["http://10.0.0.5:3000", "must be https, or http to this machine"],
      ["ftp://api.vbz.gg", "must be https, or http to this machine"],
      ["https://api.vbz.gg/v1", "the origin alone"],
      ["https://user:pw@api.vbz.gg", "the origin alone"],
      ["api.vbz.gg", "not a URL"],
    ] as const) {
      expect(
        thrown(() => createServerClient({ apiOrigin, secretKey: KEY })),
      ).toContain(why)
    }
  })

  test("a request goes to the origin alone, with a trailing slash dropped", async () => {
    const { sent, fetch } = platform({ status: 200, body: "{}" })
    const client = createServerClient({
      apiOrigin: "https://api.vbz.example/",
      secretKey: KEY,
      fetch,
    })
    await client.verifyPlayer("t")
    expect(sent[0]?.url).toBe(`${API}/v1/players/verify`)
  })

  test("only a secret key is sent, and a page key is named", () => {
    expect(
      thrown(() =>
        createServerClient({
          apiOrigin: API,
          secretKey: "vbz_pk_public" as SecretKey,
        }),
      ),
    ).toContain("holds a page key")
    expect(
      thrown(() =>
        createServerClient({
          apiOrigin: API,
          secretKey: "sk_live_x" as SecretKey,
        }),
      ),
    ).toContain("starts vbz_sk_")
  })
})

describe("where a client is made", () => {
  const global = globalThis as { document?: unknown }
  afterEach(() => {
    delete global.document
  })

  test("never on a page, where anybody could read the key", () => {
    global.document = {}
    let fetched = 0
    expect(
      thrown(() =>
        createServerClient({
          apiOrigin: API,
          secretKey: KEY,
          fetch: async () => {
            fetched += 1
            return new Response()
          },
        }),
      ),
    ).toContain("belongs on a server")
    expect(fetched).toBe(0)
  })

  test("sends through the runtime's own fetch when given none", async () => {
    const original = globalThis.fetch
    const sent: string[] = []
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request) => {
        sent.push(String(url))
        return new Response(JSON.stringify(VERIFIED))
      },
      { preconnect: original.preconnect },
    ) as typeof fetch
    try {
      const client = createServerClient({ apiOrigin: API, secretKey: KEY })
      expect(await client.verifyPlayer("t")).toEqual(VERIFIED)
      expect(sent).toEqual([`${API}/v1/players/verify`])
    } finally {
      globalThis.fetch = original
    }
  })
})

type Scanned = { kind: string; path: string }

async function importsOf(path: string): Promise<string[]> {
  const scanned = new Bun.Transpiler({ loader: "ts" }).scanImports(
    await readFile(path, "utf8"),
  ) as Scanned[]
  return scanned.map((one) => one.path)
}

describe("@vbz-gg/sdk/server", () => {
  /**
   * Every module the subpath loads at run time, followed through each
   * relative import (a type-only import loads nothing):
   * a server's bundle carries the request plumbing and the shared key rule,
   * and none of the page's sign-in, run or host, nor the CLI.
   */
  test("reaches no page code and none of the CLI", async () => {
    const entry = join(SRC, "server", "index.ts")
    const seen = new Set<string>([entry])
    const queue = [entry]
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      for (const path of await importsOf(next)) {
        if (!path.startsWith(".")) continue
        const file = join(dirname(next), path).replace(/\.js$/, ".ts")
        if (seen.has(file)) continue
        seen.add(file)
        queue.push(file)
      }
    }
    expect([...seen].map((file) => relative(SRC, file)).sort()).toEqual([
      join("platform", "errors.ts"),
      join("platform", "request.ts"),
      join("server", "client.ts"),
      join("server", "index.ts"),
      join("wire", "keys.ts"),
    ])
  })

  test("is named in the exports map, beside the other halves", async () => {
    const manifest = JSON.parse(
      await readFile(join(SRC, "..", "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string>> }
    expect(manifest.exports["./server"]).toEqual({
      development: "./src/server/index.ts",
      types: "./dist/server/index.d.ts",
      default: "./dist/server/index.js",
    })
  })
})
