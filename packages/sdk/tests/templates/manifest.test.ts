/**
 * Where the template writes its version, and what it says a version means.
 *
 * The comment above `version` is a copy of `LINE_RULES` in prose, the list
 * an author reads before deciding whether a change is a patch. A field the
 * table fixes that the comment leaves out is a patch an author publishes
 * believing it allowed, and the platform refuses.
 */

import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { CAPABILITY_RULES, LINE_RULES } from "../../src/build/line"
import { TEMPLATE_DIR } from "../../src/cli/new"

async function versionComment(): Promise<string> {
  const text = await readFile(
    join(TEMPLATE_DIR, "src", "sim", "manifest.ts"),
    "utf8",
  )
  const at = text.indexOf('  version: "')
  const comment = text.slice(text.lastIndexOf("/**", at), at)
  expect(comment.startsWith("/**")).toBe(true)
  return comment
}

describe("the template's version", () => {
  test("is written once, in the manifest, and not in package.json", async () => {
    const manifest = JSON.parse(
      await readFile(join(TEMPLATE_DIR, "package.json"), "utf8"),
    ) as Record<string, unknown>
    expect(manifest.version).toBeUndefined()
  })

  test("its comment names every field a release line fixes", async () => {
    const comment = await versionComment()
    for (const [field, rule] of Object.entries(LINE_RULES)) {
      if (rule === "free" || field === "capabilities") continue
      expect(`${field}: ${comment.includes(field)}`).toBe(`${field}: true`)
    }
    for (const [capability, rule] of Object.entries(CAPABILITY_RULES)) {
      expect(`${capability}: ${comment.includes(capability)}`).toBe(
        `${capability}: ${rule === "fixed"}`,
      )
    }
  })

  test("its comment says what a patch, a minor and a major mean", async () => {
    const comment = await versionComment()
    for (const word of ["patch", "minor", "major", "E_PATCH_CHANGES_RULES"]) {
      expect(comment).toContain(word)
    }
  })
})
