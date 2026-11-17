import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  BUNDLER_COMMENTS,
  type CommittedFile,
  committedGuide,
  exportTargets,
  type Git,
  GUIDE,
  guideDifferences,
  missingBundlerComments,
  PUBLIC_PACKAGES,
  parseBatch,
  problemsWith,
  RUNTIME_FILES,
  type Shipped,
  unimportableSubpaths,
} from "./check-publishable"

function shipped(over: Partial<Shipped> = {}): Shipped {
  return {
    name: "@vbz-gg/sdk",
    version: "0.1.0",
    dependencies: {},
    bin: { vbz: "dist/cli/index.js" },
    files: [
      "package.json",
      "README.md",
      "dist/controls/index.js",
      "dist/cli/index.js",
      ...RUNTIME_FILES,
    ],
    imports: { problems: [], skipped: [] },
    bundlerComments: [],
    guide: [],
    ...over,
  }
}

describe("what a tarball would do to a consumer", () => {
  test("a good package has nothing to say about it", () => {
    expect(problemsWith(shipped())).toEqual([])
  })

  test("an unrewritten workspace range is caught", () => {
    // It reaches the registry verbatim, and that version is then
    // uninstallable by anyone, permanently.
    const problems = problemsWith(
      shipped({ dependencies: { "@vbz/thing": "workspace:*" } }),
    )
    expect(problems.join("\n")).toContain("no consumer can install")
  })

  test("a loadGame import that lost a bundler comment is caught", () => {
    const problems = problemsWith(
      shipped({ bundlerComments: ["/* webpackIgnore: true */"] }),
    )
    expect(problems.join("\n")).toContain("webpackIgnore")
    expect(problems.join("\n")).toContain(BUNDLER_COMMENTS.file)
  })

  test("a bundler comment counts only on the import itself", () => {
    const both = BUNDLER_COMMENTS.comments.join(" ")
    expect(missingBundlerComments(`return import(${both} url)`)).toEqual([])
    // tsc keeps the comments where the source wrote them, and a build that
    // moved one out of the call would tell a bundler nothing.
    expect(missingBundlerComments(`${both}\nreturn import(url)`)).toEqual([
      ...BUNDLER_COMMENTS.comments,
    ])
    expect(
      missingBundlerComments("return import(/* webpackIgnore: true */ url)"),
    ).toEqual(["/* @vite-ignore */"])
  })

  test("the built loadGame import carries both comments", async () => {
    const built = await Bun.file(
      join(import.meta.dir, "..", "packages", "sdk", BUNDLER_COMMENTS.file),
    ).text()
    expect(missingBundlerComments(built)).toEqual([])
  })

  test("a missing readme is caught, because npm drops it quietly", () => {
    const problems = problemsWith(shipped({ files: ["package.json"] }))
    expect(problems.join("\n")).toContain("no README.md")
  })

  test("packing without a build is caught", () => {
    const problems = problemsWith(
      shipped({ files: ["package.json", "README.md", "src/index.ts"] }),
    )
    expect(problems.join("\n")).toContain("no dist")
  })

  /**
   * The harness bundles its page script at start, from a path it builds off
   * `import.meta.dir`. Nothing that imports the package would notice its
   * absence: the failure arrives when somebody runs `vbz dev`.
   */
  test("a runtime file the package reads but never imports is caught", () => {
    const problems = problemsWith(
      shipped({
        files: ["package.json", "README.md", "dist/controls/index.js"],
      }),
    )
    expect(problems.join("\n")).toContain("main.js")
  })

  /**
   * npm 12 logs a rewritten command entry as removed, and 0.3.0 went out
   * with that line in its release log. Written the way npm publishes it,
   * the log says nothing.
   */
  /**
   * `vbz new` renames each of these on the way into a game. One the tarball
   * lacks is a game without its ignore file, or without the file that tells
   * an agent where the guides are, and nothing says so.
   */
  test("the template's files that a new game renames are held to shipping", () => {
    for (const file of [
      "templates/game/gitignore",
      "templates/game/game-agents.md",
      "templates/game/game-claude.md",
    ]) {
      expect(RUNTIME_FILES).toContain(file)
      const problems = problemsWith(
        shipped({ files: shipped().files.filter((f) => f !== file) }),
      )
      expect(problems).toEqual([
        `@vbz-gg/sdk would ship no ${file}, which it reads at runtime`,
      ])
    }
  })

  test("a command entry npm would rewrite at publish is caught", () => {
    const problems = problemsWith(
      shipped({ bin: { vbz: "./dist/cli/index.js" } }),
    )
    expect(problems).toEqual([
      '@vbz-gg/sdk names bin "vbz" as "./dist/cli/index.js", which npm rewrites at publish and reports as removed; write "dist/cli/index.js"',
    ])
  })

  test("a command whose file the tarball lacks is caught", () => {
    const problems = problemsWith(
      shipped({
        files: shipped().files.filter((f) => f !== "dist/cli/index.js"),
      }),
    )
    expect(problems.join("\n")).toContain('which the "vbz" command runs')
  })

  test("a subpath node cannot import is a problem", () => {
    const problems = problemsWith(
      shipped({
        imports: {
          problems: ['node cannot import "./controls": ...'],
          skipped: [],
        },
      }),
    )
    expect(problems.join("\n")).toContain("./controls")
  })

  test("a guide that differs from the committed one is a problem", () => {
    const problems = problemsWith(
      shipped({
        guide: [
          `${GUIDE}/SKILL.md in the tarball differs from the committed file`,
        ],
      }),
    )
    expect(problems.join("\n")).toContain(`${GUIDE}/SKILL.md`)
  })

  test("the checker names the package that is published", () => {
    expect(PUBLIC_PACKAGES).toEqual(["sdk"])
  })
})

describe("what plain node makes of the exports map", () => {
  test("every shape of exports entry resolves to its file", () => {
    expect(
      exportTargets({
        "./controls": { default: "./dist/controls/index.js" },
        "./package.json": "./package.json",
        "./types-only": {},
      }),
    ).toEqual([
      ["./controls", "./dist/controls/index.js"],
      ["./package.json", "./package.json"],
    ])
  })

  test("no exports map is no targets, rather than a throw", () => {
    expect(exportTargets(undefined)).toEqual([])
  })

  /**
   * The defect this exists for. `tsc` emits a relative import exactly as the
   * source wrote it, bun and every bundler resolve an extensionless one, and
   * node does not - so a package builds, typechecks, passes its suite and
   * fails on a consumer's first import.
   */
  test("an extensionless relative import is caught", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdk-importable-"))
    try {
      await mkdir(join(dir, "dist"), { recursive: true })
      await writeFile(join(dir, "dist", "helper.js"), "export const a = 1\n")
      await writeFile(
        join(dir, "dist", "good.js"),
        'export * from "./helper.js"\n',
      )
      await writeFile(join(dir, "dist", "bad.js"), 'export * from "./helper"\n')
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "probe",
          type: "module",
          exports: {
            "./good": { default: "./dist/good.js" },
            "./bad": { default: "./dist/bad.js" },
            // Data rather than a module: importing JSON needs an import
            // attribute the consumer supplies.
            "./package.json": "./package.json",
          },
        }),
      )

      const report = await unimportableSubpaths(dir)
      expect(report.skipped).toEqual([])
      expect(report.problems.length).toBe(1)
      expect(report.problems[0]).toContain('"./bad"')
      expect(report.problems[0]).toContain("Cannot find module")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  /**
   * A peer nobody installed here is not a finding about the package, and it
   * has to read differently from a relative path node cannot resolve.
   */
  test("a missing peer is reported as unchecked, not as broken", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdk-importable-peer-"))
    try {
      await mkdir(join(dir, "dist"), { recursive: true })
      await writeFile(
        join(dir, "dist", "uses-peer.js"),
        'import "not-a-real-package-91a3"\nexport const a = 1\n',
      )
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "probe",
          type: "module",
          exports: { "./uses-peer": { default: "./dist/uses-peer.js" } },
        }),
      )

      const report = await unimportableSubpaths(dir)
      expect(report.problems).toEqual([])
      expect(report.skipped.join("\n")).toContain("not-a-real-package-91a3")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

describe("the guide the tarball carries", () => {
  type Tree = Record<string, { text: string; executable?: boolean }>

  /** Writes a tree of files under `root`, at paths inside the package. */
  async function write(root: string, tree: Tree): Promise<string[]> {
    for (const [path, file] of Object.entries(tree)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), file.text)
      await chmod(join(root, path), file.executable === true ? 0o755 : 0o644)
    }
    return Object.keys(tree).sort()
  }

  const GOOD: Tree = {
    [`${GUIDE}/SKILL.md`]: { text: "---\nname: vbz-game\n---\n" },
    [`${GUIDE}/references/page.md`]: { text: "# The page\n" },
  }

  /** What git would hold for a tree, without a repository to hold it. */
  function asCommitted(tree: Tree): Map<string, CommittedFile> {
    return new Map(
      Object.entries(tree).map(([path, file]) => [
        path,
        {
          bytes: new TextEncoder().encode(file.text),
          executable: file.executable === true,
        },
      ]),
    )
  }

  /** Unpacks `inTarball` to a directory and compares it with `committed`. */
  async function compare(
    inTarball: Tree,
    committed: Tree = GOOD,
  ): Promise<string[]> {
    const dir = await mkdtemp(join(tmpdir(), "sdk-guide-"))
    try {
      const shipped = await write(dir, {
        "package.json": { text: "{}" },
        ...inTarball,
      })
      return guideDifferences(dir, shipped, asCommitted(committed))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test("the committed guide, packed whole, has nothing to say", async () => {
    expect(await compare(GOOD)).toEqual([])
  })

  test("a byte that differs is named, as an edit nobody committed is", async () => {
    // npm packs the working tree, so an uncommitted edit is what ships.
    const problems = await compare({
      ...GOOD,
      [`${GUIDE}/SKILL.md`]: { text: "---\nname: vbz-games\n---\n" },
    })
    expect(problems).toEqual([
      `${GUIDE}/SKILL.md in the tarball differs from the committed file`,
    ])
  })

  test("a committed file the tarball dropped is named", async () => {
    // npm drops a file an ignore rule matches, and says nothing about it.
    const problems = await compare({
      [`${GUIDE}/SKILL.md`]: { text: "---\nname: vbz-game\n---\n" },
    })
    expect(problems).toEqual([
      `${GUIDE}/references/page.md is committed and the tarball does not carry it`,
    ])
  })

  test("an untracked file is named, because npm packs the disk", async () => {
    // A scratch note left in the guide's folder ships, and `vbz new` would
    // then copy it into every game.
    const problems = await compare({
      ...GOOD,
      [`${GUIDE}/notes.txt`]: { text: "scratch" },
    })
    expect(problems).toEqual([
      `${GUIDE}/notes.txt is in the tarball and is not committed`,
    ])
  })

  test("the guide's tests shipping beside it are named", async () => {
    const problems = await compare({
      ...GOOD,
      "skill/tests/skill.test.ts": { text: "test()" },
    })
    expect(problems).toEqual([
      `skill/tests/skill.test.ts ships, and only ${GUIDE}/ belongs under skill/`,
    ])
  })

  test("a file whose execute bit moved is named", async () => {
    // `vbz new` copies the guide with the modes it shipped with, so a mode
    // the tarball changed is a mode every new game gets.
    const committed: Tree = {
      ...GOOD,
      [`${GUIDE}/scripts/run.sh`]: { text: "#!/bin/sh\n", executable: true },
    }
    const problems = await compare(
      { ...GOOD, [`${GUIDE}/scripts/run.sh`]: { text: "#!/bin/sh\n" } },
      committed,
    )
    expect(problems).toEqual([
      `${GUIDE}/scripts/run.sh is executable when committed and not in the tarball`,
    ])
  })

  test("no committed guide at all is a problem, not a pass", async () => {
    // A listing that came back empty would otherwise compare nothing against
    // nothing and agree.
    const problems = await compare({}, {})
    expect(problems).toEqual([
      `no committed files under ${GUIDE}/ to compare with`,
    ])
  })

  /**
   * One process for the listing and one for every blob, however many files
   * the guide holds. A process per file grows with the guide and costs a
   * fork on every check.
   */
  test("the committed guide is read with two git processes, whatever its size", async () => {
    const calls: string[] = []
    const counting: Git = async (cwd, args, input) => {
      calls.push(args.slice(0, 2).join(" "))
      const child = Bun.spawn(["git", ...args], {
        cwd,
        stdin: input ?? "ignore",
        stdout: "pipe",
      })
      const out = new Uint8Array(await new Response(child.stdout).arrayBuffer())
      await child.exited
      return out
    }
    const committed = await committedGuide(
      join(import.meta.dir, "..", "packages", "sdk"),
      counting,
    )
    expect(committed.size).toBeGreaterThan(3)
    expect(calls).toEqual(["ls-files -s", "cat-file --batch"])
  })

  test("a batch answer is split by the size each header gives", () => {
    // A blob may hold newlines, and the last byte of one is followed by the
    // newline git adds, so the sizes decide where one ends.
    const encode = (text: string) => new TextEncoder().encode(text)
    const out = encode("aaa blob 6\nab\ncd\n\nbbb blob 0\n\nccc blob 2\n\n\n\n")
    const blobs = parseBatch(out, ["aaa", "bbb", "ccc"])
    expect(blobs.map((blob) => new TextDecoder().decode(blob))).toEqual([
      "ab\ncd\n",
      "",
      "\n\n",
    ])
  })

  test("a batch answer that does not hold every object asked for is refused", () => {
    const encode = (text: string) => new TextEncoder().encode(text)
    expect(() => parseBatch(encode("aaa missing\n"), ["aaa"])).toThrow(
      "git cat-file has no blob aaa",
    )
    expect(() => parseBatch(encode("aaa blob 9\nshort\n"), ["aaa"])).toThrow(
      "git cat-file's answer for aaa is cut short",
    )
    expect(() => parseBatch(encode("aaa blob 1\nx\n"), ["aaa", "bbb"])).toThrow(
      "git cat-file has no blob bbb",
    )
  })

  test("the package's committed guide is read as git holds it", async () => {
    // The listing is what the comparison trusts for "committed": paths inside
    // the package, under the guide and not its tests, with git's bytes and
    // git's mode for each.
    const committed = await committedGuide(
      join(import.meta.dir, "..", "packages", "sdk"),
    )
    const paths = [...committed.keys()]
    expect(paths).toContain(`${GUIDE}/SKILL.md`)
    expect(paths).toContain(`${GUIDE}/references/page.md`)
    expect(paths.every((path) => path.startsWith(`${GUIDE}/`))).toBe(true)
    expect(committed.get(`${GUIDE}/SKILL.md`)?.executable).toBe(false)
    const skill = committed.get(`${GUIDE}/SKILL.md`)?.bytes ?? new Uint8Array()
    expect(new TextDecoder().decode(skill)).toStartWith("---\nname: ")
  })
})
