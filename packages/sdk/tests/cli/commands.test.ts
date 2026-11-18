/**
 * The command table: what the dispatcher finds a command by, what the usage
 * lists, and what the agent guide's test reads, in one place.
 */

import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"
import {
  type Flag,
  parseArgs,
  SWITCH_FLAGS,
  VALUE_FLAGS,
} from "../../src/cli/args.js"
import { type Command, usageText } from "../../src/cli/commands.js"
import { GUIDES, OWN_ROOT, SKILLS_DIR } from "../../src/cli/guides.js"
import { COMMANDS } from "../../src/cli/index.js"
import { TEMPLATE_DIR } from "../../src/cli/new.js"

const CLI = join(OWN_ROOT, "src", "cli", "index.ts")

function row(name: string, summary: readonly string[]): Command {
  return { name, args: "[dir]", summary, flags: [], run: async () => 0 }
}

describe("the usage", () => {
  test("lines every command's summary up, its continuation lines too", () => {
    expect(
      usageText(
        [
          row("new", ["copy a game"]),
          row("publish", ["upload it", "and wait"]),
        ],
        "flags\n",
      ),
    ).toBe(
      "vbz - make, build and play a Clockwork 2 game, on any page\n\n" +
        "  vbz new     [dir]   copy a game\n" +
        "  vbz publish [dir]   upload it\n" +
        "                      and wait\n\n" +
        "flags\n",
    )
  })

  test("lists every command in the table, and nothing else", async () => {
    const result = await $`bun ${CLI}`.quiet().nothrow()
    expect(result.exitCode).toBe(0)
    const listed = [
      ...result.stdout.toString().matchAll(/^ {2}vbz ([a-z]+) /gm),
    ].map((match) => match[1])
    expect(listed).toEqual(COMMANDS.map((command) => command.name))
  })

  test("a command the table does not hold prints the usage and exits 1", async () => {
    const result = await $`bun ${CLI} deploy`.quiet().nothrow()
    expect(result.exitCode).toBe(1)
    expect(result.stdout.toString()).toStartWith(
      "vbz - make, build and play a Clockwork 2 game, on any page\n",
    )
  })

  /**
   * `vbz guides` replaces the two guide folders and leaves the rest of
   * `.claude/skills/` alone, so the usage names the two folders rather than
   * the whole directory.
   */
  test("says vbz guides replaces the two guide folders, by name", () => {
    const guides = COMMANDS.find((command) => command.name === "guides")
    const summary = (guides?.summary ?? []).join(" ")
    for (const guide of GUIDES) {
      expect(summary).toContain(`${SKILLS_DIR}/${guide.name}`)
    }
    expect(summary).not.toMatch(/replace \.claude\/skills\/? /)
  })
})

describe("the table", () => {
  test("holds each command once", () => {
    const names = COMMANDS.map((command) => command.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(["new", "guides", "build", "check", "dev", "publish"])
  })
})

/** The commands' rows, by name. */
function readers(flag: Flag): string[] {
  return COMMANDS.filter((command) => command.flags.includes(flag)).map(
    (command) => command.name,
  )
}

describe("a flag a command does not read", () => {
  /**
   * Refused before the command does anything, so nothing is built, served
   * or checked on a flag the command would have ignored.
   */
  test("vbz dev --addressed and vbz check --game are refused, and run nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdk-flags-"))
    try {
      const dev = await $`bun ${CLI} dev ${dir} --addressed`.quiet().nothrow()
      expect(dev.exitCode).toBe(1)
      expect(dev.stdout.toString()).toBe("")
      expect(dev.stderr.toString()).toBe(
        "vbz dev does not read --addressed; vbz build reads it\n",
      )
      const check =
        await $`bun ${CLI} check ${dir} --game 11111111-2222-4333-8444-555555555555`
          .quiet()
          .nothrow()
      expect(check.exitCode).toBe(1)
      expect(check.stdout.toString()).toBe("")
      expect(check.stderr.toString()).toBe(
        "vbz check does not read --game; vbz build and vbz publish read it\n",
      )
      // Neither built anything into the directory.
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/** The prose an author or an agent reads commands from. */
const PROSE = [
  join(OWN_ROOT, "..", "..", "README.md"),
  join(OWN_ROOT, "..", "..", "docs", "sdk.md"),
  join(OWN_ROOT, "README.md"),
  join(OWN_ROOT, "skill", "vbz-game", "SKILL.md"),
  join(TEMPLATE_DIR, "README.md"),
  join(TEMPLATE_DIR, "game-agents.md"),
]

/** The template's own scripts, which every new game runs as `bun run <name>`. */
async function templateScripts(): Promise<Record<string, string>> {
  const manifest = JSON.parse(
    await readFile(join(TEMPLATE_DIR, "package.json"), "utf8"),
  ) as { readonly scripts: Record<string, string> }
  return manifest.scripts
}

/**
 * Every `vbz` call a piece of prose shows: in an inline code span or at the
 * start of a line of a code block, as `vbz`, `bunx vbz`,
 * `bunx @vbz-gg/sdk`, or `bun run` of one of the template's scripts with
 * what follows it. Each comes back as the arguments after `vbz`.
 */
function callsIn(
  text: string,
  scripts: Readonly<Record<string, string>>,
): string[][] {
  const spans = [
    ...[...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] as string),
    ...text.split("\n").map((line) => line.trim()),
  ]
  const calls: string[][] = []
  for (const span of spans) {
    const words = span.replace(/\s#.*$/, "").split(/\s+/)
    if (words[0] === "vbz") calls.push(words.slice(1))
    else if (
      words[0] === "bunx" &&
      (words[1] === "vbz" || words[1] === "@vbz-gg/sdk")
    ) {
      calls.push(words.slice(2))
    } else if (words[0] === "bun" && words[1] === "run") {
      const script = scripts[words[2] ?? ""]
      if (script?.startsWith("vbz ")) {
        calls.push([...script.split(/\s+/).slice(1), ...words.slice(3)])
      }
    }
  }
  return calls.filter((call) => COMMANDS.some((row) => row.name === call[0]))
}

/** A placeholder such as `<port>`, given where a port is read. */
function filled(call: readonly string[]): string[] {
  return call.map((word, at) =>
    /^<.+>$/.test(word) && /^--(host|bundles-port)$/.test(call[at - 1] ?? "")
      ? "0"
      : word,
  )
}

describe("every call shown anywhere", () => {
  /**
   * Refusing a flag a command does not read is only right if nothing an
   * author was told to run gives one: the docs, the guide, both READMEs,
   * the game's own agent file and the template's scripts.
   */
  test("is one the parser takes", async () => {
    const scripts = await templateScripts()
    const calls: string[][] = Object.values(scripts)
      .filter((script) => script.startsWith("vbz "))
      .map((script) => script.split(/\s+/).slice(1))
    for (const file of PROSE) {
      calls.push(...callsIn(await readFile(file, "utf8"), scripts))
    }
    const references = join(OWN_ROOT, "skill", "vbz-game", "references")
    for (const name of await readdir(references)) {
      calls.push(
        ...callsIn(await readFile(join(references, name), "utf8"), scripts),
      )
    }
    // The walk sees the calls that matter, flags and all.
    const shown = calls.map((call) => call.join(" "))
    expect(shown).toContain("dev . --site")
    expect(shown.some((call) => call.includes("--addressed"))).toBe(true)
    expect(shown.some((call) => call.includes("--game"))).toBe(true)
    expect(shown.some((call) => call.includes("--ranked"))).toBe(true)
    for (const call of calls) {
      let refused = ""
      try {
        parseArgs(filled(call), COMMANDS)
      } catch (error) {
        refused = String(error)
      }
      expect({ call: call.join(" "), refused }).toEqual({
        call: call.join(" "),
        refused: "",
      })
    }
  })

  /**
   * The usage labels each flag with the commands that read it, as
   * `dev:` or `build --addressed:`, and leaves the entries unlabelled
   * because every command that builds reads them. The labels are prose, so
   * they are held to the table.
   */
  test("the usage labels each flag with the commands the table says read it", async () => {
    const usage = (await $`bun ${CLI}`.quiet().nothrow()).stdout.toString()
    const blocks = new Map<string, string>()
    let current: string | null = null
    for (const line of usage.split("\n")) {
      const flag = /^ {2}--([a-z-]+)/.exec(line)?.[1]
      if (flag !== undefined) {
        current = flag
        blocks.set(flag, line)
      } else if (line.trim() === "") current = null
      else if (current !== null) {
        blocks.set(current, `${blocks.get(current)} ${line}`)
      }
    }
    const names = COMMANDS.map((command) => command.name).join("|")
    const label = new RegExp(`(?:^|\\s)(${names})(?: --[a-z-]+)?:`, "g")
    for (const flag of [...VALUE_FLAGS, ...SWITCH_FLAGS]) {
      expect(usage).toContain(`--${flag}`)
      const block = blocks.get(flag)
      // --cert and --key are told of on --https's line, dev's.
      if (block === undefined) {
        expect(readers(flag)).toEqual(readers("https"))
        continue
      }
      const labelled = [
        ...new Set([...block.matchAll(label)].map((match) => `${match[1]}`)),
      ].sort()
      expect({ flag, readers: readers(flag).sort() }).toEqual({
        flag,
        readers: labelled.length === 0 ? ["build", "check", "dev"] : labelled,
      })
    }
  })
})
