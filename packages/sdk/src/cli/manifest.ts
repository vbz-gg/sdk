/**
 * Reading a game's manifest out of its built simulation.
 *
 * The simulation exports `MANIFEST`, so the manifest an upload carries is the
 * one the code carries, and the two cannot disagree. Getting at it means
 * evaluating the module, which happens through `runGameProcess`, in a process
 * of its own with an empty environment: a game is somebody else's code, and
 * the CLI has no business running it beside the secret key and the
 * credentials an author or a build system keeps in its environment.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runGameProcess } from "../build/game-process.js"

/**
 * Evaluates the built simulation and returns what it exports as `MANIFEST`.
 *
 * Throws with the subprocess's own output when the module does not load or
 * exports nothing, because "the manifest is missing" and "your simulation
 * throws on import" are different problems and the author needs to know which.
 */
export async function readManifestFromSim(sim: Uint8Array): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), "sdk-manifest-"))
  const path = join(dir, "sim.js")
  try {
    await writeFile(path, sim)
    const child = await runGameProcess([
      "-e",
      `const m = await import(${JSON.stringify(path)});
       if (m.MANIFEST === undefined) {
         process.stderr.write("the simulation exports no MANIFEST");
         process.exit(1);
       }
       process.stdout.write(JSON.stringify(m.MANIFEST));`,
    ])
    if (child.code !== 0) {
      throw new Error(`could not read the manifest:\n${child.stderr.trim()}`)
    }
    return JSON.parse(new TextDecoder().decode(child.stdout)) as unknown
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
