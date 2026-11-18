/**
 * `vbz new`, which is how an author starts.
 *
 * What matters is that the copy is a game rather than a template with
 * somebody else's name on it: the game's id is settled at copy time, because
 * on vbz.gg it is immutable once published, and the copy builds before a
 * line of it is changed.
 */

import { describe, expect, test } from "bun:test"
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { buildGameArtifacts } from "../../src/build/index.js"
import {
  ENGINE_GUIDE,
  guidesBesideKit,
  KIT_GUIDE,
  OWN_ROOT,
  packageRoot,
  SKILLS_DIR,
} from "../../src/cli/guides.js"
import {
  createGame,
  gameIdFrom,
  isCopied,
  RENAMED_IN_GAME,
  renamed,
  TEMPLATE_DIR,
  TEMPLATE_ID,
  TEMPLATE_TITLE,
  titleFrom,
  versionsFor,
} from "../../src/cli/new.js"

const VERSIONS = { sdk: "^9.9.9", engine: ">=9.0.0 <10.0.0" }

/**
 * Writes the files a template stores under one name and a game gets under
 * another, so a stand-in template is one `vbz new` can make a game from.
 */
async function withRenamedFiles(template: string): Promise<void> {
  for (const stored of Object.keys(RENAMED_IN_GAME)) {
    await writeFile(join(template, stored), `${stored}\n`)
  }
}

async function into(
  name: string,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), "sdk-new-"))
  try {
    await run(join(parent, name))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
}

describe("the id a game is published under", () => {
  test.each([
    ["my-game", "my-game"],
    ["My Game", "my-game"],
    ["  Tiki  Kong  ", "tiki-kong"],
    ["snakes_on_a_chain", "snakes-on-a-chain"],
    ["---", "game"],
    ["", "game"],
  ])("%s becomes %s", (name, id) => {
    expect(gameIdFrom(name)).toBe(id)
  })

  test("a title reads as one, from an id nobody wrote by hand", () => {
    expect(titleFrom("tiki-kong")).toBe("Tiki Kong")
    expect(titleFrom("game")).toBe("Game")
  })
})

describe("renaming the template", () => {
  test("every occurrence goes, not the first", () => {
    const before = `${TEMPLATE_ID} and ${TEMPLATE_ID}, called ${TEMPLATE_TITLE}`
    expect(renamed(before, "tiki-kong", "Tiki Kong")).toBe(
      "tiki-kong and tiki-kong, called Tiki Kong",
    )
  })

  /**
   * The class in `src/sim/game.ts` is `LaneRunner` with no space, so the
   * title substitution cannot reach it. If it could, a copy would be a game
   * whose simulation no longer compiles.
   */
  test("an identifier is not a title", () => {
    expect(renamed("class LaneRunner {}", "tiki-kong", "Tiki Kong")).toBe(
      "class LaneRunner {}",
    )
  })
})

describe("what a copy is", () => {
  test("it takes its id and title from the directory", async () => {
    await into("tiki-kong", async (dir) => {
      const made = await createGame({ dir, versions: VERSIONS })
      expect(made.id).toBe("tiki-kong")
      expect(made.title).toBe("Tiki Kong")

      const manifest = await readFile(join(dir, "src/sim/manifest.ts"), "utf8")
      expect(manifest).toContain('id: "tiki-kong"')
      expect(manifest).toContain('name: "Tiki Kong"')
      expect(manifest).not.toContain(TEMPLATE_ID)
    })
  }, 30_000)

  test("it asks for the versions of the copy that made it", async () => {
    await into("probe", async (dir) => {
      await createGame({ dir, versions: VERSIONS })
      const pkg = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8"),
      ) as { name: string; devDependencies: Record<string, string> }
      expect(pkg.name).toBe("probe")
      expect(pkg.devDependencies["@vbz-gg/sdk"]).toBe(VERSIONS.sdk)
      expect(pkg.devDependencies["@clockwork2/engine"]).toBe(VERSIONS.engine)
    })
  }, 30_000)

  /**
   * A build in the template would copy one game's artifacts into another and
   * call them its own, and the hashes would name a simulation nobody here
   * built.
   */
  test("a build left in the template is not copied", async () => {
    const source = await mkdtemp(join(tmpdir(), "sdk-template-"))
    try {
      await mkdir(join(source, "dist"), { recursive: true })
      await writeFile(join(source, "dist", "sim.js"), "// somebody else's\n")
      await writeFile(join(source, "package.json"), '{"name":"lane-runner"}\n')
      await withRenamedFiles(source)
      await into("copied", async (dir) => {
        await createGame({ dir, template: source, versions: VERSIONS })
        expect(
          await readFile(join(dir, "dist", "sim.js"), "utf8").catch(() => null),
        ).toBeNull()
      })
    } finally {
      await rm(source, { recursive: true, force: true })
    }
  }, 30_000)

  /**
   * The bug 0.1.0 shipped with, and the layout that hid it.
   *
   * The filter tested the absolute source path for `/node_modules`, so every
   * file of a package installed under `node_modules` was rejected and
   * `vbz new` made an empty directory. It passed here and against a
   * hand-unpacked tarball, because neither of those paths has `node_modules`
   * in it, and a hand-unpacked tarball is the one layout an author never has.
   */
  test("a template under node_modules is still copied", async () => {
    const parent = await mkdtemp(join(tmpdir(), "sdk-installed-"))
    try {
      const source = join(
        parent,
        "node_modules",
        "@vbz-gg",
        "sdk",
        "templates",
        "game",
      )
      await mkdir(join(source, "src", "sim"), { recursive: true })
      await writeFile(join(source, "package.json"), '{"name":"lane-runner"}\n')
      await writeFile(
        join(source, "src", "sim", "manifest.ts"),
        'id: "lane-runner"\n',
      )
      await withRenamedFiles(source)

      await into("installed-copy", async (dir) => {
        await createGame({ dir, template: source, versions: VERSIONS })
        const copied = JSON.parse(
          await readFile(join(dir, "package.json"), "utf8"),
        ) as { name: string }
        expect(copied.name).toBe("installed-copy")
        expect(
          await readFile(join(dir, "src/sim/manifest.ts"), "utf8"),
        ).toContain("installed-copy")
      })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  }, 30_000)

  /**
   * npm renames a `.gitignore` to `.npmignore` inside a tarball, so the
   * template carries one under a name npm leaves alone. Without the rename
   * every game made from an installed copy starts out committing its build.
   */
  test("the ignore file arrives under the name git reads", async () => {
    await into("ignored", async (dir) => {
      await createGame({ dir, versions: VERSIONS })
      expect(
        await readFile(join(dir, ".gitignore"), "utf8").catch(() => null),
      ).toContain("dist")
      expect(
        await readFile(join(dir, "gitignore"), "utf8").catch(() => null),
      ).toBeNull()
    })
  }, 30_000)

  /**
   * Under their own names in the template, `AGENTS.md` and `CLAUDE.md` would
   * steer an agent working on this package as if it were working on a game.
   * So would any name that differs from them only by case: macOS and Windows
   * open `agents.md` for `AGENTS.md` on their default filesystems. The
   * template keeps them under names that differ by more than case, and a new
   * game gets them under the names an agent's tools read.
   */
  test("the agent's files arrive under the names an agent reads", async () => {
    expect(RENAMED_IN_GAME).toEqual({
      gitignore: ".gitignore",
      "game-agents.md": "AGENTS.md",
      "game-claude.md": "CLAUDE.md",
    })
    for (const stored of Object.keys(RENAMED_IN_GAME)) {
      expect((await stat(join(TEMPLATE_DIR, stored))).isFile()).toBe(true)
    }
    // Nothing anywhere in the template under a name a tool reads, in any
    // case, since an agent working in a subfolder reads its file too.
    const read = new Set(["agents.md", "claude.md"])
    const inTemplate = await readdir(TEMPLATE_DIR, { recursive: true })
    expect(
      inTemplate.filter((path) =>
        read.has((path.split(/[\\/]/).at(-1) ?? "").toLowerCase()),
      ),
    ).toEqual([])

    await into("tiki-kong", async (dir) => {
      await createGame({ dir, versions: VERSIONS })
      const files = await readdir(dir)
      expect(files).toContain("AGENTS.md")
      expect(files).toContain("CLAUDE.md")
      for (const stored of Object.keys(RENAMED_IN_GAME)) {
        expect(files).not.toContain(stored)
      }
      expect(await readFile(join(dir, "CLAUDE.md"), "utf8")).toBe(
        "@AGENTS.md\n",
      )
      // The game's own name, and the two guides' paths.
      const agents = await readFile(join(dir, "AGENTS.md"), "utf8")
      expect(agents).toStartWith("# Tiki Kong\n")
      expect(agents).not.toContain(TEMPLATE_TITLE)
      for (const guide of [KIT_GUIDE, ENGINE_GUIDE]) {
        expect(agents).toContain(`${SKILLS_DIR}/${guide.name}/SKILL.md`)
      }
      expect(agents).toContain("vbz guides")
    })
  }, 30_000)

  /**
   * The game's `AGENTS.md` is what an agent that loads no skills reads first,
   * so the one rule it states has to be the engine's whole rule. Leaving out
   * the data packs, or the three engines, states a weaker rule than the one
   * the replay holds a game to.
   */
  test("the game's AGENTS.md states the engine's one rule in full", async () => {
    const text = (
      await readFile(join(TEMPLATE_DIR, "game-agents.md"), "utf8")
    ).replace(/\s+/g, " ")
    expect(text).toContain(
      "must be a pure function of its seed, its config, its input log and the data packs its manifest pins, and must produce the same bits on V8, JavaScriptCore and SpiderMonkey.",
    )
  })

  /**
   * check:publishable holds the shipped template to carrying each file it
   * renames, so one missing is an install somebody trimmed or a copy that
   * failed. It is named, and no game is left behind half-made.
   */
  test("a template missing a file it renames is a broken install, named", async () => {
    const source = await mkdtemp(join(tmpdir(), "sdk-template-"))
    try {
      await writeFile(join(source, "package.json"), '{"name":"lane-runner"}\n')
      await withRenamedFiles(source)
      await rm(join(source, "game-agents.md"))
      await into("broken", async (dir) => {
        let thrown: unknown = null
        try {
          await createGame({ dir, template: source, versions: VERSIONS })
        } catch (error) {
          thrown = error
        }
        expect(String(thrown)).toContain(
          `the template at ${source} has no game-agents.md, which a new game gets as AGENTS.md`,
        )
        expect(await readdir(dir).catch(() => null)).toBeNull()
      })
    } finally {
      await rm(source, { recursive: true, force: true })
    }
  }, 30_000)

  /** A rename that fails for any other reason fails `vbz new` with it. */
  test("a rename that fails for another reason is not swallowed", async () => {
    const source = await mkdtemp(join(tmpdir(), "sdk-template-"))
    try {
      await writeFile(join(source, "package.json"), '{"name":"lane-runner"}\n')
      await withRenamedFiles(source)
      // A folder where the ignore file is going: a file cannot be renamed
      // over it.
      await mkdir(join(source, ".gitignore"))
      await writeFile(join(source, ".gitignore", "keep"), "\n")
      await into("clash", async (dir) => {
        let thrown: unknown = null
        try {
          await createGame({ dir, template: source, versions: VERSIONS })
        } catch (error) {
          thrown = error
        }
        expect((thrown as { code?: unknown } | null)?.code).toBe("EISDIR")
        expect(await readdir(dir).catch(() => null)).toBeNull()
      })
    } finally {
      await rm(source, { recursive: true, force: true })
    }
  }, 30_000)

  /**
   * A guide whose copy fails part-way leaves no game: a game without the
   * guides `AGENTS.md` points at is one an agent works on blind. A directory
   * that was there, empty, is left there and empty.
   */
  test("a guide that cannot be copied leaves no half-made game", async () => {
    const broken = async () => [
      ...(await guidesBesideKit()).slice(0, 1),
      {
        name: ENGINE_GUIDE.name,
        package: ENGINE_GUIDE.package,
        version: "0.8.0",
        source: join(tmpdir(), "sdk-no-such-guide"),
      },
    ]
    for (const madeFirst of [false, true]) {
      await into("half", async (dir) => {
        if (madeFirst) await mkdir(dir)
        let thrown: unknown = null
        try {
          await createGame({ dir, versions: VERSIONS, guides: broken })
        } catch (error) {
          thrown = error
        }
        expect((thrown as { code?: unknown } | null)?.code).toBe("ENOENT")
        expect(await readdir(dir).catch(() => null)).toEqual(
          madeFirst ? [] : null,
        )
      })
    }
  }, 30_000)

  /**
   * The kit's guide from this package and the engine's from the engine
   * installed beside it, byte for byte, so the guide an agent reads is the
   * one for the versions that made the game.
   */
  test("it carries both guides, as their packages ship them", async () => {
    await into("guided", async (dir) => {
      const made = await createGame({ dir, versions: VERSIONS })
      expect(made.guides.map((guide) => guide.name)).toEqual([
        KIT_GUIDE.name,
        ENGINE_GUIDE.name,
      ])
      const engine = await packageRoot(ENGINE_GUIDE.package, OWN_ROOT)
      if (engine === null) throw new Error("no engine beside this package")
      const sources = {
        [KIT_GUIDE.name]: join(OWN_ROOT, "skill", KIT_GUIDE.name),
        [ENGINE_GUIDE.name]: join(engine, "skill", ENGINE_GUIDE.name),
      }
      for (const [name, source] of Object.entries(sources)) {
        const shipped = (await readdir(source, { recursive: true })).sort()
        const copied = (
          await readdir(join(dir, SKILLS_DIR, name), { recursive: true })
        ).sort()
        expect(copied).toEqual(shipped)
        expect(shipped).toContain("SKILL.md")
        expect(await readFile(join(dir, SKILLS_DIR, name, "SKILL.md"))).toEqual(
          await readFile(join(source, "SKILL.md")),
        )
      }
      // The engine guide's commands run its scripts directly, so a copy
      // without the execute bit is a command that fails in the new game.
      const script = await stat(
        join(dir, SKILLS_DIR, ENGINE_GUIDE.name, "scripts", "validate.sh"),
      )
      expect(script.mode & 0o111).not.toBe(0)
    })
  }, 30_000)

  /**
   * The engine is a peer, so an install can lack it, and a release from
   * before the engine shipped its guide has none. Either is refused before
   * the directory is made: a game without the engine's guide is one whose
   * agent writes a simulation from nothing.
   */
  test("an engine that is missing, or ships no guide, stops it before anything is written", async () => {
    const nowhere = await mkdtemp(join(tmpdir(), "sdk-no-engine-"))
    const old = await mkdtemp(join(tmpdir(), "sdk-old-engine-"))
    try {
      const engine = join(old, "node_modules", "@clockwork2", "engine")
      await mkdir(engine, { recursive: true })
      await writeFile(
        join(engine, "package.json"),
        '{"name":"@clockwork2/engine","version":"0.7.0"}',
      )
      const cases = [
        [nowhere, /@clockwork2\/engine is not installed beside @vbz-gg\/sdk/],
        [old, /@clockwork2\/engine 0\.7\.0 .* ships no guide/],
      ] as const
      for (const [from, refusal] of cases) {
        await into("refused", async (dir) => {
          let thrown: unknown = null
          try {
            await createGame({
              dir,
              versions: VERSIONS,
              guides: () => guidesBesideKit(OWN_ROOT, from),
            })
          } catch (error) {
            thrown = error
          }
          expect(String(thrown)).toMatch(refusal)
          expect(await readdir(dir).catch(() => null)).toBeNull()
        })
      }
    } finally {
      await rm(nowhere, { recursive: true, force: true })
      await rm(old, { recursive: true, force: true })
    }
  })

  /** Merging into somebody's directory is worse than refusing to start. */
  test("a directory with anything in it is refused", async () => {
    await into("occupied", async (dir) => {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "notes.md"), "mine\n")
      await expect(createGame({ dir, versions: VERSIONS })).rejects.toThrow(
        /not empty/,
      )
      // And nothing of the template reached it.
      expect(
        await readFile(join(dir, "package.json"), "utf8").catch(() => null),
      ).toBeNull()
    })
  })

  test("an empty directory that already exists is fine", async () => {
    await into("made-first", async (dir) => {
      await mkdir(dir, { recursive: true })
      const made = await createGame({ dir, versions: VERSIONS })
      expect(made.id).toBe("made-first")
    })
  }, 30_000)

  /**
   * The point of starting from a template: it builds before anything is
   * changed, so the first failure an author sees is one they caused.
   */
  test("the copy builds into the two artifacts", async () => {
    await into("fresh-game", async (dir) => {
      await createGame({ dir, versions: VERSIONS })
      // An author runs `bun install` first; a temp directory has no node
      // modules above it, so the engine is linked in rather than installed.
      await symlink(resolve("node_modules"), join(dir, "node_modules"))
      const { sim, present } = await buildGameArtifacts({
        root: dir,
        simEntry: "src/sim/index.ts",
        presentEntry: "src/present.ts",
        captureEntry: "src/capture.ts",
        filesDir: null,
      })
      expect(sim.byteLength).toBeGreaterThan(1000)
      expect(present.byteLength).toBeGreaterThan(sim.byteLength)
      // The renamed id travelled into the built simulation rather than
      // staying a string in a file nobody reads.
      expect(new TextDecoder().decode(sim)).toContain("fresh-game")
    })
  }, 120_000)
})

describe("what a copy leaves behind", () => {
  const TEMPLATE = join(
    "any",
    "where",
    "node_modules",
    "pkg",
    "templates",
    "game",
  )

  test("a build or an install inside the template is skipped", () => {
    expect(isCopied(TEMPLATE, join(TEMPLATE, "dist", "sim.js"))).toBe(false)
    expect(
      isCopied(TEMPLATE, join(TEMPLATE, "node_modules", "x", "y.js")),
    ).toBe(false)
  })

  test("the template's own place in the tree decides nothing", () => {
    // Every path above the template holds `node_modules` here, and none of it
    // is the template's business.
    expect(isCopied(TEMPLATE, join(TEMPLATE, "package.json"))).toBe(true)
    expect(isCopied(TEMPLATE, join(TEMPLATE, "src", "sim", "index.ts"))).toBe(
      true,
    )
  })

  test("a name that merely starts with a skipped one is kept", () => {
    expect(isCopied(TEMPLATE, join(TEMPLATE, "distance.ts"))).toBe(true)
    expect(isCopied(TEMPLATE, join(TEMPLATE, "src", "distances", "a.ts"))).toBe(
      true,
    )
  })
})

describe("the versions a new game asks for", () => {
  test("they are this package's own", async () => {
    const versions = await versionsFor()
    expect(versions.sdk).toMatch(/^\^\d+\.\d+\.\d+/)
    expect(versions.engine).toContain("0.")
  })

  test("a manifest with neither still produces something installable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdk-versions-"))
    try {
      const path = join(dir, "package.json")
      await writeFile(path, "{}")
      expect(await versionsFor(path)).toEqual({
        sdk: "^0.1.0",
        engine: "*",
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("where the template lives", () => {
  /**
   * The path is built off `import.meta.dir`, and it has to land in the same
   * place from `src/cli` and from `dist/cli`, or `vbz new` works here
   * and nowhere else.
   */
  test("it is inside the package, at one relative path", async () => {
    const manifest = await readFile(join(TEMPLATE_DIR, "package.json"), "utf8")
    expect(manifest).toContain(TEMPLATE_ID)
    expect(TEMPLATE_DIR).toContain(join("templates", "game"))
  })
})
