/**
 * What a conforming pair of artifacts is.
 *
 * A game version is a simulation module, the rules code, and a page module,
 * the presentation and the host that plays it. The page module does not
 * contain a copy of the simulation: it imports the one the platform stores, so
 * the browser and the server's validator load the same object rather than two
 * builds of one source. That property is the reason a replayed score means
 * anything, and everything here exists to make it checkable rather than
 * asserted.
 *
 * These checks run twice and on purpose. `buildGameArtifacts` runs them on its
 * own output, so a build that quietly inlined the simulation fails where the
 * person who caused it is standing. The platform runs them again on the bytes
 * it was uploaded, because it never trusts how something was built.
 */

import { isFilePath } from "../game/files.js"
import { refuse } from "./errors.js"
import { type FilesListing, listedFile, listingSha256 } from "./files.js"
import { runtimeLoads } from "./loads.js"
import { filesBaseFor, GAME_ID, SHA256, SIM_PATH, simPathFor } from "./paths.js"

/**
 * The one name a page module may use for its simulation.
 *
 * A bare specifier rather than a relative path, for three reasons measured on
 * bun 1.3.11.
 *
 * Bun ignores `external` for a relative import. `external: ["./game/index"]`,
 * the same with an extension, and the resolved absolute path all left the
 * simulation compiled in; an `onResolve` plugin that does externalize one then
 * emits the *original* source specifier rather than the path it returned. So a
 * relative sim import cannot be externalized under a name anybody chooses.
 *
 * Two spellings that reach the same module emit two imports. A page module
 * reaching the simulation through `./game/index` and its renderer through
 * `../game/constants` becomes two paths, two URLs and two module instances, so
 * it would hold two MANIFEST objects. Measured on the Snake demo, as a frame:
 * externalizing only the first took the frame from 577,948 bytes to 545,518
 * against a standalone sim of 35,558, leaving 3,128 bytes of simulation
 * compiled in.
 *
 * And `cw2:` is not resolvable by a browser's module resolver, so an
 * unrewritten bundle fails at load with "Failed to resolve module specifier"
 * rather than half-working.
 */
export const SIM_SPECIFIER = "cw2:sim"

/**
 * The prefix a page module names a file of its version's folder by, in a
 * static import: `cw2:files/<path>`. It is rewritten with the rules code's
 * specifier, to the folder's path under the game, so the bytes stored name
 * one folder by the hash of its listing.
 */
export const FILES_SPECIFIER = "cw2:files/"

type ScannedImport = { kind: string; path: string }

function scan(text: string): ScannedImport[] {
  return new Bun.Transpiler({ loader: "js" }).scanImports(
    text,
  ) as ScannedImport[]
}

/**
 * Decodes an artifact, refusing anything that is not valid UTF-8.
 *
 * A module the browser reads as UTF-8 and the hasher hashes as bytes has to be
 * the same document, and `fatal` is what makes a mismatch a refusal instead of
 * a run of replacement characters nobody notices until the game misbehaves.
 */
export function decodeArtifact(bytes: Uint8Array, what: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return refuse(
      "E_ARTIFACT_NOT_UTF8",
      `the ${what} is not valid UTF-8, so its bytes and its module text disagree`,
    )
  }
}

export function assertSize(
  bytes: Uint8Array,
  limit: number,
  what: string,
): void {
  if (bytes.byteLength > limit) {
    refuse(
      "E_ARTIFACT_TOO_LARGE",
      `the ${what} is ${bytes.byteLength} bytes, over the ${limit} byte limit`,
    )
  }
}

/**
 * The simulation must import nothing at all.
 *
 * It replays in an isolate with no outbound network, so an import there is
 * neither a slow path nor a degraded one: it is a guaranteed fault on every
 * session the version ever serves.
 */
export function assertSimSelfContained(simText: string): void {
  const imports = scan(simText)
  if (imports.length > 0) {
    const paths = [...new Set(imports.map((i) => i.path))].join(", ")
    refuse(
      "E_SIM_NOT_SELF_CONTAINED",
      `the simulation imports ${paths}; it runs with no network, so it must carry everything it needs`,
    )
  }
}

/** What a page module imports: its rules code, and files of its folder. */
export interface PresentImports {
  /** How many import statements name the rules code. */
  readonly sim: number
  /** The folder's files it imports, by path, one per import statement. */
  readonly files: readonly string[]
  /**
   * How many times it starts a worker with `new Worker`. A page's policy
   * admits one only with `worker-src blob:` and the game's path, so a game
   * whose page module starts one has to say it needs workers.
   */
  readonly workers: number
}

/**
 * The page module must import the simulation, by that name, may import
 * files of its version's folder as `cw2:files/<path>`, and imports nothing
 * else, by no other means.
 *
 * Every file it names has to be one the listing holds, and no specifier may
 * also appear as data: the occurrence counts are what earn the host's text
 * rewrite, and a specifier the scanner did not find as an import is a string
 * the game reads, which a rewrite would change. That is a refusal rather
 * than a rewrite. Nor may it load code by an address decided at run time, by
 * `import()` with any argument, `importScripts` or `new SharedWorker`: what
 * it loads has to be decidable without running it.
 *
 * It may start a worker with `new Worker`, which is how a renderer such as
 * pixi.js 8 runs its own code off the main thread: from a `blob:` URL made
 * of a string the module carries, so the code is the module's own bytes,
 * named by its hash like the rest. What a worker can be started from is the
 * page's policy to bound, `worker-src blob:` and the game's own path, and a
 * game whose page module starts one says it needs workers, which the build
 * holds it to.
 *
 * Returns what it imports, which the host compares against its own count
 * after rewriting.
 */
export function assertPresentImports(
  presentText: string,
  listing: FilesListing,
): PresentImports {
  const imports = scan(presentText)

  const dynamic = imports.filter((i) => i.kind !== "import-statement")
  if (dynamic.length > 0) {
    refuse(
      "E_PRESENT_DYNAMIC_IMPORT",
      `the page module uses a dynamic import (${dynamic.map((i) => i.path).join(", ")}); the module it loads must be decidable without running it`,
    )
  }
  const loads = runtimeLoads(presentText)
  const computed = loads.filter((load) => load.kind === "import()")
  if (computed.length > 0) {
    refuse(
      "E_PRESENT_DYNAMIC_IMPORT",
      `the page module calls import() ${computed.length} time${computed.length === 1 ? "" : "s"}, first at character ${computed[0]?.at}; it may load only ${SIM_SPECIFIER} and files its static imports name`,
    )
  }
  const byAddress = loads.filter(
    (load) => load.kind !== "import()" && load.kind !== "new Worker",
  )
  if (byAddress.length > 0) {
    refuse(
      "E_PRESENT_WORKER",
      `the page module calls ${[...new Set(byAddress.map((load) => load.kind))].join(", ")}, which loads code by an address decided when it runs; a worker a game starts is a new Worker, from its files folder or from a blob of its own code`,
    )
  }
  const workers = loads.filter((load) => load.kind === "new Worker").length

  const sim = imports.filter((i) => i.path === SIM_SPECIFIER).length
  if (sim === 0) {
    refuse(
      "E_PRESENT_IMPORT_MISSING",
      `the page module does not import ${SIM_SPECIFIER}, so it carries its own copy of the simulation; it must import ${SIM_SPECIFIER}`,
    )
  }

  const unexpected = [
    ...new Set(
      imports
        .map((i) => i.path)
        .filter((p) => p !== SIM_SPECIFIER && !p.startsWith(FILES_SPECIFIER)),
    ),
  ]
  if (unexpected.length > 0) {
    refuse(
      "E_PRESENT_IMPORT_UNEXPECTED",
      `the page module imports ${unexpected.join(", ")}; it may import ${SIM_SPECIFIER} and files of its folder as ${FILES_SPECIFIER}<path>, and nothing else`,
    )
  }

  const files = imports
    .map((i) => i.path)
    .filter((p) => p.startsWith(FILES_SPECIFIER))
    .map((p) => p.slice(FILES_SPECIFIER.length))
  for (const path of files) {
    if (!isFilePath(path)) {
      refuse(
        "E_FILE_PATH_INVALID",
        `the page module imports ${FILES_SPECIFIER}${path}, and ${JSON.stringify(path)} is not a path a version's folder may hold`,
      )
    }
    if (listedFile(listing, path) === undefined) {
      refuse(
        "E_FILE_UNLISTED",
        `the page module imports ${FILES_SPECIFIER}${path}, and the files folder has no ${path}`,
      )
    }
  }

  const occurrences = countQuoted(presentText, SIM_SPECIFIER)
  if (occurrences !== sim) {
    refuse(
      "E_PRESENT_SPECIFIER_AMBIGUOUS",
      `${JSON.stringify(SIM_SPECIFIER)} appears ${occurrences} times as a quoted string but only ${sim} as an import, so rewriting it would change something the game reads`,
    )
  }
  const fileOccurrences = presentText.split(FILES_SPECIFIER).length - 1
  if (fileOccurrences !== files.length) {
    refuse(
      "E_PRESENT_SPECIFIER_AMBIGUOUS",
      `${JSON.stringify(FILES_SPECIFIER)} appears ${fileOccurrences} times but only ${files.length} as an import, so rewriting it would change something the game reads; a file the game reads at run time is found through the folder's address, not by this prefix`,
    )
  }

  return { sim, files, workers }
}

/** Counts the specifier as a quoted literal, in either quote style. */
export function countQuoted(text: string, specifier: string): number {
  let total = 0
  for (const quote of ['"', "'"]) {
    const needle = `${quote}${specifier}${quote}`
    let from = 0
    while (true) {
      const at = text.indexOf(needle, from)
      if (at === -1) break
      total += 1
      from = at + needle.length
    }
  }
  return total
}

/**
 * Points the page module's imports at what the platform stores, under its
 * game's path: `cw2:sim` at the rules code, `/g/<gameId>/sim/<sha256>.js`,
 * and every `cw2:files/` at the files folder, `/g/<gameId>/t/<listing
 * sha256>/`.
 *
 * The paths are built here from the game's id, a hash the caller computed
 * and the listing, and each is checked, because a path taken from a
 * submission would let a bundle name some other module, or another game's.
 * The result is re-scanned, so the transform is verified rather than
 * trusted.
 *
 * This runs before the page module is hashed, so a stored page module's hash
 * is taken over bytes that already name one game, one rules code and one
 * folder. That is what makes "the browser and the validator ran the same
 * code" checkable rather than asserted: a page module can name exactly one
 * sim and one set of files, forever.
 */
export function rewritePresentImports(
  presentText: string,
  gameId: string,
  simSha256: string,
  listing: FilesListing,
): string {
  if (!GAME_ID.test(gameId)) {
    refuse("E_REWRITE_FAILED", `${JSON.stringify(gameId)} is not a game id`)
  }
  if (!SHA256.test(simSha256)) {
    refuse(
      "E_REWRITE_FAILED",
      `${JSON.stringify(simSha256)} is not a lowercase hex SHA-256`,
    )
  }
  const simPath = simPathFor(gameId, simSha256)
  const filesBase = filesBaseFor(gameId, listingSha256(listing))

  const expected = assertPresentImports(presentText, listing)

  // Every occurrence of either specifier is an import's, which the check
  // above counted.
  const rewritten = presentText
    .replaceAll(`"${SIM_SPECIFIER}"`, JSON.stringify(simPath))
    .replaceAll(`'${SIM_SPECIFIER}'`, JSON.stringify(simPath))
    .replaceAll(FILES_SPECIFIER, filesBase)

  assertRewritten(rewritten, simPath, filesBase, expected)
  return rewritten
}

/**
 * That the rewrite produced what it promised: import statements alone, as
 * many naming the rules code at `simPath` as before, and every file import
 * now under `filesBase`, the same files as before.
 *
 * Separate from the replacement above, and exported, because it cannot be
 * reached through `rewritePresentImports`: the input has already passed
 * `assertPresentImports`, the paths were built from checked parts, and a
 * `replaceAll` of one specifier for another cannot change how many imports a
 * module has. Left inline it would be lines no test could execute, which is
 * a guard nobody has ever seen work.
 *
 * It is worth keeping rather than deleting, because what it guards is the one
 * transform this package performs on a stranger's bytes, and the next person
 * to change the replacement is who it is for.
 */
export function assertRewritten(
  rewritten: string,
  simPath: string,
  filesBase: string,
  expected: PresentImports,
): void {
  const after = scan(rewritten)
  const sims = after.filter((i) => i.path === simPath).length
  const files = after
    .filter((i) => i.path.startsWith(filesBase))
    .map((i) => i.path.slice(filesBase.length))
    .sort()
  const others = after.filter(
    (i) => i.path !== simPath && !i.path.startsWith(filesBase),
  )
  const ok =
    SIM_PATH.test(simPath) &&
    after.every((i) => i.kind === "import-statement") &&
    sims === expected.sim &&
    others.length === 0 &&
    JSON.stringify(files) === JSON.stringify([...expected.files].sort())
  if (!ok) {
    const paths = [...new Set(after.map((i) => i.path))]
    refuse(
      "E_REWRITE_FAILED",
      `after rewriting, the page module imports ${paths.join(", ") || "nothing"} across ${after.length} statements, expected ${expected.sim} of ${simPath} and ${expected.files.length} under ${filesBase}`,
    )
  }
}
