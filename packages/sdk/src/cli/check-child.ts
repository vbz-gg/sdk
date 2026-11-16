#!/usr/bin/env bun
/**
 * `vbz check`'s own process: reads a `CheckRequest` from stdin, runs the
 * engine's checks over the built rules code and imports the input mapping,
 * and writes what they found to the file the request names. A file rather
 * than stdout, because the game's own code runs here and may print.
 *
 * A process entry, excluded from the coverage floor for the reason the CLI's
 * is: what it decides is `checkHere`, which is exported and tested.
 */

import { writeFile } from "node:fs/promises"
import { type CheckRequest, checkHere } from "./check.js"

const request = JSON.parse(await Bun.stdin.text()) as CheckRequest
await writeFile(request.answer, JSON.stringify(await checkHere(request)))
