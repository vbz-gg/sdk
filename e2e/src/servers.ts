/**
 * Everything the suite drives, served by one process.
 *
 * One process, because Playwright starts a `webServer` by waiting on a URL,
 * and every server behind one health check is one wait. It serves:
 *
 * - **Each subject's harness**, as `vbz dev` serves it to an author: the
 *   harness page on one origin and the game's two modules on another. Each
 *   game is built through the real CLI first, so the manifest the harness
 *   reads is this build's and not one left in a working tree.
 * - **The suite's studio page**, on an origin of its own, standing in for a
 *   page a studio serves its game from, and a bundles origin standing in for
 *   the platform's, which holds every game's modules under its own path. The
 *   page plays runs against a stand-in for the platform per game.
 * - **Page modules from other releases**: the template as the first release
 *   of contract 1 built it, committed and never rebuilt, and the template
 *   built against a packed copy of this package that says it speaks a
 *   contract no release drives yet.
 * - **This package, packed and installed apart**, the way a studio gets it
 *   from npm, for the spec that bundles a page with it.
 * - **A package registry** holding that tarball and one of the engine, for
 *   the spec that makes a game with `vbz new` and `bunx` the way an author
 *   does. Every other package it fetches from npm.
 * - **A control origin** a spec asks where everything is, and reads the
 *   bundles origins' request logs from.
 *
 * It imports the SDK by relative path rather than by package name, as the
 * unit tests do. What a consumer gets from the package's exports map is the
 * packed copy's business, and `check:publishable`'s.
 */

import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashCanonical, type PlainValue } from "@clockwork2/engine"
import { $ } from "bun"
import {
  EMPTY_LISTING,
  filesBaseFor,
  type GameSource,
  listingSha256,
  presentPathFor,
  sha256Hex,
  simPathFor,
} from "../../packages/sdk/src/build/index"
import { main } from "../../packages/sdk/src/cli/index"
import {
  type BuiltGame,
  blobKeys,
  buildAndAddress,
  HARNESS_SEED,
  LOOPBACK,
  pageCsp,
  type RunningStandIn,
  startHarness,
  startStandIn,
} from "../../packages/sdk/src/harness"
import { readBuiltManifest } from "../../packages/sdk/src/harness/dist-manifest"
import { createBlobServer, JS_CONTENT_TYPE } from "../../packages/sdk/src/serve"
import {
  CONTROL_PORT,
  STUDIO_BUNDLES_PORT,
  STUDIO_ORIGIN,
  STUDIO_PORT,
  SUBJECTS,
  type SubjectName,
} from "./env"
import { hold, startRegistry } from "./registry"

const ROOT = join(import.meta.dir, "..", "..")
const PAGE = join(import.meta.dir, "..", "page")

/** Where the entries are in both subjects, as in every game `vbz new` makes. */
const ENTRIES = {
  simEntry: "src/sim/index.ts",
  presentEntry: "src/present.ts",
  captureEntry: "src/capture.ts",
} as const

function sourceAt(root: string): GameSource {
  // Neither subject names a files folder.
  return { root, ...ENTRIES, filesDir: null }
}

// The SDK's own `dist` first: the subjects' page modules bundle
// `@vbz-gg/sdk/game` from it, and a stale one would be what the suite tests.
await $`bun run build`.cwd(ROOT).quiet()

const work = await mkdtemp(join(tmpdir(), "sdk-e2e-"))
async function cleanUp(): Promise<void> {
  await rm(work, { recursive: true, force: true })
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void cleanUp().finally(() => process.exit(0))
  })
}

interface HarnessInfo {
  readonly hostOrigin: string
  readonly bundlesOrigin: string
  /** The paths each module is served at, which are their content addresses. */
  readonly sim: string
  readonly present: string
}

const harnesses = new Map<SubjectName, HarnessInfo>()

/**
 * Every path a bundles origin was asked for, by subject and for the studio's.
 * Reading the server's log rather than the page's `performance` entries
 * observes the network itself.
 */
const requests = new Map<string, string[]>()

const manifests = new Map<SubjectName, unknown>()

for (const name of Object.keys(SUBJECTS) as SubjectName[]) {
  const subject = SUBJECTS[name]
  const dir = join(ROOT, ...subject.dir)
  const log: string[] = []
  requests.set(name, log)

  const code = await main(["build", dir])
  if (code !== 0) throw new Error(`${name} did not build`)
  manifests.set(name, await readBuiltManifest(dir))

  const harness = await startHarness({
    source: sourceAt(dir),
    hostPort: subject.hostPort,
    bundlesPort: subject.bundlesPort,
    onRequest: (path) => log.push(path),
    // The specs' runs are held to a ranked run's input budget.
    ranked: true,
  })
  const keys = blobKeys(harness.built)
  harnesses.set(name, {
    hostOrigin: harness.hostOrigin,
    bundlesOrigin: harness.bundlesOrigin,
    sim: `/${keys.sim}`,
    present: `/${keys.present}`,
  })
}

/**
 * This package as npm would hand it to a studio: packed, unpacked into a
 * `node_modules` of its own beside the engine, and nothing of this
 * repository's workspace in reach.
 *
 * The engine is packed too, from the copy installed here, which `npm pack`
 * reproduces file for file. The two tarballs are what the registry below
 * holds.
 */
const nodeModules = join(work, "node_modules")
const tarballs = join(work, "tarballs")
await mkdir(tarballs, { recursive: true })
const engineDir = await realpath(
  join(ROOT, "node_modules", "@clockwork2", "engine"),
)
await $`npm pack --pack-destination ${tarballs}`
  .cwd(join(ROOT, "packages", "sdk"))
  .quiet()
await $`npm pack ${engineDir} --ignore-scripts --pack-destination ${tarballs}`
  .cwd(work)
  .quiet()
const registryHolds = await Promise.all(
  [...new Bun.Glob("*.tgz").scanSync(tarballs)].map((file) =>
    hold(join(tarballs, file)),
  ),
)
function tarballOf(name: string): string {
  const found = registryHolds.find((pkg) => pkg.name === name)
  if (found === undefined) throw new Error(`npm pack produced no ${name}`)
  return found.tarball
}
const packed = {
  sdk: tarballOf("@vbz-gg/sdk"),
  engine: tarballOf("@clockwork2/engine"),
}
await $`tar -xzf ${packed.sdk} -C ${work}`.quiet()
await mkdir(join(nodeModules, "@vbz-gg"), { recursive: true })
await rename(join(work, "package"), join(nodeModules, "@vbz-gg", "sdk"))
await mkdir(join(nodeModules, "@clockwork2"), { recursive: true })
await symlink(engineDir, join(nodeModules, "@clockwork2", "engine"))

const registryLog: string[] = []
const registry = startRegistry(registryHolds, (line) => registryLog.push(line))

/**
 * The template's source, copied into `work` and built there against a copy of
 * the packed package of its own, with `edit` applied to that copy's
 * `dist/game/contract.js`: a page module as a later release would build it.
 */
async function templateBuiltApart(
  name: string,
  edit: (contract: string) => string,
): Promise<BuiltGame> {
  const root = join(work, name)
  await cp(join(ROOT, ...SUBJECTS.template.dir, "src"), join(root, "src"), {
    recursive: true,
  })
  const copy = join(root, "node_modules", "@vbz-gg", "sdk")
  await mkdir(join(root, "node_modules", "@vbz-gg"), { recursive: true })
  await cp(join(nodeModules, "@vbz-gg", "sdk"), copy, { recursive: true })
  const file = join(copy, "dist", "game", "contract.js")
  const before = await readFile(file, "utf8")
  const after = edit(before)
  if (after === before) throw new Error(`${name}: the edit changed nothing`)
  await writeFile(file, after)
  return await buildAndAddress(sourceAt(root), SUBJECTS.template.gameId)
}

/**
 * A module as the studio's bundles origin holds it, with the manifest it was
 * built with. A frozen module keeps the manifest its own release wrote: the
 * template's today names a later engine, so its hash is another game's.
 */
interface Held {
  readonly game: SubjectName
  readonly manifest: unknown
  readonly sim: Uint8Array
  readonly simKey: string
  readonly present: Uint8Array
  readonly presentKey: string
  /** The files folder's base, without the leading slash. */
  readonly filesKey: string
}

function held(game: SubjectName, built: BuiltGame): Held {
  const keys = blobKeys(built)
  return {
    game,
    manifest: manifests.get(game),
    sim: built.sim,
    simKey: keys.sim,
    present: built.present,
    presentKey: keys.present,
    filesKey: keys.files,
  }
}

/**
 * The template's two modules as the first release of contract 1 built them,
 * committed and never rebuilt, so a page built from this tree is held to
 * playing what an earlier release built. Its folder's README says more.
 */
async function frozen(folder: string): Promise<Held> {
  const dir = join(import.meta.dir, "..", "frozen", folder)
  const sim = new Uint8Array(await readFile(join(dir, "sim.js")))
  const present = new Uint8Array(await readFile(join(dir, "present.js")))
  const { gameId } = SUBJECTS.template
  const simKey = simPathFor(gameId, sha256Hex(sim)).slice(1)
  // A file edited by accident names a rules code nobody stored.
  if (!new TextDecoder().decode(present).includes(`"/${simKey}"`)) {
    throw new Error(`${folder}/present.js does not import ${folder}/sim.js`)
  }
  return {
    game: "template",
    manifest: JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")),
    sim,
    simKey,
    present,
    presentKey: presentPathFor(gameId, sha256Hex(present)).slice(1),
    // A contract-1 module knows no folder; a page names one all the same.
    filesKey: filesBaseFor(gameId, listingSha256(EMPTY_LISTING)).slice(1),
  }
}

/** Every module the studio's bundles origin serves, by the name a page loads it with. */
const studioModules = {
  template: held(
    "template",
    await buildAndAddress(
      sourceAt(join(ROOT, ...SUBJECTS.template.dir)),
      SUBJECTS.template.gameId,
    ),
  ),
  paddle: held(
    "paddle",
    await buildAndAddress(
      sourceAt(join(ROOT, ...SUBJECTS.paddle.dir)),
      SUBJECTS.paddle.gameId,
    ),
  ),
  "contract-1": await frozen("contract-1"),
  // A release that has moved on to a contract this tree's pages do not
  // drive, which is the one thing a page must refuse rather than misread.
  "contract-3": held(
    "template",
    await templateBuiltApart("contract-3", (text) =>
      text.replace(
        "export const PAGE_MODULE_CONTRACT = 2;",
        "export const PAGE_MODULE_CONTRACT = 3;",
      ),
    ),
  ),
} as const

type ModuleName = keyof typeof studioModules

const studioBlobs = new Map<string, Uint8Array>()
for (const module of Object.values(studioModules)) {
  studioBlobs.set(module.simKey, module.sim)
  studioBlobs.set(module.presentKey, module.present)
}
const studioLog: string[] = []
requests.set("studio", studioLog)
requests.set("registry", registryLog)
/** Paths the next request for which fails, once, as a network would. */
const failOnce = new Set<string>()
const serveStudioBlob = createBlobServer(async (key) => studioBlobs.get(key))
const studioBundles = Bun.serve({
  port: STUDIO_BUNDLES_PORT,
  hostname: LOOPBACK.hostname,
  fetch: (request) => {
    const { pathname } = new URL(request.url)
    studioLog.push(pathname)
    if (failOnce.delete(pathname)) {
      return new Response("unavailable", {
        status: 503,
        headers: {
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
          "content-type": JS_CONTENT_TYPE,
        },
      })
    }
    return serveStudioBlob(request)
  },
})
const studioBundlesOrigin = `http://${LOOPBACK.hostname}:${studioBundles.port}`

function presentUrlOf(name: ModuleName): string {
  return `${studioBundlesOrigin}/${studioModules[name].presentKey}`
}

function filesUrlOf(name: ModuleName): string {
  return `${studioBundlesOrigin}/${studioModules[name].filesKey}`
}

interface Module {
  readonly presentUrl: string
  readonly manifestHash: string
  readonly filesUrl: string
  readonly tickHz: number
}

const modules: Record<string, Module> = {}
for (const name of Object.keys(studioModules) as ModuleName[]) {
  const manifest = studioModules[name].manifest as {
    readonly session: { readonly tickHz: number }
  }
  modules[name] = {
    presentUrl: presentUrlOf(name),
    manifestHash: hashCanonical(manifest as unknown as PlainValue),
    filesUrl: filesUrlOf(name),
    tickHz: manifest.session.tickHz,
  }
}

const standIns = new Map<SubjectName, RunningStandIn>()
for (const name of Object.keys(SUBJECTS) as SubjectName[]) {
  standIns.set(
    name,
    startStandIn({
      manifest: manifests.get(name),
      presentUrl: presentUrlOf(name),
      filesUrl: filesUrlOf(name),
      gameId: SUBJECTS[name].gameId,
      siteOrigin: STUDIO_ORIGIN,
      seed: HARNESS_SEED,
      listen: LOOPBACK,
    }),
  )
}

const pageBuild = await Bun.build({
  entrypoints: [join(PAGE, "main.ts")],
  target: "browser",
  format: "esm",
})
const pageOutput = pageBuild.outputs[0]
if (!pageBuild.success || pageOutput === undefined) {
  throw new Error(
    `the studio page did not build:\n${pageBuild.logs.map(String).join("\n")}`,
  )
}
const pageScript = await pageOutput.text()
const pageHtml = await readFile(join(PAGE, "index.html"), "utf8")
const pageStyle = await readFile(join(PAGE, "page.css"), "utf8")

function subjectOf(url: URL): SubjectName | null {
  const name = url.searchParams.get("game") ?? "template"
  return name in SUBJECTS ? (name as SubjectName) : null
}

const NO_STORE = { "cache-control": "no-store" }

Bun.serve({
  port: STUDIO_PORT,
  hostname: LOOPBACK.hostname,
  fetch: (request) => {
    const url = new URL(request.url)
    const name = subjectOf(url)
    const standIn = name === null ? undefined : standIns.get(name)
    if (name === null || standIn === undefined) {
      return new Response("no such game", { status: 404 })
    }
    if (url.pathname === "/") {
      return new Response(pageHtml, {
        headers: {
          ...NO_STORE,
          "content-type": "text/html; charset=utf-8",
          // The policy the SDK recommends a studio's page sends, naming the
          // one game this page plays.
          "content-security-policy": pageCsp({
            bundlesOrigin: studioBundlesOrigin,
            gameId: SUBJECTS[name].gameId,
            connect: [standIn.apiOrigin],
          }),
        },
      })
    }
    if (url.pathname === "/main.js") {
      return new Response(pageScript, {
        headers: { ...NO_STORE, "content-type": JS_CONTENT_TYPE },
      })
    }
    if (url.pathname === "/page.css") {
      return new Response(pageStyle, {
        headers: { ...NO_STORE, "content-type": "text/css; charset=utf-8" },
      })
    }
    if (url.pathname === "/config.json") {
      return Response.json(
        {
          apiOrigin: standIn.apiOrigin,
          signInOrigin: standIn.signInOrigin,
          pageKey: standIn.pageKey,
          seed: HARNESS_SEED,
          modules,
        },
        { headers: NO_STORE },
      )
    }
    return new Response("not found", { status: 404 })
  },
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })
}

Bun.serve({
  port: CONTROL_PORT,
  hostname: LOOPBACK.hostname,
  fetch: (request) => {
    const url = new URL(request.url)
    if (url.pathname === "/health") return new Response("ok")
    if (url.pathname === "/subjects") {
      return json(Object.fromEntries(harnesses))
    }
    if (url.pathname === "/studio") {
      return json({
        origin: STUDIO_ORIGIN,
        bundlesOrigin: studioBundlesOrigin,
        modules,
        nodeModules,
        registry: registry.origin,
        tarballs: packed,
      })
    }
    // The next request for a module's page module fails, once.
    const failing = url.pathname.match(/^\/studio\/fail-once\/([a-z0-9-]+)$/)
    if (failing !== null && request.method === "POST") {
      const module = modules[failing[1] as string]
      if (module === undefined) {
        return new Response("no such module", { status: 404 })
      }
      failOnce.add(new URL(module.presentUrl).pathname)
      return new Response("armed")
    }
    // A spec reads the log for the run it just drove, so it clears the log
    // before navigating rather than reasoning about what an earlier test left.
    const asked = url.pathname.match(/^\/requests\/([a-z]+)$/)
    if (asked !== null) {
      const log = requests.get(asked[1] as string)
      if (log === undefined) {
        return new Response("no such log", { status: 404 })
      }
      if (request.method === "DELETE") {
        log.length = 0
        return new Response("cleared")
      }
      return json(log)
    }
    return new Response("not found", { status: 404 })
  },
})

process.stdout.write(`control http://127.0.0.1:${CONTROL_PORT}\n`)
for (const [name, harness] of harnesses) {
  process.stdout.write(`  ${name}  ${harness.hostOrigin}\n`)
}
process.stdout.write(`  studio  ${STUDIO_ORIGIN}\n`)
