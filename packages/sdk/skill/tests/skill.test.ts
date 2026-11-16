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
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { INPUT_BUDGET_PER_TICK, Prng } from "@clockwork2/engine"
import { TICK_RATES } from "@clockwork2/engine/manifest"
import {
  BUILD_REFUSAL,
  MAX_PRESENT_BYTES,
  MAX_SIM_BYTES,
  MAX_VERSION_PART,
  SIM_SPECIFIER,
} from "../../src/build/index.js"
import { CAPABILITY_RULES, LINE_RULES } from "../../src/build/line.js"
import { TEMPLATE_DIR } from "../../src/cli/new.js"
import {
  DEFAULT_BUNDLES_PORT,
  DEFAULT_HOST_PORT,
} from "../../src/harness/index.js"
import { CLIENT_ERROR } from "../../src/platform/errors.js"
import { CHUNK_SECONDS } from "../../src/platform/run.js"

/** `packages/sdk`, which ships the guide; the guide's tests sit outside it. */
const PACKAGE = join(import.meta.dir, "..", "..")
const REPOSITORY = join(PACKAGE, "..", "..")
const SKILL = join(PACKAGE, "skill", "vbz-game")
const REFERENCES = join(SKILL, "references")

/**
 * The engine's guide, in the engine this package resolves. A path the prose
 * writes as `clockwork2/...` is a file in it.
 */
const ENGINE_GUIDE = join(
  dirname(
    fileURLToPath(import.meta.resolve("@clockwork2/engine/package.json")),
  ),
  "skill",
  "clockwork2",
)

async function read(...parts: string[]): Promise<string> {
  return await readFile(join(SKILL, ...parts), "utf8")
}

/** Every Markdown file the guide ships, as a path inside the guide. */
async function prose(): Promise<string[]> {
  const references = (await readdir(REFERENCES)).filter((f) =>
    f.endsWith(".md"),
  )
  return ["SKILL.md", ...references.map((f) => `references/${f}`).sort()]
}

/** The whole guide as one text, for what may be said anywhere in it. */
async function everything(): Promise<string> {
  const texts = await Promise.all(
    (await prose()).map((file) => read(...file.split("/"))),
  )
  return texts.join("\n")
}

/** One `## ` section of a Markdown file, by its heading. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`)
  if (start === -1) return ""
  const end = markdown.indexOf("\n## ", start + 1)
  return markdown.slice(start, end === -1 ? undefined : end)
}

describe("the guide's front matter", () => {
  test("its name is its folder's, which is what a tool installs it under", async () => {
    // `vbz new` and `vbz guides` copy the folder into a game by its name, and
    // an agent's tools match a skill by the name it declares.
    const front = (await read("SKILL.md")).split("---")[1] ?? ""
    const name = /^name: (.+)$/m.exec(front)?.[1]
    expect(name).toBe(basename(SKILL))
    expect(name).toMatch(/^[a-z0-9-]{1,64}$/)
  })

  test("its description says when to use it", async () => {
    const front = (await read("SKILL.md")).split("---")[1] ?? ""
    const description = /^description: (.+)$/m.exec(front)?.[1] ?? ""
    // The description is what an agent matches against, so it names what an
    // author asks about rather than the repository the guide lives in.
    for (const word of [
      "controls",
      "manifest",
      "replay",
      "Prng",
      "Math.random",
      "seed",
      "device helpers",
      "tick",
    ]) {
      expect(description).toContain(word)
    }
    // And it sends the simulation's rules to the engine's guide, by the name
    // the engine ships it under.
    expect(description).toContain(basename(ENGINE_GUIDE))
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(description).not.toMatch(/<[a-zA-Z/]/)
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
   * Every other number the guide quotes that a constant decides. An author
   * who sizes a mapping to the budget the guide states, or opens the port it
   * names, finds out it moved only when something fails.
   */
  test("every limit it quotes is the code's", async () => {
    const skill = await read("SKILL.md")
    expect(skill).toContain(
      `more than ${INPUT_BUDGET_PER_TICK} inputs per tick, counted over the whole`,
    )
    expect(await read("references", "ingest.md")).toContain(
      `no part above ${MAX_VERSION_PART}`,
    )
    const harness = await read("references", "harness.md")
    expect(harness).toContain(`http://127.0.0.1:${DEFAULT_HOST_PORT} `)
    expect(harness).toContain(`http://127.0.0.1:${DEFAULT_BUNDLES_PORT} `)
    const page = await read("references", "page.md")
    const [first, second, third] = TICK_RATES
    expect(TICK_RATES.length).toBe(3)
    expect(page).toContain(`is not ${first}, ${second} or ${third}.`)
    const words: Readonly<Record<number, string>> = { 1: "one", 2: "two" }
    expect(page).toContain(
      `A chunk goes every ${words[CHUNK_SECONDS] ?? CHUNK_SECONDS} seconds of play`,
    )
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
      "docs/sdk.md": await readFile(join(REPOSITORY, "docs", "sdk.md"), "utf8"),
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
    const cli = await readFile(join(PACKAGE, "src", "cli", "index.ts"), "utf8")
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
    // `clockwork2/references/...` is the engine's guide, not this one.
    const linked = new Set(
      (text.match(/(?<!clockwork2\/)references\/[a-z-]+\.md/g) ?? []).map(
        (path) => path.replace("references/", ""),
      ),
    )
    expect([...linked].sort()).toEqual(onDisk.sort())
  })
})

describe("the engine's guide", () => {
  test("is installed where this guide says, under the name it uses", () => {
    // The engine ships it, and an engine without it is one this guide's
    // pointers lead nowhere from.
    expect(existsSync(join(ENGINE_GUIDE, "SKILL.md"))).toBe(true)
  })

  test("every file of it this guide names is one it ships", async () => {
    const named = [
      ...(await everything()).matchAll(/`clockwork2\/([\w./-]+)`/g),
    ].map((match) => match[1] as string)
    expect(named).toContain("references/inputs.md")
    expect(named).toContain("references/determinism-rules.md")
    for (const path of new Set(named)) {
      expect(existsSync(join(ENGINE_GUIDE, path)), path).toBe(true)
    }
  })

  test("it goes by clockwork2 everywhere, and by no older name", async () => {
    // It was `platform-game` before the engine shipped it, and an agent told
    // to load a guide by a name nothing installs finds nothing.
    for (const file of await prose()) {
      expect(`${file}: ${await read(...file.split("/"))}`).not.toContain(
        "platform-game",
      )
    }
    expect(await read("SKILL.md")).toContain("**clockwork2**")
  })

  /**
   * Determinism is the engine guide's subject, and two copies of a rulebook
   * is how one of them goes quietly out of date. Two sections repeat it
   * briefly, because they are what an author gets wrong first, and each
   * sends the reader to the engine's guide for the whole of it.
   */
  test("only two sections repeat it, and each points at it", async () => {
    const text = await read("SKILL.md")
    expect(text).not.toContain("dmath.ipow")
    expect(section(text, "Replays and randomness")).toContain(
      "`clockwork2/references/determinism-rules.md`",
    )
    expect(section(text, "Choosing what to record")).toContain(
      "`clockwork2/references/inputs.md`",
    )
  })

  /**
   * The randomness section quotes the engine's `Prng` as code an author will
   * paste. A method it names that the engine does not have is a game that
   * does not compile, written by an agent that trusted the guide.
   */
  test("every Prng method it quotes is one the engine's Prng has", async () => {
    const text = await everything()
    expect(text).toContain("new Prng(seed)")
    // `this.rng` is the Prng, and so is each sub-stream taken from it.
    const prngs = new Set([
      "rng",
      ...[...text.matchAll(/this\.(\w+) = this\.rng\.stream\(/g)].map(
        (match) => match[1] as string,
      ),
    ])
    const quoted = new Set(
      [...text.matchAll(/this\.(\w+)\.(\w+)\(/g)]
        .filter((match) => prngs.has(match[1] as string))
        .map((match) => match[2] as string),
    )
    expect(quoted.size).toBeGreaterThan(3)
    const methods = Object.getOwnPropertyNames(Prng.prototype)
    for (const method of quoted) expect(methods).toContain(method)
  })
})

describe("house style", () => {
  test("no em dashes anywhere in the guide", async () => {
    for (const file of await prose()) {
      const text = await read(...file.split("/"))
      expect(text.includes("—")).toBe(false)
      expect(text.includes("–")).toBe(false)
    }
  })
})
