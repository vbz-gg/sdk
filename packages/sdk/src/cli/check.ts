/**
 * `vbz check`: what the platform would decide about this build before it
 * runs, said on the author's machine.
 *
 * It builds the game as `vbz build` does, runs the engine's conformance
 * checks over the rules code exactly as built, holds the input mapping in
 * `src/capture.ts` to the manifest with the engine's `checkCapture`, and
 * prints the release line and the hash of the contract every patch of that
 * line has to keep. The platform adds checks of its own after an upload, so a
 * pass here is necessary rather than sufficient.
 *
 * The mapping is imported under bun rather than read out of the page module,
 * because the page module draws and this runs with no DOM: that is why the
 * mapping lives in a file of its own that touches none.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { assertManifest, type Manifest } from "@clockwork2/engine"
import { type CaptureMapping, checkCapture } from "@clockwork2/engine/host"
import {
  formatReport,
  loadSubject,
  type Report,
  validate,
} from "@clockwork2/engine/validate"
import type { GameSource } from "../build/index.js"
import { contractSha256 } from "../build/line.js"
import { buildGame } from "./build.js"

export interface GameCheck {
  readonly version: string
  /** The release line, `MAJOR.MINOR`. */
  readonly line: string
  /** What every patch of the line has to keep, hashed as the platform stores it. */
  readonly contractSha256: string
  /** The engine's checks, run over the rules code as built. */
  readonly conformance: Report
  /** What is wrong with the input mapping, or nothing. */
  readonly capture: readonly string[]
  readonly ok: boolean
}

/**
 * Builds the game and checks it. A manifest that is not one stops here with
 * the engine's own refusal, because nothing after it can be read against it.
 */
export async function checkGame(source: GameSource): Promise<GameCheck> {
  const built = await buildGame(source)
  const manifest = assertManifest(built.manifest)
  const conformance = await conformanceOf(built.sim, manifest)
  const capture = await captureProblems(source, manifest)
  return {
    version: built.version,
    line: built.line,
    contractSha256: contractSha256(manifest),
    conformance,
    capture,
    ok: conformance.ok && capture.length === 0,
  }
}

/**
 * The engine's checks, over the bytes an upload would carry. The suite wants
 * a directory with the bundle as `index.js` and the manifest beside it, which
 * is disposed of however the checks end.
 */
async function conformanceOf(
  sim: Uint8Array,
  manifest: Manifest,
): Promise<Report> {
  const dir = await mkdtemp(join(tmpdir(), "vbz-check-"))
  try {
    await writeFile(join(dir, "index.js"), sim)
    await writeFile(
      join(dir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    return await validate(await loadSubject(dir), {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The mapping's problems, each naming the file it came from. */
export async function captureProblems(
  source: GameSource,
  manifest: Manifest,
): Promise<string[]> {
  const at = source.captureEntry
  let loaded: unknown
  try {
    loaded = await import(pathToFileURL(join(source.root, at)).href)
  } catch (error) {
    return [`${at} did not load: ${String(error)}`]
  }
  const mapping = (loaded as { readonly capture?: unknown }).capture
  if (typeof mapping !== "object" || mapping === null) {
    return [`${at} exports no input mapping; export it as \`capture\``]
  }
  try {
    return checkCapture(mapping as CaptureMapping, manifest).map(
      (problem) => `${at}: ${problem}`,
    )
  } catch (error) {
    return [`${at} could not be checked: ${String(error)}`]
  }
}

/** What `vbz check` prints. */
export function checkLines(check: GameCheck, captureEntry: string): string[] {
  return [
    formatReport(check.conformance),
    "",
    ...(check.capture.length === 0
      ? [`capture   ${captureEntry} maps only inputs the manifest declares`]
      : check.capture.map((problem) => `capture   ${problem}`)),
    `version   ${check.version}, release line ${check.line}`,
    `contract  ${check.contractSha256}`,
    `          every patch of ${check.line} must keep what this hashes`,
  ]
}
