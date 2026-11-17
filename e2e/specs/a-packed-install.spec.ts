/**
 * A studio's page as a studio builds one: `@vbz-gg/sdk` installed from its
 * packed tarball, bundled by the studio's own bundler, loading a game's page
 * module from another origin.
 *
 * `loadGame` imports a URL it is handed at run time. A bundler that took
 * that import for one of its own would replace it with a lookup in its own
 * module table, which finds nothing, and the page would never load a game.
 * Two comments in the package's `dist` tell webpack and Vite to leave it to
 * the browser, and `check:publishable` holds the tarball to carrying both.
 * Measured with each bundler's production build, as a studio runs one:
 * without its comment webpack warns that the request is an expression and
 * the page loads nothing, while Vite 8 and esbuild leave an import of a
 * variable alone with or without one.
 *
 * The package is the one the suite's servers packed and unpacked beside the
 * engine, with nothing of this repository's workspace in reach. The page is
 * `e2e/packed/`, and each build is served under the policy the SDK
 * recommends, naming the game's path on the studio's bundles origin.
 */

import { copyFile, mkdir, readFile, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { dirname, extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { build as esbuild } from "esbuild"
import { createLogger, build as viteBuild } from "vite"
import webpack from "webpack"
import { pageCsp } from "../../packages/sdk/src/harness/csp"
import { SUBJECTS } from "../src/env"
import { studio } from "../src/studio"

const PAGE = fileURLToPath(new URL("../packed", import.meta.url))

/** A build of the page, from `dir` into `out`; it answers any warning it gave. */
type Bundle = (dir: string, out: string) => Promise<string[]>

const BUNDLERS: Readonly<Record<string, Bundle>> = {
  vite: async (dir, out) => {
    const warnings: string[] = []
    const logger = createLogger("warn")
    logger.warn = (message) => {
      warnings.push(message)
    }
    await viteBuild({
      root: dir,
      configFile: false,
      logLevel: "warn",
      customLogger: logger,
      build: { outDir: out, emptyOutDir: true },
    })
    return warnings
  },
  webpack: (dir, out) =>
    new Promise((resolve, reject) => {
      webpack(
        {
          mode: "production",
          context: dir,
          entry: "./main.js",
          output: { path: out, filename: "main.js" },
          target: "web",
        },
        (error, stats) => {
          if (error !== null && error !== undefined) {
            reject(error)
            return
          }
          if (stats === undefined || stats.hasErrors()) {
            reject(new Error(stats?.toString("errors-only") ?? "no stats"))
            return
          }
          const { warnings = [] } = stats.toJson({ warnings: true })
          copyFile(join(dir, "index.html"), join(out, "index.html")).then(
            () => resolve(warnings.map((warning) => warning.message)),
            reject,
          )
        },
      )
    }),
  esbuild: async (dir, out) => {
    const result = await esbuild({
      entryPoints: [join(dir, "main.js")],
      bundle: true,
      format: "esm",
      platform: "browser",
      minify: true,
      outfile: join(out, "main.js"),
      logLevel: "silent",
    })
    await copyFile(join(dir, "index.html"), join(out, "index.html"))
    return result.warnings.map((warning) => warning.text)
  },
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
}

/** Serves `dir` under `policy`, as a studio's host serves its page. */
async function serve(dir: string, policy: string): Promise<Server> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://page").pathname
    const file = normalize(join(dir, path === "/" ? "index.html" : path))
    if (!file.startsWith(`${dir}${sep}`)) {
      response.writeHead(404).end()
      return
    }
    readFile(file).then(
      (body) => {
        response.writeHead(200, {
          "content-type": TYPES[extname(file)] ?? "application/octet-stream",
          "content-security-policy": policy,
          "cache-control": "no-store",
        })
        response.end(body)
      },
      () => response.writeHead(404).end(),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return server
}

for (const [name, bundle] of Object.entries(BUNDLERS)) {
  test(`a page bundled with ${name} from the packed package loads a game from another origin, and plays it`, async ({
    page,
  }) => {
    const { nodeModules, bundlesOrigin, modules } = await studio()
    const game = modules.template
    if (game === undefined) throw new Error("the studio holds no template")
    // Beside the unpacked package, so the bundler finds it and nothing else.
    const dir = join(dirname(nodeModules), "pages", name)
    const out = join(dir, "out")
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    for (const file of ["main.js", "index.html"]) {
      await copyFile(join(PAGE, file), join(dir, file))
    }

    const warnings = await bundle(dir, out)
    // Without its comment, webpack warns that the import's request is an
    // expression and Vite that it cannot analyse the import.
    expect(
      warnings.filter((warning) => /import|dependency/i.test(warning)),
    ).toEqual([])

    const server = await serve(
      out,
      pageCsp({ bundlesOrigin, gameId: SUBJECTS.template.gameId }),
    )
    try {
      const { port } = server.address() as AddressInfo
      const query = new URLSearchParams({
        present: game.presentUrl,
        hash: game.manifestHash,
        files: game.filesUrl,
        tickHz: String(game.tickHz),
      })
      await page.goto(`http://127.0.0.1:${port}/?${query}`)
      await expect(page.locator("body")).toHaveAttribute("data-loaded", "ready")
      await expect(page.locator("body")).toHaveAttribute("data-tick", /^[1-9]/)
      expect(await page.locator("body").getAttribute("data-failed")).toBeNull()
    } finally {
      server.close()
    }
  })
}
