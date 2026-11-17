/**
 * The template and the fixture are games the platform would accept.
 *
 * This is the guard against drift. clockwork2 has templates of its own and
 * they do not ship to npm - its `files` is `dist`, `src`, `README.md` - so
 * these are a second copy, and a second copy rots. What matters is not
 * whether the files still match, which they were never required to, but
 * whether each still passes everything a platform checks before it will run a
 * game. That is the drift worth catching.
 *
 * It builds through the real `buildGameArtifacts`, so a template that stops
 * building, or starts inlining its simulation into its page module, fails
 * here too.
 */

import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashCanonical, type PlainValue } from "@clockwork2/engine"
import { loadSubject, validate } from "@clockwork2/engine/validate"
import { buildGameArtifacts } from "../../src/build/build"
import { SIM_SPECIFIER } from "../../src/build/contract"
import { readManifestFromSim } from "../../src/cli/manifest"
import type { PageModule } from "../../src/game/contract"

const ROOT = join(import.meta.dir, "..", "..", "..", "..")

/** Every subject the repository ships, and what each one is for. */
const SUBJECTS = [
  {
    name: "the template",
    dir: join(ROOT, "packages", "sdk", "templates", "game"),
    needsMotion: false,
  },
  // The tilt subject: its mapping reads tilt, so a page asks for motion.
  {
    name: "the paddle fixture",
    dir: join(ROOT, "fixtures", "paddle"),
    needsMotion: true,
  },
] as const

function built(dir: string) {
  return buildGameArtifacts({
    root: dir,
    simEntry: "src/sim/index.ts",
    presentEntry: "src/present.ts",
    captureEntry: "src/capture.ts",
  })
}

async function report(dir: string) {
  const { sim, present } = await built(dir)
  const manifest = await readManifestFromSim(sim)

  // The suite wants a directory laid out as `index.js` with `manifest.json`
  // beside it. Pointed at a file it throws from `budgets`, which walks the
  // subject's root.
  const subject = await mkdtemp(join(tmpdir(), "sdk-conformance-"))
  try {
    await writeFile(join(subject, "index.js"), sim)
    await writeFile(
      join(subject, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    )
    return {
      built: { sim, present },
      manifest,
      result: await validate(await loadSubject(subject), {}),
    }
  } finally {
    await rm(subject, { recursive: true, force: true })
  }
}

describe("what this repository ships as an example", () => {
  for (const subject of SUBJECTS) {
    test(`${subject.name} passes every conformance check`, async () => {
      const { result } = await report(subject.dir)
      const failed = result.outcomes
        .filter((outcome) => !outcome.ok)
        .map(
          (outcome) => `${outcome.check}: ${JSON.stringify(outcome.findings)}`,
        )
      expect(failed).toEqual([])
      expect(result.ok).toBe(true)
      // A suite that ran nothing would pass vacuously.
      expect(result.outcomes.length).toBeGreaterThan(8)
    }, 120_000)
  }

  /**
   * The page module, built as `vbz build` builds it and loaded beside its own
   * rules code, has to pass its own check: the manifest it was handed is the
   * rules code's, and its mapping names only inputs the manifest declares.
   */
  for (const subject of SUBJECTS) {
    test(`${subject.name}'s page module passes its own check`, async () => {
      const { sim, present } = await built(subject.dir)
      const manifest = await readManifestFromSim(sim)
      const dir = await mkdtemp(join(tmpdir(), "sdk-conformance-"))
      try {
        await writeFile(join(dir, "sim.js"), sim)
        // Where the platform points the import at its stored copy, this
        // points it at the file beside it.
        await writeFile(
          join(dir, "present.js"),
          new TextDecoder()
            .decode(present)
            .replaceAll(
              JSON.stringify(SIM_SPECIFIER),
              JSON.stringify("./sim.js"),
            ),
        )
        const loaded = (await import(join(dir, "present.js"))) as {
          default: PageModule
        }
        const game = loaded.default
        expect(game.contract).toBe(1)
        expect(game.check()).toEqual([])
        expect(game.needsMotion).toBe(subject.needsMotion)
        expect(game.manifestHash).toBe(hashCanonical(manifest as PlainValue))
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }, 120_000)
  }
})
