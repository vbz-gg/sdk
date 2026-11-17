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
import { ERROR_CODES, INPUT_BUDGET_PER_TICK, Prng } from "@clockwork2/engine"
import { TICK_RATES } from "@clockwork2/engine/manifest"
import ts from "typescript"
import type { VersionCheckCode } from "../../src/api/index.js"
import * as build from "../../src/build/index.js"
import {
  BUILD_REFUSAL,
  CHECKS_CONTAINER_WAIT_MS,
  MAX_CHUNK_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_FILES_BYTES,
  MAX_PACK_BYTES,
  MAX_PACKS_BYTES,
  MAX_PRESENT_BYTES,
  MAX_RUN_BYTES,
  MAX_SIM_BYTES,
  MAX_VERSION_PART,
  PATCH_SCORE_RUNS,
  REPLAY_ANSWER_MARGIN_MS,
  REPLAY_CPU_BUDGET_MS,
  REPLAY_MEMORY_MB,
  REPLAY_WALL_BUDGET_MS,
  SIM_SPECIFIER,
} from "../../src/build/index.js"
import { CAPABILITY_RULES, LINE_RULES } from "../../src/build/line.js"
import { COMMANDS } from "../../src/cli/index.js"
import { TEMPLATE_DIR } from "../../src/cli/new.js"
import {
  CHECK_PUBLISH_ALLOWANCE_MS,
  CHECK_QUEUE_ALLOWANCE_MS,
  CHECK_WAIT_HEADROOM_MS,
  CHECK_WAIT_MS,
} from "../../src/cli/publish.js"
import { NEEDS, PACKAGE_KEY } from "../../src/cli/source.js"
import {
  DEFAULT_BUNDLES_PORT,
  DEFAULT_HOST_PORT,
  pageCsp,
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

/** A file of this repository, outside the guide, such as `docs/sdk.md`. */
async function readRepository(...parts: string[]): Promise<string> {
  return await readFile(join(REPOSITORY, ...parts), "utf8")
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

/** One union `/api` declares, as its source writes it. */
interface ApiUnion {
  /** Every string literal it names. */
  readonly literals: ReadonlySet<string>
  /** Those whose own doc comment says "No longer reached". */
  readonly retired: ReadonlySet<string>
}

/** What a member's doc comment says when nothing reaches the code any more. */
const RETIRED = "No longer reached"

/**
 * Every union `/api` declares, by the union's name, read from its source
 * with TypeScript's parser. `/api` is types only, so a union there has no
 * value to import, and a copy of one here would drift from it with nothing
 * failing.
 */
async function apiUnions(): Promise<ReadonlyMap<string, ApiUnion>> {
  const path = join(PACKAGE, "src", "api", "index.ts")
  const text = await readFile(path, "utf8")
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest)
  const unions = new Map<string, ApiUnion>()
  for (const statement of source.statements) {
    if (
      ts.isTypeAliasDeclaration(statement) &&
      ts.isUnionTypeNode(statement.type)
    ) {
      const literals = new Set<string>()
      const retired = new Set<string>()
      // A member's doc comment sits before the `|` that opens it, so it is
      // whatever lies between the member before it and this one.
      let after = statement.type.pos
      for (const member of statement.type.types) {
        if (
          ts.isLiteralTypeNode(member) &&
          ts.isStringLiteral(member.literal)
        ) {
          literals.add(member.literal.text)
          if (text.slice(after, member.getStart(source)).includes(RETIRED)) {
            retired.add(member.literal.text)
          }
        }
        after = member.end
      }
      unions.set(statement.name.text, { literals, retired })
    }
  }
  return unions
}

/** `/api`'s unions and the guide's refusal list, each read once a run. */
const API_UNIONS = await apiUnions()
function apiUnion(name: string): ApiUnion {
  const union = API_UNIONS.get(name)
  if (union === undefined) throw new Error(`/api declares no union ${name}`)
  return union
}
const PUBLIC_REFUSALS = apiUnion("PublicRefusalCode").literals
const CHECK_CODES = apiUnion("VersionCheckCode").literals
const RETIRED_CHECK_CODES = apiUnion("VersionCheckCode").retired
const REFUSAL_LIST = section(await read("SKILL.md"), "When ingest refuses")

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

  /**
   * Every limit `/build` exports, with the value it is written as. A table
   * that names a limit the code does not have, or leaves one out, or quotes
   * a value the code moved, is an author sizing a build to a number that is
   * not the one `vbz build` holds it to.
   */
  const LIMITS: Readonly<Record<string, number>> = Object.fromEntries(
    Object.entries(build).filter(
      (entry): entry is [string, number] =>
        entry[0].startsWith("MAX_") && typeof entry[1] === "number",
    ),
  )
  const written = (name: string, value: number): string =>
    name.endsWith("_BYTES") && value % (1024 * 1024) === 0
      ? `${value / 1024 / 1024} MiB`
      : name.endsWith("_BYTES")
        ? `${value.toLocaleString("en")} bytes`
        : value.toLocaleString("en")

  test("every limit table names every limit the code has, at its value", async () => {
    expect(Object.keys(LIMITS).length).toBeGreaterThan(10)
    for (const [where, text] of [
      ["references/files.md", await read("references", "files.md")],
      ["docs/sdk.md", await readRepository("docs", "sdk.md")],
    ] as const) {
      const rows = new Map(
        [...text.matchAll(/^\| `(MAX_[A-Z_]+)` \| ([^|]+) \|/gm)].map(
          (match) => [match[1] as string, (match[2] as string).trim()],
        ),
      )
      expect(`${where}: ${[...rows.keys()].sort().join(", ")}`).toBe(
        `${where}: ${Object.keys(LIMITS).sort().join(", ")}`,
      )
      for (const [name, value] of Object.entries(LIMITS)) {
        expect(`${where} ${name}: ${rows.get(name)}`).toBe(
          `${where} ${name}: ${written(name, value)}`,
        )
      }
    }
  })

  /** The package README's short table, which names what each limit holds. */
  test("the package README's limits are the code's", async () => {
    const text = await readFile(join(PACKAGE, "README.md"), "utf8")
    const rows: ReadonlyArray<readonly [string, string]> = [
      ["the rules code", written("MAX_SIM_BYTES", MAX_SIM_BYTES)],
      ["the page module", written("MAX_PRESENT_BYTES", MAX_PRESENT_BYTES)],
      ["one file of the folder", written("MAX_FILE_BYTES", MAX_FILE_BYTES)],
      [
        "the whole folder",
        `${written("MAX_FILES_BYTES", MAX_FILES_BYTES)}, in at most ${MAX_FILES.toLocaleString("en")} files`,
      ],
      ["one data pack", written("MAX_PACK_BYTES", MAX_PACK_BYTES)],
      ["every data pack together", written("MAX_PACKS_BYTES", MAX_PACKS_BYTES)],
      ["a run's recording", written("MAX_RUN_BYTES", MAX_RUN_BYTES)],
    ]
    for (const [what, value] of rows) {
      expect(text).toContain(`| ${what} | ${value} |`)
    }
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
   * here, by their prefixes; the next block holds the rest of what ingest
   * refuses.
   */
  test("every artifact refusal named is one that exists", async () => {
    // The engine's own codes share prefixes with the build's, such as
    // E_PRESENTATION_FAILED beside E_PRESENT_WORKER, and are the engine's;
    // E_SIM_NO_MANIFEST is a check's.
    const owned = new Set<string>([
      ...Object.values(BUILD_REFUSAL),
      ...Object.keys(ERROR_CODES),
      ...CHECK_CODES,
    ])
    const text = [
      await everything(),
      await readRepository("docs", "sdk.md"),
      await readFile(join(PACKAGE, "README.md"), "utf8"),
    ].join("\n")
    const named = text.match(/E_[A-Z0-9_]+/g) ?? []
    const artifactCodes = named.filter(
      (code) =>
        code.startsWith("E_PRESENT") ||
        code.startsWith("E_ARTIFACT") ||
        code.startsWith("E_SIM") ||
        code.startsWith("E_FILE") ||
        code.startsWith("E_PACK") ||
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

/**
 * Every code `VersionCheckCode` names, written out here and held to the
 * union by the compiler: a code the union gains or loses fails to compile
 * until this has its row, and the test below compares it with what the
 * parser read from the declaration.
 */
const EVERY_CHECK_CODE = {
  E_SIM_NO_MANIFEST: true,
  E_MANIFEST_MISMATCH: true,
  E_ENGINE_DIVERGED: true,
  E_PAGE_MODULE_UNLOADABLE: true,
  E_PAGE_MODULE_INVALID: true,
  E_PAGE_MODULE_THREW: true,
  E_PAGE_MODULE_DIVERGED: true,
  E_REPLAY_MODULE: true,
  E_REPLAY_OVER_BUDGET: true,
  E_REPLAY_THREW: true,
  E_REPLAY_REACHED_OUT: true,
  E_REPLAY_MALFORMED: true,
} as const satisfies Record<VersionCheckCode, true>

describe("the platform's refusals of a version", () => {
  test("the unions are read whole", () => {
    // Every refusal the build makes is a public code, which `api.test.ts`
    // holds at compile time, so a reading that misses one missed the union.
    for (const code of Object.values(BUILD_REFUSAL)) {
      expect(PUBLIC_REFUSALS).toContain(code)
    }
    expect(PUBLIC_REFUSALS).toContain("E_BAD_REQUEST")
    // A member the parser skipped, such as one written in another form, is
    // one the guide would never be held to explaining.
    expect([...CHECK_CODES].sort()).toEqual(
      Object.keys(EVERY_CHECK_CODE).sort(),
    )
  })

  /**
   * A code in the refusal list that the platform never gives sends an
   * author looking for a failure that cannot happen, and leaves the one
   * that does unexplained. `references/ingest.md` also names what the
   * engine's checks end in, which reaches a build system as the version's
   * `rejectedCode`.
   */
  test("every code the guide's refusal list and ingest.md name is one that exists", async () => {
    const listed = REFUSAL_LIST.match(/E_[A-Z0-9_]+/g) ?? []
    expect(listed.length).toBeGreaterThan(4)
    for (const code of listed) {
      expect(
        `${code}: ${PUBLIC_REFUSALS.has(code) || CHECK_CODES.has(code)}`,
      ).toBe(`${code}: true`)
    }
    const engine = new Set(Object.keys(ERROR_CODES))
    const ingest = (await read("references", "ingest.md")).match(
      /E_[A-Z0-9_]+/g,
    )
    for (const code of ingest ?? []) {
      const known =
        PUBLIC_REFUSALS.has(code) || CHECK_CODES.has(code) || engine.has(code)
      expect(`${code}: ${known}`).toBe(`${code}: true`)
    }
  })

  /**
   * The platform's own checks refuse a version after the upload, where no
   * `vbz build` can see it first, so the guide is the only place an author
   * learns what each of their codes means and what to change.
   */
  test("every code a version's checks end in is in the refusal list and in ingest.md", async () => {
    const ingest = await read("references", "ingest.md")
    for (const code of CHECK_CODES) {
      expect(`${code}: ${REFUSAL_LIST.includes(`\`${code}\``)}`).toBe(
        `${code}: true`,
      )
      expect(`${code}: ${ingest.includes(`\`${code}\``)}`).toBe(`${code}: true`)
    }
  })

  /**
   * A code no check reaches any more stays in the union, so nothing that
   * switches on it breaks, and the guide says it is no longer reached, so an
   * author does not look for a failure that cannot happen. A code still
   * reached is never explained as one that is not.
   */
  test("a code no check reaches any more is explained as no longer reached, and only such a code", async () => {
    expect(RETIRED_CHECK_CODES.size).toBeGreaterThan(0)
    const retired = /no\s+longer\s+reached/i
    for (const item of REFUSAL_LIST.split(/\n(?=- )/)) {
      for (const code of item.match(/E_[A-Z0-9_]+/g) ?? []) {
        if (!CHECK_CODES.has(code)) continue
        expect(`${code}: ${retired.test(item)}`).toBe(
          `${code}: ${RETIRED_CHECK_CODES.has(code)}`,
        )
      }
    }
    const ingest = await read("references", "ingest.md")
    for (const paragraph of ingest.split(/\n\n/)) {
      for (const code of RETIRED_CHECK_CODES) {
        if (!paragraph.includes(`\`${code}\``)) continue
        expect(`${code}: ${retired.test(paragraph)}`).toBe(`${code}: true`)
      }
    }
  })

  /**
   * An upload with no ranking was once explained under two spellings, one
   * the platform answers and one nothing raised. The platform answers the
   * engine's own code, the one `vbz check --ranked` reports.
   */
  test("a manifest with no ranking is refused under one name, the engine's", async () => {
    const text = [
      await everything(),
      await readRepository("docs", "sdk.md"),
      await readFile(join(PACKAGE, "README.md"), "utf8"),
    ].join("\n")
    const spellings = new Set(text.match(/E_RANK[A-Z_]*UNDECLARED/g) ?? [])
    expect([...spellings]).toEqual(["E_RANK_UNDECLARED"])
    expect(Object.keys(ERROR_CODES)).toContain("E_RANK_UNDECLARED")
    expect(PUBLIC_REFUSALS).toContain("E_RANK_UNDECLARED")
    expect(REFUSAL_LIST).toContain("`E_RANK_UNDECLARED`")
  })
})

describe("one replay's budget", () => {
  /** A duration as the prose writes it in minutes. */
  const minutes = (ms: number): string => `${ms / 60_000}`

  /**
   * An author sizes a step to the CPU the guide says a replay has, so each
   * figure quoted for one replay, wherever it is quoted, is the constant the
   * platform takes its replays' budget from, and so is what follows from it.
   */
  test("every figure quoted for one replay is the budget /build exports", async () => {
    const texts: Readonly<Record<string, string>> = {
      "SKILL.md": await read("SKILL.md"),
      "references/ingest.md": await read("references", "ingest.md"),
      "references/files.md": await read("references", "files.md"),
      "docs/sdk.md": await readRepository("docs", "sdk.md"),
    }
    const seen = { cpu: 0, wall: 0, memory: 0, steps: 0 }
    for (const [where, raw] of Object.entries(texts)) {
      const text = raw.replace(/\s+/g, " ")
      for (const match of text.matchAll(/([\d.]+) minutes of CPU/g)) {
        seen.cpu += 1
        expect(`${where}: ${match[1]}`).toBe(
          `${where}: ${minutes(REPLAY_CPU_BUDGET_MS)}`,
        )
      }
      for (const match of text.matchAll(/([\d.]+) minutes of wall time/g)) {
        seen.wall += 1
        expect(`${where}: ${match[1]}`).toBe(
          `${where}: ${minutes(REPLAY_WALL_BUDGET_MS)}`,
        )
      }
      for (const match of text.matchAll(/(\d+) MB of memory/g)) {
        seen.memory += 1
        expect(`${where}: ${match[1]}`).toBe(`${where}: ${REPLAY_MEMORY_MB}`)
      }
      for (const match of text.matchAll(
        /At (\d+) steps a second an hour of play is ([\d,]+) steps, and [\d.]+ minutes of CPU leaves about ([\d.]+) ms for each/g,
      )) {
        seen.steps += 1
        const rate = Number(match[1])
        expect((TICK_RATES as readonly number[]).includes(rate)).toBe(true)
        const perHour = rate * 60 * 60
        expect(`${where}: ${match[2]}`).toBe(
          `${where}: ${perHour.toLocaleString("en")}`,
        )
        expect(`${where}: ${match[3]}`).toBe(
          `${where}: ${(REPLAY_CPU_BUDGET_MS / perHour).toFixed(1)}`,
        )
      }
    }
    expect(seen.cpu).toBeGreaterThanOrEqual(4)
    expect(seen.wall).toBeGreaterThanOrEqual(3)
    expect(seen.memory).toBeGreaterThanOrEqual(3)
    expect(seen.steps).toBeGreaterThanOrEqual(2)
  })

  /**
   * A build system's own timeout is set from the wait `vbz publish` states,
   * so the figure docs/sdk.md gives, and each part it names, is the command's.
   */
  test("the publish wait docs/sdk.md states is the command's", async () => {
    const text = (await readRepository("docs", "sdk.md")).replace(/\s+/g, " ")
    const waits = [...text.matchAll(/It waits up to ([\d.]+) minutes/g)].map(
      (match) => match[1],
    )
    expect(waits).toEqual([minutes(CHECK_WAIT_MS)])
    expect(text).toContain(
      `${minutes(CHECK_QUEUE_ALLOWANCE_MS)} minutes for the ingest job`,
    )
    expect(text).toContain(
      `${minutes(CHECKS_CONTAINER_WAIT_MS)} minutes for the checks container`,
    )
    expect(text).toContain(
      `the ${minutes(REPLAY_WALL_BUDGET_MS)} minutes of wall time one replay may take`,
    )
    expect(text).toContain(
      `${REPLAY_ANSWER_MARGIN_MS / 1000} seconds the platform waits past it for the answer`,
    )
    expect(text).toContain(
      `${minutes(CHECK_PUBLISH_ALLOWANCE_MS)} minutes for copying a published version's files`,
    )
    expect(text).toContain(
      `${minutes(CHECK_WAIT_HEADROOM_MS)} minute of headroom`,
    )
  })
})

describe("a patch's replays", () => {
  /**
   * A studio reads how many of its line's runs a patch is replayed against,
   * and the build log prints a count of them, so every count the prose
   * gives is the one the platform takes from `/build`, and every printed
   * example is one the platform could measure.
   */
  test("every count quoted for a patch's replays is PATCH_SCORE_RUNS", async () => {
    const api = await readFile(join(PACKAGE, "src", "api", "index.ts"), "utf8")
    const texts: Readonly<Record<string, string>> = {
      "SKILL.md": await read("SKILL.md"),
      "references/ingest.md": await read("references", "ingest.md"),
      "docs/sdk.md": await readRepository("docs", "sdk.md"),
      "README.md": await readFile(join(PACKAGE, "README.md"), "utf8"),
      // The doc comments, as the prose they are.
      "src/api/index.ts": api.replace(/\n\s*\* ?/g, " "),
    }
    const seen = { counts: 0, examples: 0 }
    for (const [where, raw] of Object.entries(texts)) {
      const text = raw.replace(/\s+/g, " ")
      for (const match of text.matchAll(
        /(?:at most|up to) (\d+) of (?:its|the) (?:release )?line's (?:most )?recent/g,
      )) {
        seen.counts += 1
        expect(`${where}: ${match[1]}`).toBe(`${where}: ${PATCH_SCORE_RUNS}`)
      }
      for (const match of text.matchAll(
        /patch check: (\d+) of (\d+) recent ranked runs?/g,
      )) {
        seen.examples += 1
        const [differing, compared] = [Number(match[1]), Number(match[2])]
        expect(`${where}: ${compared <= PATCH_SCORE_RUNS}`).toBe(
          `${where}: true`,
        )
        expect(`${where}: ${differing <= compared}`).toBe(`${where}: true`)
      }
    }
    expect(seen.counts).toBeGreaterThanOrEqual(4)
    expect(seen.examples).toBeGreaterThanOrEqual(2)
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

describe("what the guide tells an author to run", () => {
  /**
   * A command the guide names that the CLI does not take is a step an agent
   * runs and fails at, and a command the CLI takes that the guide never
   * lists is one an agent never finds.
   */
  test("every command it names is one the CLI takes, and every one is listed", async () => {
    const text = await everything()
    const named = new Set(
      [...text.matchAll(/`(?:bunx )?vbz ([a-z]+)\b/g)].map(
        (match) => match[1] as string,
      ),
    )
    for (const line of text.split("\n")) {
      const command = /^(?:bunx (?:@vbz-gg\/sdk|vbz)|vbz) ([a-z]+)\b/.exec(line)
      if (command !== null) named.add(command[1] as string)
    }
    expect(named.size).toBeGreaterThan(4)
    const commands = COMMANDS.map((command) => command.name)
    for (const command of named) expect(commands).toContain(command)
    const skill = await read("SKILL.md")
    for (const command of commands) {
      expect(skill).toContain(`- \`vbz ${command} <dir>`)
    }
  })

  test("the layout it prints is the template's own", async () => {
    const text = await read("SKILL.md")
    for (const file of [
      "src/sim/index.ts",
      "src/sim/manifest.ts",
      "src/capture.ts",
      "src/present.ts",
      "site/config.json",
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
      (text.match(/(?<!clockwork2\/)references\/[a-z0-9-]+\.md/g) ?? []).map(
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

describe("what a page's policy needs", () => {
  /** Every `"vbz": { ... "needs": { ... } }` the prose shows, as parsed JSON. */
  async function shownNeeds(): Promise<Array<Record<string, unknown>>> {
    const text = `${await everything()}\n${await readRepository("docs", "sdk.md")}\n${await readFile(join(PACKAGE, "README.md"), "utf8")}`
    return [...text.matchAll(/\{ "vbz": (\{[^\n]*\}) \}/g)].map(
      (match) => JSON.parse(match[1] as string) as Record<string, unknown>,
    )
  }

  /**
   * A need the prose tells an author to name that `vbz` does not take
   * stops their build; one the code takes that no page explains is a policy
   * nobody knows to ask for.
   */
  test("every need the prose names is one a game's package.json may name", async () => {
    const shown = await shownNeeds()
    expect(shown.length).toBeGreaterThan(2)
    expect(PACKAGE_KEY).toBe("vbz")
    for (const settings of shown) {
      const needs = (settings.needs ?? {}) as Record<string, unknown>
      for (const need of Object.keys(needs)) {
        expect(NEEDS as readonly string[]).toContain(need)
      }
    }
    const table = (await read("references", "files.md")).replace(/\s+/g, " ")
    for (const need of NEEDS) expect(table).toContain(`| \`${need}\` |`)
    // And the one the build shows, which a game never names.
    expect(table).toContain("| files |")
  })

  /**
   * The policy the null3d recipe and docs/sdk.md print for a game that
   * needs everything is `pageCsp`'s, directive for directive, so a page
   * that copies it is the page the browser suite measured.
   */
  test("the policy printed for a game that needs everything is pageCsp's", async () => {
    const policy = pageCsp({
      bundlesOrigin: "https://files.vbz.gg",
      gameId: "<game id>",
      connect: ["https://api.vbz.gg"],
      signInOrigin: "https://signin.vbz.gg",
      needs: { wasm: true, workers: true, files: true },
    })
    const directives = policy.split("; ").sort()
    const block = (text: string): string[] => {
      const found = /```\n(default-src 'none';[^`]*)```/.exec(
        text.slice(text.indexOf("'wasm-unsafe-eval';") - 200),
      )?.[1]
      return (found ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .split(/; ?/)
        .map((directive) => directive.trim())
        .filter((directive) => directive !== "")
        .sort()
    }
    expect(block(await read("references", "null3d.md"))).toEqual(directives)
    expect(block(await readRepository("docs", "sdk.md"))).toEqual(directives)
  })
})

describe("the null3d recipe", () => {
  /**
   * The recipe quotes the engine guide's measured cost of a mouse under
   * lock, and works out how long a run can move one before its recording
   * fills. Both drift with the engine's measurement and the run's limits.
   */
  test("its mouse figures are the engine guide's, and its run lengths follow from the limits", async () => {
    const recipe = await read("references", "null3d.md")
    const measured = (
      await readFile(join(ENGINE_GUIDE, "references", "inputs.md"), "utf8")
    )
      .split("\n")
      .filter((line) => line.startsWith("| Mouse under lock |"))
    expect(measured).toHaveLength(2)
    const rows = [
      ...recipe.matchAll(
        /^\| (\d) pixels? a step[^|]*\| (\d+) \| ([\d.]+) \| (\d+) bytes \|$/gm,
      ),
    ]
    expect(rows).toHaveLength(2)
    const room = MAX_RUN_BYTES - MAX_CHUNK_BYTES
    for (const row of rows) {
      const [, , inputs, perTick, bytes] = row as unknown as string[]
      const line = measured.find((one) =>
        one.includes(`| ${inputs} | ${perTick} |`),
      )
      expect(
        `${inputs} inputs: ${line === undefined ? "not" : ""} measured`,
      ).toBe(`${inputs} inputs:  measured`)
      expect(line).toContain(`| ${bytes} |`)
      // Five minutes of it, scaled to what a run records before it ends.
      const minutes = Math.floor(((room / Number(bytes)) * 300) / 60)
      expect(recipe).toContain(
        `${Math.floor(minutes / 60)} h ${minutes % 60} min`,
      )
    }
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
