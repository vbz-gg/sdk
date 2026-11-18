/**
 * The command table: what the dispatcher finds a command by, what the usage
 * lists, and what the agent guide's test reads, in one place.
 */

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { $ } from "bun"
import { type Command, usageText } from "../../src/cli/commands.js"
import { GUIDES, OWN_ROOT, SKILLS_DIR } from "../../src/cli/guides.js"
import { COMMANDS } from "../../src/cli/index.js"

const CLI = join(OWN_ROOT, "src", "cli", "index.ts")

function row(name: string, summary: readonly string[]): Command {
  return { name, args: "[dir]", summary, run: async () => 0 }
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
