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
 *   the platform's, which holds every game's modules and files under its own
 *   path. The page plays runs against a stand-in for the platform per game,
 *   or plays one locally, asking no platform anything.
 * - **Page modules from other releases**: the template as the first release
 *   of contract 1 built it, committed and never rebuilt, and the template
 *   built against a packed copy of this package that says it speaks a
 *   contract no release drives yet.
 * - **This package, packed and installed apart**, the way a studio gets it
 *   from npm, for the spec that bundles a page with it.
 * - **A package registry** holding that tarball and one of the engine, for
 *   the spec that makes a game with `vbz new` and `bunx` the way an author
 *   does. Every other package it fetches from npm.
 * - **A host that is not this kit's**: a plain file server holding the
 *   template's `dist/addressed/`, as `vbz build --addressed` wrote it, at
 *   its root, sending only the headers the guide lists, and a page on an
 *   origin of its own that plays the build from there.
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
import type { AddressedBuild } from "../../packages/sdk/src/cli/build"
import { main } from "../../packages/sdk/src/cli/index"
import { filesDirOf, needsOf } from "../../packages/sdk/src/cli/source"
import {
  type BuiltGame,
  blobKeys,
  buildAndAddress,
  type GameNeeds,
  HARNESS_SEED,
  LOOPBACK,
  pageCsp,
  type RunningStandIn,
  startHarness,
  startStandIn,
  versionNeeds,
} from "../../packages/sdk/src/harness"
import { readBuiltManifest } from "../../packages/sdk/src/harness/dist-manifest"
import { createBlobServer, JS_CONTENT_TYPE } from "../../packages/sdk/src/serve"
import {
  ADDRESSED_FILES_ORIGIN,
  ADDRESSED_FILES_PORT,
  ADDRESSED_PAGE_ORIGIN,
  ADDRESSED_PAGE_PORT,
  CONTROL_PORT,
  PORTAL_ORIGIN,
  PORTAL_PORT,
  SIGN_IN_HOST,
  STUDIO_BUNDLES_PORT,
  STUDIO_ORIGIN,
  STUDIO_PORT,
  SUBJECTS,
  SUITE_SIGN_IN_READY_MS,
  type SubjectName,
} from "./env"
import { hold, startRegistry } from "./registry"

const ROOT = join(import.meta.dir, "..", "..")
const PAGE = join(import.meta.dir, "..", "page")
const ADDRESSED_PAGE = join(import.meta.dir, "..", "addressed")

/** Where the entries are in every subject, as in every game `vbz new` makes. */
const ENTRIES = {
  simEntry: "src/sim/index.ts",
  presentEntry: "src/present.ts",
  captureEntry: "src/capture.ts",
} as const

/** A game's source, with the files folder its `package.json` names, if any. */
async function sourceAt(root: string): Promise<GameSource> {
  return { root, ...ENTRIES, filesDir: await filesDirOf(root) }
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
    source: await sourceAt(dir),
    needs: await needsOf(dir),
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
 * The template at its content addresses, written by the real CLI with
 * `vbz build --addressed`, and moved out of the template's `dist/` into
 * `work`: the folder this suite serves is the one the command wrote, and
 * the package packed below carries none of it. Building again leaves the
 * rest of `dist/` as the build above wrote it, byte for byte.
 */
const addressedFolder = join(work, "addressed")
const addressedBuild = await (async (): Promise<AddressedBuild> => {
  const dir = join(ROOT, ...SUBJECTS.template.dir)
  const code = await main(["build", dir, "--addressed"])
  if (code !== 0) throw new Error("the template did not build with --addressed")
  await cp(join(dir, "dist", "addressed"), addressedFolder, { recursive: true })
  const json = join(dir, "dist", "addressed.json")
  const build = JSON.parse(await readFile(json, "utf8")) as AddressedBuild
  await rm(join(dir, "dist", "addressed"), { recursive: true, force: true })
  await rm(json, { force: true })
  return build
})()

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
  return await buildAndAddress(await sourceAt(root), SUBJECTS.template.gameId)
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
  /** Each file of the folder, by its key on the bundles origin. */
  readonly files: ReadonlyMap<string, Uint8Array>
  /** What a page's policy has to allow for it beyond its two modules. */
  readonly needs: GameNeeds
}

/** A build, as the bundles origin holds it, with what its page's policy needs. */
async function held(game: SubjectName, built: BuiltGame): Promise<Held> {
  const keys = blobKeys(built)
  const files = new Map<string, Uint8Array>()
  for (const [path, onDisk] of built.filesOnDisk) {
    files.set(`${keys.files}${path}`, new Uint8Array(await readFile(onDisk)))
  }
  return {
    game,
    manifest: manifests.get(game),
    sim: built.sim,
    simKey: keys.sim,
    present: built.present,
    presentKey: keys.present,
    filesKey: keys.files,
    files,
    needs: versionNeeds(
      await needsOf(join(ROOT, ...SUBJECTS[game].dir)),
      built,
    ),
  }
}

/**
 * The template's two modules as the first release of a contract built them,
 * committed and never rebuilt, so a page built from this tree is held to
 * playing what an earlier release built. Each folder's README says more.
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
    // Neither frozen build has files: contract 1 knows no folder, and a
    // page names one all the same.
    filesKey: filesBaseFor(gameId, listingSha256(EMPTY_LISTING)).slice(1),
    files: new Map(),
    needs: {},
  }
}

/** A subject built for the studio's bundles origin, under its own game id. */
async function subjectHeld(name: SubjectName): Promise<Held> {
  return await held(
    name,
    await buildAndAddress(
      await sourceAt(join(ROOT, ...SUBJECTS[name].dir)),
      SUBJECTS[name].gameId,
    ),
  )
}

/** Every module the studio's bundles origin serves, by the name a page loads it with. */
const studioModules = {
  template: await subjectHeld("template"),
  paddle: await subjectHeld("paddle"),
  folder: await subjectHeld("folder"),
  "contract-1": await frozen("contract-1"),
  "contract-2": await frozen("contract-2"),
  // A release that has moved on to a contract this tree's pages do not
  // drive, which is the one thing a page must refuse rather than misread.
  "contract-3": await held(
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
  for (const [key, bytes] of module.files) studioBlobs.set(key, bytes)
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
      // Another site from the studio's page, as the platform's sign-in is
      // from every studio's: localhost and 127.0.0.1 are two sites.
      signInHost: SIGN_IN_HOST,
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

/**
 * The policy, letting the portal frame the page when `?portal=1` says it
 * is: a studio's page shown inside a page of another origin, which the recommended
 * policy's `frame-ancestors 'none'` would refuse outright.
 */
function framedBy(url: URL, csp: string): string {
  return url.searchParams.get("portal") === "1"
    ? csp.replace("frame-ancestors 'none'", `frame-ancestors ${PORTAL_ORIGIN}`)
    : csp
}

/** Cross-origin isolation, which a game that shares memory between threads needs. */
const ISOLATED = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
}

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
          // one game this page plays; or, `?frames=none`, the same with no
          // frame-src, which a page that forgot the sign-in sends.
          "content-security-policy": framedBy(
            url,
            pageCsp({
              bundlesOrigin: studioBundlesOrigin,
              gameId: SUBJECTS[name].gameId,
              connect: [standIn.apiOrigin],
              // What the game's build and its package.json say it needs:
              // WebAssembly, workers and its folder's files, for `folder`;
              // or, `?needs=none`, nothing, which a page that left them out
              // sends.
              needs:
                url.searchParams.get("needs") === "none"
                  ? {}
                  : studioModules[name].needs,
              signInOrigin:
                url.searchParams.get("frames") === "none"
                  ? null
                  : standIn.signInOrigin,
            }),
          ),
          // `?isolate=1`: what a page sends when its game needs threads.
          ...(url.searchParams.get("isolate") === "1" ? ISOLATED : {}),
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
          signInReadyMs: SUITE_SIGN_IN_READY_MS,
          seed: HARNESS_SEED,
          modules,
        },
        { headers: NO_STORE },
      )
    }
    return new Response("not found", { status: 404 })
  },
})

// The portal: one page, framing the studio's page for one game.
Bun.serve({
  port: PORTAL_PORT,
  hostname: LOOPBACK.hostname,
  fetch: (request) => {
    const url = new URL(request.url)
    if (url.pathname !== "/") return new Response("not found", { status: 404 })
    const framed = new URLSearchParams({
      game: url.searchParams.get("game") ?? "template",
      portal: "1",
    })
    return new Response(
      `<!doctype html><title>A portal</title><iframe title="The game" src="${STUDIO_ORIGIN}/?${framed}" style="width: 900px; height: 900px; border: 0"></iframe>`,
      {
        headers: {
          ...NO_STORE,
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; frame-src ${STUDIO_ORIGIN}`,
        },
      },
    )
  },
})

/**
 * A host that is not this kit's: a plain file server holding the folder
 * `vbz build --addressed` wrote, at its root, and sending what the guide's
 * "Distributing the build" lists and nothing more, by each file's
 * extension. It shares no code with `createBlobServer`, and sends no
 * `ETag`, so a page that plays from it shows the list is enough for any
 * host.
 */
const HOSTED_TYPES: Readonly<Record<string, string>> = {
  js: "text/javascript",
  wasm: "application/wasm",
}

/** What the host sends with a file at `pathname`, or with its miss. */
function hostedHeaders(
  pathname: string,
  found: boolean,
): Record<string, string> {
  const extension = pathname.slice(pathname.lastIndexOf(".") + 1)
  return {
    "content-type": HOSTED_TYPES[extension] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
    // A path names the same bytes for good; a miss is not kept.
    ...(found
      ? { "cache-control": "public, max-age=31536000, immutable" }
      : {}),
    ...(extension === "js"
      ? {}
      : { "content-security-policy": "default-src 'none'; sandbox" }),
  }
}

const addressedLog: string[] = []
requests.set("addressed", addressedLog)
Bun.serve({
  port: ADDRESSED_FILES_PORT,
  hostname: LOOPBACK.hostname,
  fetch: async (request) => {
    const { pathname } = new URL(request.url)
    addressedLog.push(pathname)
    const file = Bun.file(join(addressedFolder, ...pathname.split("/")))
    if (pathname.endsWith("/") || !(await file.exists())) {
      return new Response("not found", {
        status: 404,
        headers: hostedHeaders(pathname, false),
      })
    }
    return new Response(await file.bytes(), {
      headers: hostedHeaders(pathname, true),
    })
  },
})

const addressedBundle = await Bun.build({
  entrypoints: [join(ADDRESSED_PAGE, "main.ts")],
  target: "browser",
  format: "esm",
})
const addressedOutput = addressedBundle.outputs[0]
if (!addressedBundle.success || addressedOutput === undefined) {
  throw new Error(
    `the page on another origin did not build:\n${addressedBundle.logs.map(String).join("\n")}`,
  )
}
const addressedScript = await addressedOutput.text()
const addressedHtml = await readFile(join(ADDRESSED_PAGE, "index.html"), "utf8")

// The page on an origin of its own, which ships `addressed.json` and plays
// the build from the plain file server.
Bun.serve({
  port: ADDRESSED_PAGE_PORT,
  hostname: LOOPBACK.hostname,
  fetch: (request) => {
    const url = new URL(request.url)
    if (url.pathname === "/") {
      return new Response(addressedHtml, {
        headers: {
          ...NO_STORE,
          "content-type": "text/html; charset=utf-8",
          // The policy the guide tells such a page to send: the host's
          // origin, the build's game id and its needs, framing nothing; or,
          // `?id=`, the same naming another game's path there.
          "content-security-policy": pageCsp({
            bundlesOrigin: ADDRESSED_FILES_ORIGIN,
            gameId: url.searchParams.get("id") ?? addressedBuild.gameId,
            needs: addressedBuild.needs,
            signInOrigin: null,
          }),
        },
      })
    }
    if (url.pathname === "/main.js") {
      return new Response(addressedScript, {
        headers: { ...NO_STORE, "content-type": JS_CONTENT_TYPE },
      })
    }
    if (url.pathname === "/page.css") {
      return new Response(pageStyle, {
        headers: { ...NO_STORE, "content-type": "text/css; charset=utf-8" },
      })
    }
    if (url.pathname === "/addressed.json") {
      return Response.json(addressedBuild, { headers: NO_STORE })
    }
    if (url.pathname === "/config.json") {
      return Response.json(
        { filesOrigin: ADDRESSED_FILES_ORIGIN },
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
    if (url.pathname === "/addressed") {
      return json({
        pageOrigin: ADDRESSED_PAGE_ORIGIN,
        filesOrigin: ADDRESSED_FILES_ORIGIN,
        build: addressedBuild,
      })
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
process.stdout.write(`  addressed  ${ADDRESSED_PAGE_ORIGIN}\n`)
