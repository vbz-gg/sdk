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
  guidesBesideSdk,
  installGuides,
  OWN_ROOT,
  packageRoot,
  refreshGuides,
  SDK_GUIDE,
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

/** Makes `dir` a game's root: a package.json that names the SDK. */
async function asGame(
  dir: string,
  dependencies: Record<string, string> = { "@vbz-gg/sdk": "^9.1.0" },
): Promise<string> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "game", devDependencies: dependencies }),
  )
  return dir
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
      `skill/${SDK_GUIDE.name}`,
    ])
  })

  /**
   * An agent's tools match a skill by the name it declares, and the folder a
   * game keeps it in is that name, so the two have to agree for both guides.
   */
  test("each guide declares the name it is installed under", async () => {
    for (const guide of await guidesBesideSdk()) {
      const skill = await readFile(join(guide.source, "SKILL.md"), "utf8")
      const front = skill.split("---")[1] ?? ""
      expect(/^name: (.+)$/m.exec(front)?.[1]).toBe(guide.name)
    }
    expect(GUIDES.map((guide) => guide.name)).toEqual([
      SDK_GUIDE.name,
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

  test("is refused, naming the file, when its package.json has no version", async () => {
    // The version is what a game's guides are said to come from, so a
    // package that cannot say which release it is has no guide to trust.
    await scratch(async (dir) => {
      const root = join(dir, "engine")
      await mkdir(join(root, "skill", ENGINE_GUIDE.name), { recursive: true })
      await writeFile(join(root, "package.json"), "{}")
      await writeFile(join(root, "skill", ENGINE_GUIDE.name, "SKILL.md"), "")
      let thrown: unknown = null
      try {
        await guideIn(ENGINE_GUIDE, root)
      } catch (error) {
        thrown = error
      }
      expect(String(thrown)).toContain(
        `${join(root, "package.json")} has no version`,
      )
    })
  })
})

describe("vbz guides", () => {
  const SDK_FILES = {
    "SKILL.md": "---\nname: vbz-game\n---\nthe game's own SDK\n",
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
      await asGame(game)
      await install(game, SDK_GUIDE, "9.1.0", SDK_FILES)
      await install(game, ENGINE_GUIDE, "9.2.0", ENGINE_FILES)
      const guides = await refreshGuides(game)
      // Printed with forward slashes on every platform: it is a path a
      // reader types or matches, not one this process opens.
      expect(guideLines(guides)).toEqual([
        ".claude/skills/vbz-game  from @vbz-gg/sdk 9.1.0",
        ".claude/skills/clockwork2  from @clockwork2/engine 9.2.0",
      ])
      expect(await copied(game, "vbz-game")).toEqual([
        "SKILL.md",
        "references/page.md",
      ])
      expect(
        await readFile(join(game, SKILLS_DIR, "vbz-game", "SKILL.md"), "utf8"),
      ).toContain("the game's own SDK")
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
      await asGame(game)
      await install(game, SDK_GUIDE, "9.1.0", SDK_FILES)
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
      "sdk",
      null,
      /@clockwork2\/engine is not installed in /,
    ],
    [
      "the SDK is not installed",
      null,
      "engine",
      /@vbz-gg\/sdk is not installed in /,
    ],
    [
      "the engine ships no guide",
      "sdk",
      "bare",
      /@clockwork2\/engine 9\.2\.0 at .* ships no guide/,
    ],
  ] as const)(
    "%s: refused, and nothing is written",
    async (_, sdk, engine, refusal) => {
      await scratch(async (game) => {
        await asGame(game)
        if (sdk !== null) await install(game, SDK_GUIDE, "9.1.0", SDK_FILES)
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
        expect(await packageRoot(SDK_GUIDE.package, tmpdir())).toBeNull()
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
  /**
   * `dir` is where the guides are written, so a directory that is not a
   * game's root, or not there at all, is refused before anything is found or
   * made. Without the check, a mistyped path inside a game found the game's
   * packages from the directory above and made the mistyped directory to
   * hold the guides.
   */
  test.each([
    [
      "is not there",
      null,
      /\/missing is not a game's root: it has no package\.json/,
    ],
    [
      "has no package.json",
      "none",
      /\/missing is not a game's root: it has no package\.json/,
    ],
    [
      "has a package.json that does not name the SDK",
      { "@clockwork2/engine": "0.8.0" },
      /\/missing is not a game's root: its package\.json names no @vbz-gg\/sdk in dependencies or devDependencies/,
    ],
  ] as const)(
    "a directory that %s is refused, and not made",
    async (_, root, refusal) => {
      await scratch(async (parent) => {
        // The packages are installed above it, where node's lookup from the
        // directory would find them.
        await install(parent, SDK_GUIDE, "9.1.0", SDK_FILES)
        await install(parent, ENGINE_GUIDE, "9.2.0", ENGINE_FILES)
        const dir = join(parent, "missing")
        if (root === "none") await mkdir(dir)
        else if (root !== null) await asGame(dir, root)

        let thrown: unknown = null
        try {
          await refreshGuides(dir)
        } catch (error) {
          thrown = error
        }
        expect(String(thrown)).toMatch(refusal)
        const left = await readdir(dir).catch(() => null)
        expect(left === null ? null : left.sort()).toEqual(
          root === null ? null : root === "none" ? [] : ["package.json"],
        )
      })
    },
  )

  test("a package.json it cannot read is that error, not a missing root", async () => {
    await scratch(async (game) => {
      await mkdir(join(game, "package.json"), { recursive: true })
      let thrown: unknown = null
      try {
        await refreshGuides(game)
      } catch (error) {
        thrown = error
      }
      expect((thrown as { code?: unknown } | null)?.code).toBe("EISDIR")
    })
  })

  test("a dependency in dependencies names the SDK as well as one in devDependencies", async () => {
    await scratch(async (game) => {
      await mkdir(game, { recursive: true })
      await writeFile(
        join(game, "package.json"),
        JSON.stringify({ dependencies: { "@vbz-gg/sdk": "^9.1.0" } }),
      )
      await install(game, SDK_GUIDE, "9.1.0", SDK_FILES)
      await install(game, ENGINE_GUIDE, "9.2.0", ENGINE_FILES)
      expect((await refreshGuides(game)).length).toBe(2)
    })
  })

  /**
   * Both guides are copied before either replaces what the game has. A copy
   * that fails part-way, through a full disk or a file it cannot read, would
   * otherwise leave the SDK's guide from one release beside the engine's
   * from another, and an agent follows both.
   */
  test("a copy that fails leaves the guides the game had, and nothing else", async () => {
    await scratch(async (game) => {
      await asGame(game)
      await install(game, SDK_GUIDE, "9.1.0", SDK_FILES)
      await install(game, ENGINE_GUIDE, "9.2.0", ENGINE_FILES)
      await refreshGuides(game)
      const before = {
        sdk: await copied(game, "vbz-game"),
        engine: await copied(game, "clockwork2"),
      }
      const newer = await guideIn(
        SDK_GUIDE,
        await install(join(game, "newer"), SDK_GUIDE, "9.3.0", {
          "SKILL.md": "newer\n",
        }),
      )
      const broken = {
        ...newer,
        name: ENGINE_GUIDE.name,
        source: join(game, "no-such-guide"),
      }

      let thrown: unknown = null
      try {
        await installGuides(game, [newer, broken])
      } catch (error) {
        thrown = error
      }
      expect(thrown).not.toBeNull()
      expect(await copied(game, "vbz-game")).toEqual(before.sdk)
      expect(
        await readFile(join(game, SKILLS_DIR, "vbz-game", "SKILL.md"), "utf8"),
      ).toContain("the game's own SDK")
      expect(await copied(game, "clockwork2")).toEqual(before.engine)
      // No temporary folder left beside them.
      expect((await readdir(join(game, SKILLS_DIR))).sort()).toEqual([
        "clockwork2",
        "vbz-game",
      ])
    })
  })
})

describe("the command", () => {
  const CLI = join(OWN_ROOT, "src", "cli", "index.ts")

  test("prints each guide it wrote, and the version it came from", async () => {
    await scratch(async (game) => {
      await asGame(game)
      await install(game, SDK_GUIDE, "9.1.0", { "SKILL.md": "sdk\n" })
      await install(game, ENGINE_GUIDE, "9.2.0", { "SKILL.md": "engine\n" })
      const result = await $`bun ${CLI} guides ${game}`.quiet().nothrow()
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toBe(
        ".claude/skills/vbz-game  from @vbz-gg/sdk 9.1.0\n" +
          ".claude/skills/clockwork2  from @clockwork2/engine 9.2.0\n",
      )
    })
  })

  test("exits 1 with one line naming what is missing", async () => {
    await scratch(async (game) => {
      await asGame(game)
      await install(game, SDK_GUIDE, "9.1.0", { "SKILL.md": "sdk\n" })
      const result = await $`bun ${CLI} guides ${game}`.quiet().nothrow()
      expect(result.exitCode).toBe(1)
      expect(result.stdout.toString()).toBe("")
      expect(result.stderr.toString()).toBe(
        `@clockwork2/engine is not installed in ${game}: no node_modules from ${game} up holds it, so there is no guide to copy from it.\n`,
      )
    })
  })
})
