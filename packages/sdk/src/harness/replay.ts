/**
 * What `vbz dev` says about a run once it ends: whether its recording
 * replays, whether its inputs are ones the platform would take, and how big
 * it is.
 *
 * The replay is the platform's half in miniature: the built rules code, run
 * with the engine's `runSession` over the recording's own inputs and the data
 * packs the manifest declares, to the end tick it claims, and compared with
 * `compareToRecording`. The inputs are held
 * to the manifest the build wrote with `checkInputs`, which is what a server
 * runs on a submit, budget included. None of it settles or ranks anything.
 *
 * The rules code is somebody's game, so it is run as every command runs a
 * game's code, through `runGameProcess`: in a process of its own with an
 * empty environment, because `vbz dev` runs where an author keeps a studio's
 * secret key and cloud credentials, and a game that read them would have
 * them.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkInputs,
  compareToRecording,
  decodeRecording,
  type GameModuleSource,
  INPUT_BUDGET_PER_TICK,
  instantiate,
  isClockworkError,
  type Manifest,
  type PackBytes,
  PackSet,
  RecordedInputSource,
  runSession,
} from "@clockwork2/engine"
import { childEntry, runGameProcess } from "../build/game-process.js"

/** A failure, as plain data a page can show. */
export interface Problem {
  readonly code: string
  readonly message: string
}

/** What the replay found. */
export type ReplayVerdict =
  | {
      readonly kind: "matches"
      readonly endTick: number
      readonly counters: Readonly<Record<string, number>>
    }
  | {
      readonly kind: "differs"
      /** The first checkpoint whose hash differs, or null when only the end does. */
      readonly divergedAt: number | null
      readonly differences: readonly string[]
    }
  /** A run that ended at tick 0 has no tick to replay. */
  | { readonly kind: "nothing" }
  | ({ readonly kind: "failed" } & Problem)

export interface InputsReport {
  /** How many inputs the recording holds. */
  readonly count: number
  /** The most a run this long may hold: `INPUT_BUDGET_PER_TICK x (endTick + 1)`. */
  readonly budget: number
  /** What `checkInputs` refused, or null when it took them. */
  readonly problem: Problem | null
}

export interface DevReport {
  readonly replay: ReplayVerdict
  readonly inputs: InputsReport
  /** The recording's size as sent, in UTF-8 bytes: what a submit's body holds. */
  readonly bytes: number
}

function problemOf(error: unknown): Problem {
  if (isClockworkError(error))
    return { code: error.code, message: error.message }
  return { code: "E_UNEXPECTED", message: String(error) }
}

/**
 * Replays `text`, a recording as the page sent it, against `source`, the
 * rules code's default export, with the data packs the manifest declares,
 * and holds its inputs to `manifest`. Never throws: every failure is part of
 * the report.
 */
export function replayRecording<TView, TConfig>(
  source: GameModuleSource<TView, TConfig>,
  manifest: Manifest,
  text: string,
  packs: ReadonlyMap<string, PackBytes> = new Map(),
): DevReport {
  const bytes = new TextEncoder().encode(text).byteLength
  let recording: ReturnType<typeof decodeRecording>
  try {
    recording = decodeRecording(text)
  } catch (error) {
    const problem = problemOf(error)
    return {
      replay: { kind: "failed", ...problem },
      inputs: { count: 0, budget: 0, problem },
      bytes,
    }
  }

  let problem: Problem | null = null
  try {
    checkInputs(recording.inputs, manifest.inputs, {
      endTick: recording.endTick,
    })
  } catch (error) {
    problem = problemOf(error)
  }
  const inputs = {
    count: recording.inputs.length,
    budget: INPUT_BUDGET_PER_TICK * (recording.endTick + 1),
    problem,
  }

  if (recording.endTick === 0)
    return { replay: { kind: "nothing" }, inputs, bytes }
  try {
    const replayed = runSession({
      module: instantiate(source),
      seed: recording.seed,
      // Whatever the page mounted the run with, which the game reads.
      config: recording.config as TConfig,
      inputs: new RecordedInputSource(recording.inputs),
      // Where the player stopped, as the platform replays it, so an
      // abandoned run is not replayed past its end. No run has a step limit
      // of its own.
      maxTicks: Math.max(recording.endTick, 1),
      checkpointEvery: recording.tickHz,
      counters: manifest.counters,
      assets: manifest.assets ?? [],
      // Checked as the run first reads each, as a server replay does.
      packs: PackSet.lazy(manifest.assets, packs),
    })
    const compared = compareToRecording(recording, replayed)
    return {
      replay: compared.matches
        ? {
            kind: "matches",
            endTick: replayed.endTick,
            counters: { ...replayed.counters },
          }
        : {
            kind: "differs",
            divergedAt: compared.divergedAt,
            differences: compared.differences,
          },
      inputs,
      bytes,
    }
  } catch (error) {
    return { replay: { kind: "failed", ...problemOf(error) }, inputs, bytes }
  }
}

/**
 * The child process's own entry, wherever this module is running from: the
 * TypeScript beside it in this repository, the compiled file in `dist` once
 * installed. The directory is a parameter so both can be tested.
 */
export function replayChildEntry(dir = import.meta.dir): string {
  return childEntry(dir, "replay-child")
}

/** What the replay's own process reads on stdin. */
export interface ReplayRequest {
  readonly manifest: unknown
  readonly recording: string
  /** The data packs the manifest declares, by path, at where each is on disk. */
  readonly packs: Readonly<Record<string, string>>
}

/**
 * `replayRecording` in a process of its own, against the built rules code,
 * with the data packs it reads from the files folder. A child that fails to
 * answer is a failed replay, with what it printed. It needs nothing of the
 * environment: its entry, the rules code and the engine are found from their
 * own paths, and what it reads arrives on stdin.
 */
export async function replayInChild(
  sim: Uint8Array,
  manifest: unknown,
  text: string,
  packs: ReadonlyMap<string, string> = new Map(),
  entry: string = replayChildEntry(),
): Promise<DevReport> {
  const dir = await mkdtemp(join(tmpdir(), "vbz-replay-"))
  try {
    const path = join(dir, "sim.js")
    await writeFile(path, sim)
    const request: ReplayRequest = {
      manifest,
      recording: text,
      packs: Object.fromEntries(packs),
    }
    const child = await runGameProcess([entry, path], {
      stdin: JSON.stringify(request),
    })
    const out = new TextDecoder().decode(child.stdout)
    const err = child.stderr
    const code = child.code
    if (code === 0) {
      try {
        return JSON.parse(out) as DevReport
      } catch {
        // Fall through to the failure below, with what the child printed.
      }
    }
    const problem = {
      code: "E_UNEXPECTED",
      message: `the replay did not answer: ${err.trim() || out.trim() || `exit ${code}`}`,
    }
    return {
      replay: { kind: "failed", ...problem },
      inputs: { count: 0, budget: 0, problem },
      bytes: new TextEncoder().encode(text).byteLength,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
