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

import { refuse } from "./errors.js"
import { GAME_ID, SHA256, SIM_PATH, simPathFor } from "./paths.js"

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
 * Size caps, generous enough that nothing real hits them and small enough that
 * a runaway build is refused rather than stored.
 *
 * Measured: the Snake demo's sim is 35,558 bytes and its frame, which is
 * what a page module was before it carried its own host, is 545,518, most of
 * that the renderer.
 */
export const MAX_SIM_BYTES = 2 * 1024 * 1024
export const MAX_PRESENT_BYTES = 8 * 1024 * 1024

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

/**
 * The page module must import the simulation, by that name, and nothing else.
 *
 * The occurrence count is what earns the host's text rewrite. If the quoted
 * specifier appears more often than the scanner found imports, the string is
 * also data somewhere in the bundle, and replacing it would change a value the
 * game reads. That is a refusal rather than a rewrite.
 *
 * Returns how many import statements there are, which the host compares
 * against its own count after rewriting.
 */
export function assertPresentImportsOnlySim(presentText: string): number {
  const imports = scan(presentText)

  const dynamic = imports.filter((i) => i.kind !== "import-statement")
  if (dynamic.length > 0) {
    refuse(
      "E_PRESENT_DYNAMIC_IMPORT",
      `the page module uses a dynamic import (${dynamic.map((i) => i.path).join(", ")}); the module it loads must be decidable without running it`,
    )
  }

  if (imports.length === 0) {
    refuse(
      "E_PRESENT_IMPORT_MISSING",
      `the page module imports nothing, so it carries its own copy of the simulation; it must import ${SIM_SPECIFIER}`,
    )
  }

  const unexpected = [
    ...new Set(imports.map((i) => i.path).filter((p) => p !== SIM_SPECIFIER)),
  ]
  if (unexpected.length > 0) {
    refuse(
      "E_PRESENT_IMPORT_UNEXPECTED",
      `the page module imports ${unexpected.join(", ")}; the only import it may carry is ${SIM_SPECIFIER}`,
    )
  }

  const occurrences = countQuoted(presentText, SIM_SPECIFIER)
  if (occurrences !== imports.length) {
    refuse(
      "E_PRESENT_SPECIFIER_AMBIGUOUS",
      `${JSON.stringify(SIM_SPECIFIER)} appears ${occurrences} times as a quoted string but only ${imports.length} as an import, so rewriting it would change something the game reads`,
    )
  }

  return imports.length
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
 * Points the page module's simulation import at the stored simulation, under
 * its game's path.
 *
 * The path is built here from the game's id and a hash the caller computed,
 * and both are checked, because a path taken from a submission would let a
 * bundle name some other module, or another game's. The result is re-scanned,
 * so the transform is verified rather than trusted.
 *
 * This runs before the page module is hashed, so a stored page module's hash
 * is taken over bytes that already name one game and one simulation. That is
 * what makes "the browser and the validator ran the same code" checkable
 * rather than asserted: a page module can name exactly one sim, forever.
 */
export function rewriteSimImport(
  presentText: string,
  gameId: string,
  simSha256: string,
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

  const expected = assertPresentImportsOnlySim(presentText)

  const rewritten = presentText
    .replaceAll(`"${SIM_SPECIFIER}"`, JSON.stringify(simPath))
    .replaceAll(`'${SIM_SPECIFIER}'`, JSON.stringify(simPath))

  assertRewritten(rewritten, simPath, expected)
  return rewritten
}

/**
 * That the rewrite produced what it promised.
 *
 * Separate from the replacement above, and exported, because it cannot be
 * reached through `rewriteSimImport`: the input has already passed
 * `assertPresentImportsOnlySim`, the path was built from checked parts, and a
 * `replaceAll` of one quoted literal for another cannot change how many
 * imports a module has. Left inline it would be four lines no test could
 * execute, which is a guard nobody has ever seen work.
 *
 * It is worth keeping rather than deleting, because what it guards is the one
 * transform this package performs on a stranger's bytes, and the next person
 * to change the replacement is who it is for.
 */
export function assertRewritten(
  rewritten: string,
  simPath: string,
  expected: number,
): void {
  const after = scan(rewritten)
  const paths = [...new Set(after.map((i) => i.path))]
  const ok =
    SIM_PATH.test(simPath) &&
    after.length === expected &&
    after.every((i) => i.kind === "import-statement") &&
    paths.length === 1 &&
    paths[0] === simPath
  if (!ok) {
    refuse(
      "E_REWRITE_FAILED",
      `after rewriting, the page module imports ${paths.join(", ") || "nothing"} across ${after.length} statements, expected ${expected} of ${simPath}`,
    )
  }
}
