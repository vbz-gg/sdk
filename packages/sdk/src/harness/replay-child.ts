#!/usr/bin/env bun
/**
 * The replay's own process: imports one built rules code, reads
 * `{ manifest, recording, packs }` from stdin, reads each pack from where it
 * is on disk, and prints the report as JSON.
 *
 * A process entry, excluded from the coverage floor for the reason the CLI's
 * is: what it decides is `replayRecording`, which is exported and tested.
 */

import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import type { GameModuleSource, Manifest } from "@clockwork2/engine"
import { type ReplayRequest, replayRecording } from "./replay.js"

const path = process.argv[2]
if (path === undefined) throw new Error("say which rules code to replay")
const input = JSON.parse(await Bun.stdin.text()) as ReplayRequest
const packs = new Map<string, Uint8Array>()
for (const [pack, onDisk] of Object.entries(input.packs)) {
  packs.set(pack, new Uint8Array(await readFile(onDisk)))
}
const loaded = (await import(pathToFileURL(path).href)) as {
  readonly default: GameModuleSource
}
process.stdout.write(
  JSON.stringify(
    replayRecording(
      loaded.default,
      input.manifest as Manifest,
      input.recording,
      packs,
    ),
  ),
)
