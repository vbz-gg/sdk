/**
 * The agent guides a game carries, and `vbz guides`, which refreshes them.
 *
 * What matters is where each guide comes from. `vbz new` takes this
 * package's own and the engine's from beside it; `vbz guides` takes both from
 * the packages the game installed, so a game that upgraded gets the guides of
 * the versions it now runs, and a guide dropped from a newer release does not
 * linger. And a missing package or guide is an error that writes nothing.
 */

import { describe, expect, test } from "bun:test"
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"
import {
  ENGINE_GUIDE,
  GUIDES,
  type GuideSpec,
  guideIn,
  guideLines,
  guidesBesideKit,
  KIT_GUIDE,
  OWN_ROOT,
  packageRoot,
  refreshGuides,
  SKILLS_DIR,
} from "../../src/cli/guides.js"

async function scratch(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sdk-guides-"))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Installs a stand-in for `spec`'s package under `dir/node_modules`, at
 * `version`, shipping a guide made of `files` (none at all when null).
 */
async function install(
  dir: string,
  spec: GuideSpec,
  version: string,
  files: Record<string, string> | null,
): Promise<string> {
  const root = join(dir, "node_modules", ...spec.package.split("/"))
  await mkdir(root, { recursive: true })
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: spec.package, version }),
  )
  for (const [path, text] of Object.entries(files ?? {})) {
    const file = join(root, "skill", spec.name, path)
    await mkdir(join(file, ".."), { recursive: true })
    await writeFile(file, text)
  }
  return root
}

/** The files under a game's copy of a guide, sorted. */
async function copied(game: string, name: string): Promise<string[]> {
  const dir = join(game, SKILLS_DIR, name)
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort()
}

describe("where node would find a package", () => {
  test("in the directory's own node_modules, then in each one above it", async () => {
    await scratch(async (dir) => {
      const root = await install(dir, ENGINE_GUIDE, "0.8.0", null)
      const deep = join(dir, "a", "b", "c")
      await mkdir(deep, { recursive: true })
      expect(await packageRoot(ENGINE_GUIDE.package, deep)).toBe(root)
      expect(await packageRoot(ENGINE_GUIDE.package, dir)).toBe(root)
    })
  })

  test("never in node_modules/node_modules, as node never looks there", async () => {
    await scratch(async (dir) => {
      // A package nested where node does not look: inside a directory that
      // is itself called node_modules.
      const nested = join(dir, "node_modules")
      await install(nested, ENGINE_GUIDE, "0.8.0", null)
      expect(await packageRoot(ENGINE_GUIDE.package, nested)).toBeNull()
    })
  })

  test("nowhere, when no directory on the way holds it", async () => {
    await scratch(async (dir) => {
      expect(await packageRoot("@vbz-gg/not-a-package-5d1e", dir)).toBeNull()
    })
  })
})

describe("the guides' names", () => {
  /**
   * `vbz new` and `vbz guides` write the engine's guide under the name this
   * package knows it by. An engine that moved its guide to another folder
   * would be one whose guide nothing copies.
   */
  test("the engine's guide is in the folder the installed engine ships", async () => {
    const engine = await packageRoot(ENGINE_GUIDE.package, OWN_ROOT)
    if (engine === null) throw new Error("no engine beside this package")
    const { files } = JSON.parse(
      await readFile(join(engine, "package.json"), "utf8"),
    ) as { files: readonly string[] }
    expect(files.filter((entry) => entry.startsWith("skill"))).toEqual([
      `skill/${ENGINE_GUIDE.name}`,
    ])
    expect(await readdir(join(engine, "skill"))).toEqual([ENGINE_GUIDE.name])
  })

  test("this package ships its own guide in the folder it is written under", async () => {
    const { files } = JSON.parse(
      await readFile(join(OWN_ROOT, "package.json"), "utf8"),
    ) as { files: readonly string[] }
    expect(files.filter((entry) => entry.startsWith("skill"))).toEqual([
      `skill/${KIT_GUIDE.name}`,
    ])
  })

  /**
   * An agent's tools match a skill by the name it declares, and the folder a
   * game keeps it in is that name, so the two have to agree for both guides.
   */
  test("each guide declares the name it is installed under", async () => {
    for (const guide of await guidesBesideKit()) {
      const skill = await readFile(join(guide.source, "SKILL.md"), "utf8")
      const front = skill.split("---")[1] ?? ""
      expect(/^name: (.+)$/m.exec(front)?.[1]).toBe(guide.name)
    }
    expect(GUIDES.map((guide) => guide.name)).toEqual([
      KIT_GUIDE.name,
      ENGINE_GUIDE.name,
    ])
  })
})

describe("a guide in an installed package", () => {
  test("is the package's skill folder, with the package's version", async () => {
    await scratch(async (dir) => {
      const root = await install(dir, ENGINE_GUIDE, "0.8.3", {
        "SKILL.md": "---\nname: clockwork2\n---\n",
      })
      expect(await guideIn(ENGINE_GUIDE, root)).toEqual({
        name: ENGINE_GUIDE.name,
        package: ENGINE_GUIDE.package,
        version: "0.8.3",
        source: join(root, "skill", ENGINE_GUIDE.name),
      })
    })
  })

  test("is refused, by package and version, when the package ships none", async () => {
    await scratch(async (dir) => {
      const root = await install(dir, ENGINE_GUIDE, "0.7.0", {
        "references/inputs.md": "a folder with no SKILL.md is no guide",
      })
      let thrown: unknown = null
      try {
        await guideIn(ENGINE_GUIDE, root)
      } catch (error) {
        thrown = error
      }
      expect(String(thrown)).toContain("@clockwork2/engine 0.7.0 at ")
      expect(String(thrown)).toContain(
        "there is no skill/clockwork2/SKILL.md in it",
      )
    })
  })

  test("a package.json with no version still names the package", async () => {
    await scratch(async (dir) => {
      const root = join(dir, "engine")
      await mkdir(join(root, "skill", ENGINE_GUIDE.name), { recursive: true })
      await writeFile(join(root, "package.json"), "{}")
      await writeFile(join(root, "skill", ENGINE_GUIDE.name, "SKILL.md"), "")
      expect((await guideIn(ENGINE_GUIDE, root)).version).toBe("unknown")
    })
  })
})

describe("vbz guides", () => {
  const KIT_FILES = {
    "SKILL.md": "---\nname: vbz-game\n---\nthe game's own kit\n",
    "references/page.md": "page\n",
  }
  const ENGINE_FILES = {
    "SKILL.md": "---\nname: clockwork2\n---\nthe game's own engine\n",
    "references/inputs.md": "inputs\n",
  }

  /**
   * The game's packages answer, not the copy of this package that is
   * running: a game pinned to another release reads that release's guides.
   */
  test("copies both guides from the packages the game installed", async () => {
    await scratch(async (game) => {
      await install(game, KIT_GUIDE, "9.1.0", KIT_FILES)
      await install(game, ENGINE_GUIDE, "9.2.0", ENGINE_FILES)
      const guides = await refreshGuides(game)
      expect(guideLines(guides)).toEqual([
        `${join(SKILLS_DIR, "vbz-game")}  from @vbz-gg/sdk 9.1.0`,
        `${join(SKILLS_DIR, "clockwork2")}  from @clockwork2/engine 9.2.0`,
      ])
      expect(await copied(game, "vbz-game")).toEqual([
        "SKILL.md",
        "references/page.md",
      ])
      expect(
        await readFile(join(game, SKILLS_DIR, "vbz-game", "SKILL.md"), "utf8"),
      ).toContain("the game's own kit")
      expect(
        await readFile(
          join(game, SKILLS_DIR, "clockwork2", "SKILL.md"),
          "utf8",
        ),
      ).toContain("the game's own engine")
    })
  })

  /**
   * A guide that drops a reference in a newer release would otherwise leave
   * the old one beside the new SKILL.md, and an agent reads both.
   */
  test("removes a file the installed guide no longer has", async () => {
    await scratch(async (game) => {
      await install(game, KIT_GUIDE, "9.1.0", KIT_FILES)
      await install(game, ENGINE_GUIDE, "9.2.0", ENGINE_FILES)
      const stale = join(game, SKILLS_DIR, "clockwork2", "references")
      await mkdir(stale, { recursive: true })
      await writeFile(join(stale, "dropped.md"), "from an older engine\n")
      // A skill of the author's own, beside the two, is theirs.
      const own = join(game, SKILLS_DIR, "my-notes")
      await mkdir(own, { recursive: true })
      await writeFile(join(own, "SKILL.md"), "mine\n")

      await refreshGuides(game)
      expect(await copied(game, "clockwork2")).toEqual([
        "SKILL.md",
        "references/inputs.md",
      ])
      expect(await readFile(join(own, "SKILL.md"), "utf8")).toBe("mine\n")
    })
  })

  /**
   * Each missing piece is named, and nothing is written: a game left with
   * one fresh guide and one stale one describes two different releases.
   */
  test.each([
    [
      "the engine is not installed",
      "kit",
      null,
      /@clockwork2\/engine is not installed in /,
    ],
    [
      "the kit is not installed",
      null,
      "engine",
      /@vbz-gg\/sdk is not installed in /,
    ],
    [
      "the engine ships no guide",
      "kit",
      "bare",
      /@clockwork2\/engine 9\.2\.0 at .* ships no guide/,
    ],
  ] as const)(
    "%s: refused, and nothing is written",
    async (_, kit, engine, refusal) => {
      await scratch(async (game) => {
        if (kit !== null) await install(game, KIT_GUIDE, "9.1.0", KIT_FILES)
        if (engine !== null) {
          await install(
            game,
            ENGINE_GUIDE,
            "9.2.0",
            engine === "bare" ? null : ENGINE_FILES,
          )
        }
        // Without a node_modules above the scratch directory holding either
        // package, which is what makes the lookup's answer this game's.
        expect(await packageRoot(KIT_GUIDE.package, tmpdir())).toBeNull()
        expect(await packageRoot(ENGINE_GUIDE.package, tmpdir())).toBeNull()

        let thrown: unknown = null
        try {
          await refreshGuides(game)
        } catch (error) {
          thrown = error
        }
        expect(String(thrown)).toMatch(refusal)
        expect(
          await readdir(join(game, ".claude")).catch(() => null),
        ).toBeNull()
      })
    },
  )
})

describe("the command", () => {
  const CLI = join(OWN_ROOT, "src", "cli", "index.ts")

  test("prints each guide it wrote, and the version it came from", async () => {
    await scratch(async (game) => {
      await install(game, KIT_GUIDE, "9.1.0", { "SKILL.md": "kit\n" })
      await install(game, ENGINE_GUIDE, "9.2.0", { "SKILL.md": "engine\n" })
      const result = await $`bun ${CLI} guides ${game}`.quiet().nothrow()
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toBe(
        `${join(SKILLS_DIR, "vbz-game")}  from @vbz-gg/sdk 9.1.0\n` +
          `${join(SKILLS_DIR, "clockwork2")}  from @clockwork2/engine 9.2.0\n`,
      )
    })
  })

  test("exits 1 with one line naming what is missing", async () => {
    await scratch(async (game) => {
      await install(game, KIT_GUIDE, "9.1.0", { "SKILL.md": "kit\n" })
      const result = await $`bun ${CLI} guides ${game}`.quiet().nothrow()
      expect(result.exitCode).toBe(1)
      expect(result.stdout.toString()).toBe("")
      expect(result.stderr.toString()).toBe(
        `@clockwork2/engine is not installed in ${game}: no node_modules from ${game} up holds it, so there is no guide to copy from it.\n`,
      )
    })
  })
})
