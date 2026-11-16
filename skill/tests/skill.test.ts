/**
 * The skill is prose an agent follows literally, so a stale sentence is worse
 * than a missing one.
 *
 * Most of it cannot be measured: whether a paragraph about the page module is
 * still true is what the `Docs-Updated:` trailer records. What *can* be
 * measured is where the prose restates something the code owns - the size
 * caps, the refusal codes, the client's codes, the commands, the template's
 * layout - and those are what this file holds. A code added to a table
 * without a line in the reference fails here.
 */

import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  BUILD_REFUSAL,
  MAX_PRESENT_BYTES,
  MAX_SIM_BYTES,
  SIM_SPECIFIER,
} from "../../packages/sdk/src/build/index.js"
import {
  CAPABILITY_RULES,
  LINE_RULES,
} from "../../packages/sdk/src/build/line.js"
import { TEMPLATE_DIR } from "../../packages/sdk/src/cli/new.js"
import { CLIENT_ERROR } from "../../packages/sdk/src/platform/errors.js"

const SKILL = join(import.meta.dir, "..", "vbz-game")
const REFERENCES = join(SKILL, "references")

async function read(...parts: string[]): Promise<string> {
  return await readFile(join(SKILL, ...parts), "utf8")
}

describe("the skill's front matter", () => {
  test("it names itself and says when to use it", async () => {
    const text = await read("SKILL.md")
    const front = text.split("---")[1] ?? ""
    expect(front).toContain("name: vbz-game")
    expect(front).toContain("description:")
    // The description is what an agent matches against, so it has to name
    // the things this skill is for rather than the repository it lives in.
    expect(front).toContain("controls")
    expect(front).toContain("manifest")
  })
})

describe("what the prose restates from the code", () => {
  test("the bare specifier is spelled the way the scan demands", async () => {
    for (const file of ["SKILL.md", "references/artifacts.md"]) {
      expect(await read(...file.split("/"))).toContain(SIM_SPECIFIER)
    }
  })

  test("the size caps are the caps", async () => {
    const text = await read("references", "artifacts.md")
    expect(text).toContain(`${MAX_SIM_BYTES / 1024 / 1024} MiB`)
    expect(text).toContain(`${MAX_PRESENT_BYTES / 1024 / 1024} MiB`)
  })

  /**
   * A code in the prose that the code does not raise sends an author looking
   * for a failure that cannot happen. Only the artifact refusals are checked
   * here: the manifest and rank codes belong to the platform and cannot be
   * imported from this repository.
   */
  test("every artifact refusal named is one that exists", async () => {
    const owned = new Set<string>(Object.values(BUILD_REFUSAL))
    const text = `${await read("SKILL.md")}\n${await read("references", "ingest.md")}`
    const named = text.match(/E_[A-Z0-9_]+/g) ?? []
    const artifactCodes = named.filter(
      (code) =>
        code.startsWith("E_PRESENT") ||
        code.startsWith("E_ARTIFACT") ||
        code.startsWith("E_SIM") ||
        code.startsWith("E_REWRITE") ||
        code.startsWith("E_VERSION_INVALID"),
    )
    expect(artifactCodes.length).toBeGreaterThan(4)
    for (const code of artifactCodes) expect(owned).toContain(code)
    // The codes the page module's checks were renamed from.
    expect(named.filter((code) => code.startsWith("E_FRAME"))).toEqual([])
  })

  test("every artifact refusal that exists is explained somewhere", async () => {
    const text = `${await read("SKILL.md")}\n${await read("references", "artifacts.md")}\n${await read("references", "ingest.md")}`
    for (const code of Object.values(BUILD_REFUSAL)) {
      if (code === BUILD_REFUSAL.REWRITE_FAILED) continue // the platform's, never an author's
      expect(text).toContain(code)
    }
  })
})

describe("what a release line fixes", () => {
  /**
   * The fields a patch must keep are `LINE_RULES`, and three pages say them in
   * prose. A field the table fixes that a page leaves out is a patch an author
   * publishes and the platform refuses; one a page names that the table frees
   * is a minor nobody needed. Each copy is the sentence naming
   * `E_PATCH_CHANGES_RULES`, read for the fields in backticks outside its
   * parentheses, which hold what each field keeps.
   */
  test("every prose copy names exactly the fields LINE_RULES fixes", async () => {
    const fixed = [
      ...Object.entries(LINE_RULES)
        .filter(([field, rule]) => rule !== "free" && field !== "capabilities")
        .map(([field]) => field),
      ...Object.entries(CAPABILITY_RULES)
        .filter(([, rule]) => rule === "fixed")
        .map(([capability]) => capability),
    ].sort()
    const known = new Set([
      ...Object.keys(LINE_RULES),
      ...Object.keys(CAPABILITY_RULES),
    ])
    const copies = {
      "SKILL.md": await read("SKILL.md"),
      "references/ingest.md": await read("references", "ingest.md"),
      "docs/sdk.md": await readFile(
        join(import.meta.dir, "..", "..", "docs", "sdk.md"),
        "utf8",
      ),
    }
    for (const [name, text] of Object.entries(copies)) {
      const sentence = text
        .replace(/\s+/g, " ")
        .split(/(?<=\.) (?=[A-Z`])/)
        .find(
          (part) =>
            part.includes("E_PATCH_CHANGES_RULES") &&
            part.includes("`schemaVersion`"),
        )
      expect(`${name}: ${sentence === undefined ? "no copy" : "a copy"}`).toBe(
        `${name}: a copy`,
      )
      const outside = (sentence ?? "").replace(/\([^)]*\)/g, "")
      const named = [...outside.matchAll(/`([A-Za-z]+)`/g)]
        .map((match) => match[1] ?? "")
        .filter((field) => known.has(field))
        .sort()
      expect(`${name}: ${named.join(", ")}`).toBe(
        `${name}: ${fixed.join(", ")}`,
      )
    }
  })
})

describe("the page's client", () => {
  /**
   * A code the page reference names that the client does not raise sends a
   * page author looking for a failure that cannot happen, and a code it
   * raises that the reference never explains leaves them guessing.
   */
  test("every client code is explained, and every one named exists", async () => {
    const text = await read("references", "page.md")
    const table = text.slice(text.indexOf("## Codes"))
    const named = new Set(table.match(/E_[A-Z0-9_]+/g) ?? [])
    expect([...named].sort()).toEqual(Object.keys(CLIENT_ERROR).sort())
  })
})

describe("what the skill tells an author to run", () => {
  test("every command it lists is one the CLI takes", async () => {
    const cli = await readFile(
      join(
        import.meta.dir,
        "..",
        "..",
        "packages",
        "sdk",
        "src",
        "cli",
        "index.ts",
      ),
      "utf8",
    )
    const text = await read("SKILL.md")
    for (const command of ["new", "build", "check", "dev", "publish"]) {
      expect(text).toContain(`vbz ${command}`)
      expect(cli).toContain(`case "${command}"`)
    }
  })

  test("the layout it prints is the template's own", async () => {
    const text = await read("SKILL.md")
    for (const file of [
      "src/sim/index.ts",
      "src/sim/manifest.ts",
      "src/capture.ts",
      "src/present.ts",
    ]) {
      expect(text).toContain(file)
      expect(
        await readFile(join(TEMPLATE_DIR, file), "utf8").catch(() => null),
      ).not.toBeNull()
    }
  })
})

describe("the references", () => {
  test("every one on disk is linked, and every link is on disk", async () => {
    const onDisk = (await readdir(REFERENCES)).filter((f) => f.endsWith(".md"))
    const text = await read("SKILL.md")
    const linked = new Set(
      (text.match(/references\/[a-z-]+\.md/g) ?? []).map((path) =>
        path.replace("references/", ""),
      ),
    )
    expect([...linked].sort()).toEqual(onDisk.sort())
  })

  test("they point at the other skill rather than repeating it", async () => {
    // Determinism is platform-game's subject. Two copies of that rulebook is
    // how one of them goes quietly out of date.
    const text = await read("SKILL.md")
    expect(text).toContain("platform-game")
    expect(text).not.toContain("dmath.ipow")
  })
})

describe("house style", () => {
  test("no em dashes anywhere in the skill", async () => {
    const files = [
      "SKILL.md",
      ...(await readdir(REFERENCES)).map((f) => `references/${f}`),
    ]
    for (const file of files) {
      const text = await read(...file.split("/"))
      expect(text.includes("—")).toBe(false)
      expect(text.includes("–")).toBe(false)
    }
  })
})
