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
 * Both checks run the game's own code, so both run in `check-child`, started
 * through `runGameProcess` with an empty environment, never in this process:
 * the command runs where an author keeps a studio's secret key and cloud
 * credentials. The mapping is imported under bun rather than read out of the
 * page module, because the page module draws and this runs with no DOM: that
 * is why the mapping lives in a file of its own that touches none.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
import { childEntry, runGameProcess } from "../build/game-process.js"
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

/** What the two checks found, as the child answers it. */
export interface CheckFindings {
  readonly conformance: Report
  readonly capture: readonly string[]
}

/** What the child is handed on stdin. */
export interface CheckRequest {
  /** A directory holding the rules code as `index.js` and the manifest beside it. */
  readonly subject: string
  readonly source: GameSource
  readonly manifest: Manifest
  /** Where the child writes its answer, so nothing the game prints can be read as one. */
  readonly answer: string
}

/**
 * Builds the game and checks it. A manifest that is not one stops here with
 * the engine's own refusal, because nothing after it can be read against it.
 */
export async function checkGame(source: GameSource): Promise<GameCheck> {
  const built = await buildGame(source)
  const manifest = assertManifest(built.manifest)
  const { conformance, capture } = await checkInChild(
    source,
    built.sim,
    manifest,
  )
  return {
    version: built.version,
    line: built.line,
    contractSha256: contractSha256(manifest),
    conformance,
    capture,
    ok: conformance.ok && capture.length === 0,
  }
}

/** The child's own entry, beside this module as source or as built output. */
export function checkChildEntry(dir = import.meta.dir): string {
  return childEntry(dir, "check-child")
}

/**
 * Both checks, in a process of their own, over the bytes an upload would
 * carry. The engine's suite wants a directory with the bundle as `index.js`
 * and the manifest beside it, which is disposed of however the checks end. A
 * child that writes no answer fails the command with what it printed.
 */
export async function checkInChild(
  source: GameSource,
  sim: Uint8Array,
  manifest: Manifest,
  entry: string = checkChildEntry(),
): Promise<CheckFindings> {
  const dir = await mkdtemp(join(tmpdir(), "vbz-check-"))
  try {
    const subject = join(dir, "subject")
    await mkdir(subject)
    await writeFile(join(subject, "index.js"), sim)
    await writeFile(
      join(subject, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    const request: CheckRequest = {
      subject,
      source,
      manifest,
      answer: join(dir, "answer.json"),
    }
    const child = await runGameProcess([entry], {
      stdin: JSON.stringify(request),
    })
    let answer: string
    try {
      answer = await readFile(request.answer, "utf8")
    } catch {
      throw new Error(
        `the checks did not answer: ${child.stderr.trim() || `exit ${child.code}`}`,
      )
    }
    return JSON.parse(answer) as CheckFindings
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** What the child runs: the engine's checks and the mapping's, here. */
export async function checkHere(request: CheckRequest): Promise<CheckFindings> {
  return {
    conformance: await validate(await loadSubject(request.subject), {}),
    capture: await captureProblems(request.source, request.manifest),
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
