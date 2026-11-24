/**
 * A package registry that holds the packed SDK and engine, for the spec that
 * installs them the way an author does.
 *
 * It answers each held package's document and tarball as npm's registry
 * would, and passes a request for any other package on to npm's registry, so
 * a game's own dependencies, such as `typescript`, install as they would
 * anywhere. The two held packages never come from npm, even though npm has
 * versions with the same numbers: those are the releases before this tree.
 *
 * bun reads the registry from `BUN_CONFIG_REGISTRY`, for `bun install` and
 * for `bunx` alike. Measured with bun 1.3.11: `bunx @vbz-gg/sdk new` asked
 * this registry for both packages, installed the engine as the SDK's peer
 * beside it, and ran the SDK's `vbz`. A `bunfig.toml` naming the registry in
 * the directory `bunx` ran in reached nothing here, and `bunx` installed
 * npm's published 0.5.1 instead. And `bunx` keeps its install in
 * `$TMPDIR/bunx-<uid>-@vbz-gg/sdk@latest/`, lockfile included, and reused it
 * on the next run, so a spec gives every run a `TMPDIR` of its own.
 *
 * This runs in the servers' process, under bun, whose `fetch` goes through
 * the machine's proxy when one is configured.
 */

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { $ } from "bun"

export const UPSTREAM = "https://registry.npmjs.org"

/** A package the registry holds: its manifest, and the tarball it came in. */
export interface HeldPackage {
  readonly name: string
  readonly version: string
  readonly manifest: Readonly<Record<string, unknown>>
  readonly tarball: string
  readonly bytes: Uint8Array<ArrayBuffer>
}

/** Reads a packed tarball's own `package.json`, which is what it installs as. */
export async function hold(tarball: string): Promise<HeldPackage> {
  const text = await $`tar -xzOf ${tarball} package/package.json`.text()
  const manifest = JSON.parse(text) as Record<string, unknown>
  const { name, version } = manifest
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error(`${tarball} has no name and version`)
  }
  return {
    name,
    version,
    manifest,
    tarball,
    bytes: new Uint8Array(await readFile(tarball)),
  }
}

/** The document npm's registry answers for a package, holding one version. */
function packument(held: HeldPackage, origin: string): unknown {
  return {
    name: held.name,
    "dist-tags": { latest: held.version },
    versions: {
      [held.version]: {
        ...held.manifest,
        dist: {
          tarball: `${origin}/-/${basename(held.tarball)}`,
          shasum: createHash("sha1").update(held.bytes).digest("hex"),
          integrity: `sha512-${createHash("sha512").update(held.bytes).digest("base64")}`,
        },
      },
    },
  }
}

export interface RunningRegistry {
  readonly origin: string
  stop(): Promise<void>
}

/**
 * Serves `packages` on a free port, and every other package from npm's
 * registry. Each request is handed to `log` as `METHOD /path`, decoded, so a
 * spec can see which packages came from here.
 */
export function startRegistry(
  packages: readonly HeldPackage[],
  log: (line: string) => void,
): RunningRegistry {
  const byName = new Map(packages.map((held) => [held.name, held]))
  const byFile = new Map(packages.map((held) => [basename(held.tarball), held]))
  let origin = ""
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      log(`${request.method} ${path}`)
      const file = /^\/-\/([^/]+\.tgz)$/.exec(path)?.[1]
      if (file !== undefined) {
        const held = byFile.get(file)
        return held === undefined
          ? new Response("not held here", { status: 404 })
          : new Response(held.bytes, {
              headers: { "content-type": "application/octet-stream" },
            })
      }
      const held = byName.get(path.slice(1))
      if (held !== undefined) return Response.json(packument(held, origin))
      const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
        headers: { accept: request.headers.get("accept") ?? "*/*" },
      })
      return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers: {
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        },
      })
    },
  })
  origin = `http://127.0.0.1:${server.port}`
  return {
    origin,
    stop: async () => {
      await server.stop(true)
    },
  }
}
