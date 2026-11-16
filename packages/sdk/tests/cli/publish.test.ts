/**
 * `vbz publish`, which is how a studio's build system puts a version live.
 *
 * Most of it runs against a stand-in for `fetch`, because what is being held
 * is what the command sends and how it reads each answer. The last block runs
 * the real command against a local server, so the multipart body, the missing
 * `Origin` header and the exit codes are the ones a build system sees.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type {
  UploadedVersion,
  VersionState,
  VersionStatus,
} from "../../src/api/index.js"
import { parseArgs } from "../../src/cli/args.js"
import { TEMPLATE_DIR } from "../../src/cli/new.js"
import {
  API_ORIGIN_VARIABLE,
  CHECK_POLL_MS,
  CHECK_WAIT_MS,
  DEFAULT_API_ORIGIN,
  failureLines,
  PUBLISH_ERROR,
  PublishError,
  type PublishErrorCode,
  type PublishSettings,
  publish,
  publishSettings,
  readBuild,
  STUDIO_KEY_VARIABLE,
  verdictOf,
} from "../../src/cli/publish.js"

const KEY = "vbz_sk_0123456789abcdef"
const GAME = "6f1c1f9e-6a43-4d55-9d43-1b0f6f7f2d10"
const STUDIO = "2b7e2c5a-3c62-4bb6-8f2c-0c8f0b6a9e11"
const VERSION_ID = "9a0e5d3c-1f3e-4b7f-a2d4-57c1c0a5c2b9"
const MANIFEST = `${JSON.stringify({ id: "lane-runner", version: "1.2.0" })}\n`
const SIM = new TextEncoder().encode("export const MANIFEST = {}\n")
const PRESENT = new TextEncoder().encode('import "cw2:sim"\n')

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sdk-publish-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeDist(root: string): Promise<void> {
  await mkdir(join(root, "dist"), { recursive: true })
  await writeFile(join(root, "dist", "manifest.json"), MANIFEST)
  await writeFile(join(root, "dist", "sim.js"), SIM)
  await writeFile(join(root, "dist", "present.js"), PRESENT)
}

function settings(overrides: Partial<PublishSettings> = {}): PublishSettings {
  return {
    dir,
    gameId: GAME,
    apiOrigin: "https://studio.example",
    key: KEY,
    ...overrides,
  }
}

function uploaded(overrides: Partial<UploadedVersion> = {}): UploadedVersion {
  return {
    gameVersionId: VERSION_ID,
    studioId: STUDIO,
    version: "1.2.0",
    line: "1.2",
    state: "pending",
    simSha256: "a".repeat(64),
    presentSha256: "b".repeat(64),
    presentSourceSha256: "c".repeat(64),
    manifestHash: "d".repeat(16),
    manifestSha256: "e".repeat(64),
    simUrl: `https://bundles.example/g/${GAME}/sim/a.js`,
    presentUrl: `https://bundles.example/g/${GAME}/present/b.js`,
    ...overrides,
  }
}

function status(
  state: VersionState,
  overrides: Partial<VersionStatus> = {},
): VersionStatus {
  return {
    gameVersionId: VERSION_ID,
    gameId: GAME,
    version: "1.2.0",
    line: "1.2",
    state,
    rejectedCode: null,
    firstFailure: null,
    checkedAt: state === "pending" ? null : "2026-11-11T06:00:00.000Z",
    suspended: false,
    serving: {
      ranked: state === "published" ? "today" : "none",
      practice: state === "published",
    },
    createdAt: "2026-11-11T05:59:00.000Z",
    ...overrides,
  }
}

function json(body: unknown, init: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status: init,
    headers: { "content-type": "application/json" },
  })
}

interface Sent {
  readonly url: string
  readonly init: RequestInit
}

/**
 * A stand-in for the network: each request takes the next answer in turn,
 * and a clock that only moves when the command sleeps.
 */
function world(answers: ReadonlyArray<() => Response | Promise<Response>>) {
  const sent: Sent[] = []
  const slept: number[] = []
  const logged: string[] = []
  let clock = 1_000_000
  let next = 0
  return {
    sent,
    slept,
    logged,
    deps: {
      fetch: async (url: string, init: RequestInit) => {
        sent.push({ url, init })
        const answer = answers[next]
        next += 1
        if (answer === undefined) throw new Error(`no answer for ${url}`)
        return answer()
      },
      sleep: async (ms: number) => {
        slept.push(ms)
        clock += ms
      },
      now: () => clock,
      log: (line: string) => {
        logged.push(line)
      },
    },
  }
}

async function refusalOf(work: Promise<unknown>): Promise<PublishError> {
  try {
    await work
  } catch (error) {
    if (error instanceof PublishError) return error
    throw error
  }
  throw new Error("expected the publish to stop")
}

function settingsRefusal(
  input: Parameters<typeof publishSettings>[0],
  env: Record<string, string | undefined>,
): PublishErrorCode {
  try {
    publishSettings(input, env)
  } catch (error) {
    if (error instanceof PublishError) return error.code
    throw error
  }
  throw new Error("expected the settings to be refused")
}

describe("what the command line and the environment say", () => {
  const env = { [STUDIO_KEY_VARIABLE]: KEY }

  test("the flags reach the options", () => {
    const options = parseArgs([
      "publish",
      "./game",
      "--game",
      GAME,
      "--api",
      "http://localhost:3000",
    ])
    expect(options.command).toBe("publish")
    expect(options.game).toBe(GAME)
    expect(options.api).toBe("http://localhost:3000")
    expect(parseArgs(["publish"]).game).toBeUndefined()
  })

  test("with no --api and nothing in the environment, the platform is api.vbz.gg", () => {
    const read = publishSettings({ dir, game: GAME, api: undefined }, env)
    expect(DEFAULT_API_ORIGIN).toBe("https://api.vbz.gg")
    expect(read.apiOrigin).toBe(DEFAULT_API_ORIGIN)
    expect(read).toEqual({
      dir,
      gameId: GAME,
      apiOrigin: DEFAULT_API_ORIGIN,
      key: KEY,
    })
  })

  test("VBZ_API_ORIGIN replaces the default, and --api replaces both", () => {
    const withEnv = { ...env, [API_ORIGIN_VARIABLE]: "https://staging.example" }
    expect(
      publishSettings({ dir, game: GAME, api: undefined }, withEnv).apiOrigin,
    ).toBe("https://staging.example")
    expect(
      publishSettings(
        { dir, game: GAME, api: "http://127.0.0.1:3000" },
        withEnv,
      ).apiOrigin,
    ).toBe("http://127.0.0.1:3000")
  })

  test("an origin with a trailing slash is the origin", () => {
    expect(
      publishSettings({ dir, game: GAME, api: "https://studio.example/" }, env)
        .apiOrigin,
    ).toBe("https://studio.example")
  })

  test("plain http is refused except to this machine, because the key travels with it", () => {
    for (const api of ["http://localhost:3000", "http://[::1]:3000"]) {
      expect(publishSettings({ dir, game: GAME, api }, env).apiOrigin).toBe(api)
    }
    expect(
      settingsRefusal({ dir, game: GAME, api: "http://studio.example" }, env),
    ).toBe(PUBLISH_ERROR.BAD_API_ORIGIN)
  })

  test("an origin with a path, a query, a login or no scheme is refused", () => {
    for (const api of [
      "https://studio.example/v1",
      "https://studio.example?x=1",
      "https://studio.example#top",
      "https://me:pw@studio.example",
      "studio.example",
      "",
    ]) {
      expect(settingsRefusal({ dir, game: GAME, api }, env)).toBe(
        PUBLISH_ERROR.BAD_API_ORIGIN,
      )
    }
  })

  test("a publish with no game says how to name one", () => {
    expect(settingsRefusal({ dir, game: undefined, api: undefined }, env)).toBe(
      PUBLISH_ERROR.NO_GAME,
    )
    expect(settingsRefusal({ dir, game: "  ", api: undefined }, env)).toBe(
      PUBLISH_ERROR.NO_GAME,
    )
  })

  test("the key comes from the environment, and has to be a secret key", () => {
    const input = { dir, game: GAME, api: undefined }
    expect(settingsRefusal(input, {})).toBe(PUBLISH_ERROR.NO_KEY)
    expect(settingsRefusal(input, { [STUDIO_KEY_VARIABLE]: " " })).toBe(
      PUBLISH_ERROR.NO_KEY,
    )
    expect(
      settingsRefusal(input, { [STUDIO_KEY_VARIABLE]: "vbz_pk_public" }),
    ).toBe(PUBLISH_ERROR.NOT_A_SECRET_KEY)
    expect(settingsRefusal(input, { [STUDIO_KEY_VARIABLE]: "hunter2" })).toBe(
      PUBLISH_ERROR.NOT_A_SECRET_KEY,
    )
  })

  test("a page key is named as one, so the fix is obvious", () => {
    try {
      publishSettings(
        { dir, game: GAME, api: undefined },
        { [STUDIO_KEY_VARIABLE]: "vbz_pk_public" },
      )
    } catch (error) {
      expect(String(error)).toContain("page key")
      return
    }
    throw new Error("expected the page key to be refused")
  })
})

describe("reading what vbz build wrote", () => {
  test("the three files, the manifest as text", async () => {
    await writeDist(dir)
    const built = await readBuild(dir)
    expect(built.manifest).toBe(MANIFEST)
    expect(built.sim).toEqual(SIM)
    expect(built.present).toEqual(PRESENT)
  })

  test("a missing file is named, with what to run", async () => {
    await writeDist(dir)
    await rm(join(dir, "dist", "present.js"))
    const refused = await refusalOf(readBuild(dir))
    expect(refused.code).toBe(PUBLISH_ERROR.NOT_BUILT)
    expect(refused.message).toContain(join(dir, "dist", "present.js"))
    expect(refused.message).toContain("vbz build")
  })

  test("a read failing for another reason is not reported as a missing build", async () => {
    await writeDist(dir)
    await rm(join(dir, "dist", "sim.js"))
    await mkdir(join(dir, "dist", "sim.js"))
    let thrown: unknown
    try {
      await readBuild(dir)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(PublishError)
  })
})

describe("the upload", () => {
  test("is one multipart POST to the game, with the secret key and the three files", async () => {
    await writeDist(dir)
    const net = world([
      () => json(uploaded(), 201),
      () => json(status("published")),
    ])
    await publish(settings(), net.deps)

    const upload = net.sent[0]
    expect(upload?.url).toBe(`https://studio.example/v1/games/${GAME}/versions`)
    expect(upload?.init.method).toBe("POST")
    const headers = upload?.init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${KEY}`)
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain(
      "origin",
    )
    const form = upload?.init.body as FormData
    expect(form.get("manifest")).toBe(MANIFEST)
    expect(
      new Uint8Array(await (form.get("sim") as File).arrayBuffer()),
    ).toEqual(SIM)
    expect(
      new Uint8Array(await (form.get("present") as File).arrayBuffer()),
    ).toEqual(PRESENT)
    expect(form.get("frame")).toBeNull()
  })

  test("a game id is put in the path escaped, never as more path", async () => {
    await writeDist(dir)
    const net = world([
      () => json({ error: "E_GAME_NOT_FOUND", message: "no" }, 404),
    ])
    await refusalOf(publish(settings({ gameId: "../studios" }), net.deps))
    expect(net.sent[0]?.url).toBe(
      "https://studio.example/v1/games/..%2Fstudios/versions",
    )
  })

  test("nothing is sent when dist/ is not built", async () => {
    const net = world([])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.NOT_BUILT)
    expect(net.sent).toHaveLength(0)
  })

  test("a refusal carries the platform's own code, and nothing is read back", async () => {
    await writeDist(dir)
    const net = world([
      () =>
        json(
          {
            error: "E_VERSION_EXISTS",
            message: "version 1.2.0 of this game was already uploaded",
          },
          409,
        ),
    ])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.REFUSED)
    expect(refused.refusal).toBe("E_VERSION_EXISTS")
    expect(refused.status).toBe(409)
    expect(refused.message).toContain("already uploaded")
    expect(net.sent).toHaveLength(1)
  })

  test("an upload with no answer is not sent again", async () => {
    await writeDist(dir)
    const net = world([
      () => {
        throw new TypeError("connection refused")
      },
    ])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.UNREACHABLE)
    expect(refused.message).toContain("https://studio.example")
    expect(refused.message).toContain("connection refused")
    expect(net.sent).toHaveLength(1)
  })

  test("an answer that is not JSON is named as such, with its status", async () => {
    await writeDist(dir)
    const net = world([
      () => new Response("<html>Bad gateway</html>", { status: 502 }),
    ])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(refused.status).toBe(502)
  })

  test("a failing answer in JSON that is not a refusal is named as unreadable", async () => {
    await writeDist(dir)
    const net = world([() => json({ oops: true }, 500)])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(refused.status).toBe(500)
  })

  test("an accepted upload that does not name its studio cannot be followed", async () => {
    await writeDist(dir)
    const { studioId: _left, ...withoutStudio } = uploaded()
    const net = world([() => json(withoutStudio, 201)])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(net.sent).toHaveLength(1)
  })
})

describe("waiting for the checks", () => {
  test("reads the version under its studio until it is decided, a poll apart", async () => {
    await writeDist(dir)
    const net = world([
      () => json(uploaded(), 201),
      () => json(status("pending")),
      () => json(status("pending")),
      () => json(status("published")),
    ])
    const decided = await publish(settings(), net.deps)

    expect(decided.state).toBe("published")
    expect(net.sent).toHaveLength(4)
    for (const read of net.sent.slice(1)) {
      expect(read.url).toBe(
        `https://studio.example/v1/studios/${STUDIO}/versions/${VERSION_ID}`,
      )
      expect(read.init.method).toBe("GET")
      expect((read.init.headers as Record<string, string>).authorization).toBe(
        `Bearer ${KEY}`,
      )
    }
    expect(net.slept).toEqual([CHECK_POLL_MS, CHECK_POLL_MS])
    expect(net.logged.join("\n")).toContain(VERSION_ID)
    expect(net.logged.join("\n")).toContain("in release line 1.2")
  })

  test("a read the platform fails to answer is tried again", async () => {
    await writeDist(dir)
    const net = world([
      () => json(uploaded(), 201),
      () => {
        throw new TypeError("socket hang up")
      },
      () => json({ error: "E_INTERNAL", message: "internal" }, 503),
      () => new Response("Bad gateway", { status: 502 }),
      () => json(status("rejected", { rejectedCode: "E_DETERMINISM" })),
    ])
    const decided = await publish(settings(), net.deps)
    expect(decided.state).toBe("rejected")
    expect(net.slept).toHaveLength(3)
    expect(net.logged.filter((l) => l.includes("trying again"))).toHaveLength(3)
  })

  test("a refusal the platform meant stops the wait", async () => {
    await writeDist(dir)
    const net = world([
      () => json(uploaded(), 201),
      () => json({ error: "E_UNAUTHORIZED", message: "revoked" }, 401),
    ])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.refusal).toBe("E_UNAUTHORIZED")
    expect(net.sent).toHaveLength(2)
  })

  test("an answer that is not a version's state stops the wait", async () => {
    await writeDist(dir)
    const net = world([
      () => json(uploaded(), 201),
      () => json({ ...status("pending"), state: "in_review" }),
    ])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
  })

  test("still pending when the wait runs out names the version to read later", async () => {
    await writeDist(dir)
    const answers = [() => json(uploaded(), 201)]
    const reads = CHECK_WAIT_MS / CHECK_POLL_MS + 1
    for (let i = 0; i < reads; i += 1)
      answers.push(() => json(status("pending")))
    const net = world(answers)
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.STILL_CHECKING)
    expect(refused.message).toContain(VERSION_ID)
    expect(net.slept.reduce((a, b) => a + b, 0)).toBe(CHECK_WAIT_MS)
  })
})

describe("the verdict a build log shows", () => {
  test("published exits 0, and says its line and which runs it serves", () => {
    const verdict = verdictOf(status("published"))
    expect(verdict.exitCode).toBe(0)
    expect(verdict.lines[0]).toBe(
      "published version 1.2.0, in release line 1.2",
    )
    expect(verdict.lines[1]).toMatch(
      /^ranked runs: today's, from the next start/,
    )
    expect(verdict.lines[2]).toMatch(/^practice runs: from the next start/)
  })

  /**
   * A new minor passes at noon and today's ranked runs stay on the day's
   * line, so a build log that said only "published" would read as a ranked
   * day that changed. It still exits 0: the version passed and is published.
   */
  test("a version that serves no run yet still exits 0, and says when it will", () => {
    const waiting = verdictOf(
      status("published", {
        serving: { ranked: "from-next-seed", practice: false },
      }),
    )
    expect(waiting.exitCode).toBe(0)
    expect(waiting.lines[1]).toMatch(/^ranked runs: from the next day's seed/)
    expect(waiting.lines[2]).toMatch(/^practice runs: none/)

    const older = verdictOf(
      status("published", { serving: { ranked: "none", practice: false } }),
    )
    expect(older.exitCode).toBe(0)
    expect(older.lines[1]).toMatch(/^ranked runs: none/)
  })

  test("published and taken down exits 1, because no player is served it", () => {
    const verdict = verdictOf(status("published", { suspended: true }))
    expect(verdict.exitCode).toBe(1)
    expect(verdict.lines[0]).toContain("taken it down")
  })

  test("rejected exits 1 and names the code and the first failure", () => {
    const verdict = verdictOf(
      status("rejected", {
        rejectedCode: "E_DETERMINISM",
        firstFailure: {
          check: "determinism",
          code: "E_DETERMINISM",
          message: "two runs of one seed disagreed at tick 412",
        },
      }),
    )
    expect(verdict.exitCode).toBe(1)
    expect(verdict.lines).toEqual([
      "rejected version 1.2.0: E_DETERMINISM",
      "first failure: determinism, E_DETERMINISM: two runs of one seed disagreed at tick 412",
    ])
  })

  test("a rejection with no code or failure still says it was rejected", () => {
    const verdict = verdictOf(status("rejected"))
    expect(verdict.exitCode).toBe(1)
    expect(verdict.lines).toEqual(["rejected version 1.2.0: no code given"])
  })

  test("a version still being checked has no verdict", () => {
    expect(() => verdictOf(status("pending"))).toThrow()
  })
})

describe("what a refusal's detail says", () => {
  function refused(
    refusal: string,
    detail?: Readonly<Record<string, unknown>>,
  ): PublishError {
    return new PublishError(
      PUBLISH_ERROR.REFUSED,
      "the platform refused: no",
      refusal,
      409,
      detail,
    )
  }

  test("a patch that changes its line's rules names the fields and the minor to use", () => {
    expect(
      failureLines(
        refused("E_PATCH_CHANGES_RULES", {
          line: "1.2",
          comparedWith: "1.2.0",
          fields: ["inputs", "rankBy"],
          nextMinor: "1.3.0",
        }),
      ),
    ).toEqual([
      "the platform refused: no (E_PUBLISH_REFUSED, E_PATCH_CHANGES_RULES)",
      "release line 1.2 fixes inputs, rankBy, as 1.2.0 set them",
      "publish these rules as 1.3.0 instead",
    ])
  })

  test("a version that does not move forward names what it had to be above", () => {
    expect(
      failureLines(
        refused("E_VERSION_NOT_NEWER", {
          highestInLine: "1.2.4",
          highestInGame: "1.3.0",
        }),
      ).slice(1),
    ).toEqual([
      "the highest version in its release line is 1.2.4, and the highest the game has is 1.3.0",
    ])
    expect(
      failureLines(
        refused("E_VERSION_NOT_NEWER", {
          highestInLine: null,
          highestInGame: "2.0.0",
        }),
      ).slice(1),
    ).toEqual([
      "the highest version in its release line is none yet, and the highest the game has is 2.0.0",
    ])
  })

  test("any other detail, or one not the shape its code promises, is printed as sent", () => {
    expect(
      failureLines(refused("E_QUOTA_EXCEEDED", { used: 20 })).slice(1),
    ).toEqual(['detail: {"used":20}'])
    expect(
      failureLines(
        refused("E_PATCH_CHANGES_RULES", { line: "1.2", fields: "inputs" }),
      ).slice(1),
    ).toEqual(['detail: {"line":"1.2","fields":"inputs"}'])
    expect(
      failureLines(refused("E_VERSION_NOT_NEWER", { highestInLine: 3 })).slice(
        1,
      ),
    ).toEqual(['detail: {"highestInLine":3}'])
  })

  test("a refusal with no detail is its sentence alone", () => {
    expect(failureLines(refused("E_VERSION_EXISTS"))).toHaveLength(1)
  })

  test("the platform's detail reaches the error", async () => {
    await writeDist(dir)
    const detail = {
      line: "1.2",
      comparedWith: "1.2.0",
      fields: ["counters"],
      nextMinor: "1.3.0",
    }
    const net = world([
      () =>
        json(
          { error: "E_PATCH_CHANGES_RULES", message: "rules moved", detail },
          409,
        ),
    ])
    const error = await refusalOf(publish(settings(), net.deps))
    expect(error.refusal).toBe("E_PATCH_CHANGES_RULES")
    expect(error.detail).toEqual(detail)
  })

  test("a refusal whose detail is not an object is not read as a refusal", async () => {
    await writeDist(dir)
    const net = world([
      () => json({ error: "E_X", message: "x", detail: "words" }, 409),
    ])
    const error = await refusalOf(publish(settings(), net.deps))
    expect(error.code).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
  })
})

describe("the real command", () => {
  const CLI = resolve(import.meta.dir, "..", "..", "src", "cli", "index.ts")

  /**
   * A local platform answering the two routes. It records what arrived, so
   * the test reads the request a real fetch made rather than the one the
   * command meant to make.
   */
  function platform(decided: VersionStatus) {
    const seen: {
      origin: string | null
      authorization: string | null
      parts: Record<string, string>
      reads: number
    } = { origin: null, authorization: null, parts: {}, reads: 0 }
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const path = new URL(request.url).pathname
        if (
          request.method === "POST" &&
          path === `/v1/games/${GAME}/versions`
        ) {
          seen.origin = request.headers.get("origin")
          seen.authorization = request.headers.get("authorization")
          const form = await request.formData()
          for (const name of ["manifest", "sim", "present"]) {
            const part = form.get(name)
            seen.parts[name] =
              typeof part === "string" ? part : await (part as Blob).text()
          }
          return json(uploaded(), 201)
        }
        if (path === `/v1/studios/${STUDIO}/versions/${VERSION_ID}`) {
          seen.reads += 1
          return json(decided)
        }
        return json({ error: "E_NOT_FOUND", message: "no route" }, 404)
      },
    })
    return { server, seen }
  }

  async function run(api: string, env: Record<string, string>) {
    const child = Bun.spawn(
      ["bun", CLI, "publish", dir, "--game", GAME, "--api", api],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { PATH: process.env.PATH ?? "", ...env },
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, code }
  }

  test("uploads a build with no Origin header and exits 0 when it goes live", async () => {
    await writeDist(dir)
    const { server, seen } = platform(status("published"))
    try {
      const result = await run(`http://127.0.0.1:${server.port}`, {
        [STUDIO_KEY_VARIABLE]: KEY,
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain(
        "published version 1.2.0, in release line 1.2",
      )
      expect(result.stdout).toContain("ranked runs: today's")
      expect(result.stdout).toContain("practice runs: from the next start")
      expect(seen.origin).toBeNull()
      expect(seen.authorization).toBe(`Bearer ${KEY}`)
      expect(seen.parts).toEqual({
        manifest: MANIFEST,
        sim: new TextDecoder().decode(SIM),
        present: new TextDecoder().decode(PRESENT),
      })
      expect(seen.reads).toBe(1)
    } finally {
      server.stop(true)
    }
  })

  /**
   * The command holds the studio's secret key in its environment, so it
   * never evaluates what it uploads. A build whose modules would hand the
   * environment on, if anything ran them, is sent as bytes and never run.
   */
  test("runs none of the game's code, so nothing of it reads the key", async () => {
    const marker = join(dir, "ran.json")
    const handsOn = new TextEncoder().encode(
      `import { writeFileSync } from "node:fs"\n` +
        `writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.env))\n` +
        "export const MANIFEST = {}\n",
    )
    await writeDist(dir)
    await writeFile(join(dir, "dist", "sim.js"), handsOn)
    await writeFile(join(dir, "dist", "present.js"), handsOn)
    const { server, seen } = platform(status("published"))
    try {
      const result = await run(`http://127.0.0.1:${server.port}`, {
        [STUDIO_KEY_VARIABLE]: KEY,
      })
      expect(result.code).toBe(0)
      expect(seen.parts.sim).toBe(new TextDecoder().decode(handsOn))
      expect(seen.parts.present).toBe(new TextDecoder().decode(handsOn))
      expect(await Bun.file(marker).exists()).toBe(false)
    } finally {
      server.stop(true)
    }
  })

  test("exits 1 and prints the reason when the checks reject it", async () => {
    await writeDist(dir)
    const { server } = platform(
      status("rejected", { rejectedCode: "E_SEED_INSENSITIVE" }),
    )
    try {
      const result = await run(`http://127.0.0.1:${server.port}`, {
        [STUDIO_KEY_VARIABLE]: KEY,
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toContain(
        "rejected version 1.2.0: E_SEED_INSENSITIVE",
      )
    } finally {
      server.stop(true)
    }
  })

  test("exits 1 and prints a refusal's detail when the platform refuses the upload", async () => {
    await writeDist(dir)
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        json(
          {
            error: "E_PATCH_CHANGES_RULES",
            message: "version 1.2.1 changes what release line 1.2 fixes",
            detail: {
              line: "1.2",
              comparedWith: "1.2.0",
              fields: ["inputs"],
              nextMinor: "1.3.0",
            },
          },
          409,
        ),
    })
    try {
      const result = await run(`http://127.0.0.1:${server.port}`, {
        [STUDIO_KEY_VARIABLE]: KEY,
      })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("E_PATCH_CHANGES_RULES")
      expect(result.stderr).toContain(
        "release line 1.2 fixes inputs, as 1.2.0 set them",
      )
      expect(result.stderr).toContain("publish these rules as 1.3.0 instead")
    } finally {
      server.stop(true)
    }
  })

  test("exits 1 without sending anything when the key is missing", async () => {
    await writeDist(dir)
    const { server, seen } = platform(status("published"))
    try {
      const result = await run(`http://127.0.0.1:${server.port}`, {})
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(PUBLISH_ERROR.NO_KEY)
      expect(seen.authorization).toBeNull()
      expect(seen.reads).toBe(0)
    } finally {
      server.stop(true)
    }
  })
})

describe("what a new game carries", () => {
  /**
   * npm runs a script named `publish` by itself, as a step of `npm publish`,
   * so a template script by that name would upload a game whenever somebody
   * published it as a package.
   */
  test("the template names no script publish", async () => {
    const manifest = JSON.parse(
      await readFile(join(TEMPLATE_DIR, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> }
    expect(Object.keys(manifest.scripts ?? {})).not.toContain("publish")
  })
})

describe("answers that go wrong partway", () => {
  /** A response whose headers arrived and whose body then broke off. */
  function brokenOff(): Response {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError("connection reset"))
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  test("an upload answer that breaks off is no answer, and is not sent again", async () => {
    await writeDist(dir)
    const net = world([brokenOff])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.UNREACHABLE)
    expect(refused.message).toContain("connection reset")
    expect(net.sent).toHaveLength(1)
  })

  test("a read that breaks off, or is asked to slow down, is tried again", async () => {
    await writeDist(dir)
    const net = world([
      () => json(uploaded(), 201),
      brokenOff,
      () => json({ error: "E_RATE_LIMITED", message: "slow down" }, 429),
      () => json(status("published")),
    ])
    const decided = await publish(settings(), net.deps)
    expect(decided.state).toBe("published")
    expect(net.slept).toEqual([CHECK_POLL_MS, CHECK_POLL_MS])
  })

  test("an accepted upload that names no studio says where the version went", async () => {
    await writeDist(dir)
    const { studioId: _left, ...withoutStudio } = uploaded()
    const net = world([() => json(withoutStudio, 201)])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(refused.message).toContain(VERSION_ID)
  })
})

describe("a version's answer is checked in every field the verdict reads", () => {
  async function readBack(answer: unknown): Promise<PublishErrorCode | "ok"> {
    await writeDist(dir)
    const net = world([() => json(uploaded(), 201), () => json(answer)])
    try {
      await publish(settings(), net.deps)
      return "ok"
    } catch (error) {
      if (error instanceof PublishError) return error.code
      throw error
    }
  }

  test("an answer with no suspended flag is not read as served", async () => {
    const { suspended: _left, ...answer } = status("published")
    expect(await readBack(answer)).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
  })

  test("a rejection whose first failure is malformed is not printed half-read", async () => {
    expect(
      await readBack({
        ...status("rejected", { rejectedCode: "E_DETERMINISM" }),
        firstFailure: { check: "determinism" },
      }),
    ).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(
      await readBack({ ...status("rejected"), firstFailure: undefined }),
    ).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(await readBack({ ...status("rejected"), rejectedCode: 7 })).toBe(
      PUBLISH_ERROR.ANSWER_UNREADABLE,
    )
  })

  test("an answer that does not say its line or which runs it serves is unreadable", async () => {
    const { line: _line, ...noLine } = status("published")
    expect(await readBack(noLine)).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    const { serving: _serving, ...noServing } = status("published")
    expect(await readBack(noServing)).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(
      await readBack({
        ...status("published"),
        serving: { ranked: "tomorrow", practice: true },
      }),
    ).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(
      await readBack({
        ...status("published"),
        serving: { ranked: "today", practice: "yes" },
      }),
    ).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(await readBack({ ...status("published"), serving: "today" })).toBe(
      PUBLISH_ERROR.ANSWER_UNREADABLE,
    )
  })

  test("an upload answer that does not name its line is unreadable", async () => {
    await writeDist(dir)
    const { line: _line, ...noLine } = uploaded()
    const net = world([() => json(noLine, 201)])
    const refused = await refusalOf(publish(settings(), net.deps))
    expect(refused.code).toBe(PUBLISH_ERROR.ANSWER_UNREADABLE)
    expect(refused.message).toContain(VERSION_ID)
  })

  test("a complete answer passes", async () => {
    expect(await readBack(status("published"))).toBe("ok")
  })
})

describe("an empty setting", () => {
  test("an empty VBZ_API_ORIGIN reads as unset, as a CI system's optional variable does", () => {
    expect(
      publishSettings(
        { dir, game: GAME, api: undefined },
        { [STUDIO_KEY_VARIABLE]: KEY, [API_ORIGIN_VARIABLE]: "  " },
      ).apiOrigin,
    ).toBe(DEFAULT_API_ORIGIN)
  })

  test("an empty --api is still refused, because somebody typed it", () => {
    expect(
      settingsRefusal(
        { dir, game: GAME, api: "" },
        { [STUDIO_KEY_VARIABLE]: KEY },
      ),
    ).toBe(PUBLISH_ERROR.BAD_API_ORIGIN)
  })
})
