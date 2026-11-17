#!/usr/bin/env bun
/**
 * The replay's own process: imports one built rules code, reads
 * `{ manifest, recording }` from stdin, and prints the report as JSON.
 *
 * A process entry, excluded from the coverage floor for the reason the CLI's
 * is: what it decides is `replayRecording`, which is exported and tested.
 */

import { pathToFileURL } from "node:url"
import type { GameModuleSource, Manifest } from "@clockwork2/engine"
import { replayRecording } from "./replay.js"

const path = process.argv[2]
if (path === undefined) throw new Error("say which rules code to replay")
const input = JSON.parse(await Bun.stdin.text()) as {
  readonly manifest: Manifest
  readonly recording: string
}
const loaded = (await import(pathToFileURL(path).href)) as {
  readonly default: GameModuleSource
}
process.stdout.write(
  JSON.stringify(
    replayRecording(loaded.default, input.manifest, input.recording),
  ),
)
