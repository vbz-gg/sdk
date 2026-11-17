#!/usr/bin/env bun
/**
 * Packs the package and reads what a consumer would actually get.
 *
 * Everything this checks is invisible to a build, a lint and the test suite,
 * because all three run inside a workspace where everything already resolves.
 * A `workspace:` range would reach the registry verbatim and make a version
 * uninstallable by anyone, permanently, since nothing can be unpublished after
 * 72 hours. A missing `dist` ships a package whose every exports target is a
 * 404. An extensionless relative import runs everywhere here and nowhere
 * under plain node. And a `dist` that lost the comments on `loadGame`'s
 * import of a game's code builds, passes and then loads no game on a studio's
 * page bundled with webpack.
 *
 * The package also carries the agent guide, at `skill/vbz-game/`, which
 * `vbz new` and `vbz guides` copy into a game. Its tests sit beside it and
 * must not ship, and what ships has to be the guide git holds, so the
 * tarball's copy is compared with the committed one file by file.
 *
 *   bun run scripts/check-publishable.ts
 *
 * Exit codes: 0 passed, 1 the package would ship broken, 2 nothing to check.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, posix, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { $ } from "bun"
import { RENAMED_IN_GAME } from "../packages/sdk/src/cli/new.js"

export const PUBLIC_PACKAGES = ["sdk"] as const

/**
 * The agent guide, as a path inside the package. Everything the tarball holds
 * under `skill/` has to be under this directory.
 */
export const GUIDE = "skill/vbz-game"

export type Shipped = {
  readonly name: string
  readonly version: string
  readonly dependencies: Record<string, string>
  /** The commands the package installs, and the file each one runs. */
  readonly bin: Record<string, string>
  readonly files: readonly string[]
  /** What plain node made of every subpath the exports map names. */
  readonly imports: ImportReport
  /** The bundler comments `loadGame`'s import has lost, if any. */
  readonly bundlerComments: readonly string[]
  /** How the guide in the tarball differs from the committed one. */
  readonly guide: readonly string[]
}

/** One file of the guide as git holds it. */
export type CommittedFile = {
  readonly bytes: Uint8Array
  readonly executable: boolean
}

/** git's mode for an executable file; a plain one is 100644. */
const GIT_EXECUTABLE = "100755"

/** Whether any of the owner, group or other execute bits is set. */
function executable(path: string): boolean {
  return (statSync(path).mode & 0o111) !== 0
}

/**
 * Compares the guide an unpacked tarball carries with the committed one, file
 * for file and byte for byte.
 *
 * `committed` maps each file git holds under the guide, by its path inside the
 * package such as `skill/vbz-game/SKILL.md`, to the bytes and mode git holds
 * for it. npm packs whatever is on disk, so a file git does not track reaches
 * the tarball, an edit nobody committed ships, and an ignore rule nobody reads
 * drops a tracked file without a word. The execute bit is compared too,
 * because `vbz new` copies the guide into a game with the modes it shipped
 * with.
 */
export function guideDifferences(
  unpacked: string,
  shipped: readonly string[],
  committed: ReadonlyMap<string, CommittedFile>,
): string[] {
  const problems: string[] = []
  const inGuide = (path: string): boolean => path.startsWith(`${GUIDE}/`)
  const yesOrNo = (flag: boolean): string => (flag ? "" : "not ")

  for (const path of shipped) {
    if (path.startsWith("skill/") && !inGuide(path)) {
      problems.push(`${path} ships, and only ${GUIDE}/ belongs under skill/`)
    }
  }

  const packed = new Set(shipped.filter(inGuide))
  const tracked = [...committed.keys()].filter(inGuide).sort()
  if (tracked.length === 0) {
    problems.push(`no committed files under ${GUIDE}/ to compare with`)
  }
  for (const path of tracked) {
    const file = committed.get(path) as CommittedFile
    if (!packed.has(path)) {
      problems.push(`${path} is committed and the tarball does not carry it`)
      continue
    }
    const inTarball = join(unpacked, path)
    if (!Buffer.from(file.bytes).equals(readFileSync(inTarball))) {
      problems.push(`${path} in the tarball differs from the committed file`)
    }
    if (file.executable !== executable(inTarball)) {
      problems.push(
        `${path} is ${yesOrNo(file.executable)}executable when committed and ${yesOrNo(executable(inTarball))}in the tarball`,
      )
    }
  }
  for (const path of [...packed].sort()) {
    if (!committed.has(path)) {
      problems.push(`${path} is in the tarball and is not committed`)
    }
  }
  return problems
}

/** Runs git in `cwd` with `args`, feeding it `input`, and answers its stdout. */
export type Git = (
  cwd: string,
  args: readonly string[],
  input?: Uint8Array,
) => Promise<Uint8Array>

const runGit: Git = async (cwd, args, input) => {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${code}: ${err.trim()}`)
  }
  return new Uint8Array(out)
}

const NEWLINE = 0x0a

/**
 * Splits what `git cat-file --batch` printed for `objects`, in the order they
 * were asked for. Each answer is a header, `<object> blob <size>`, then that
 * many bytes and a newline, so the sizes rather than the newlines decide
 * where one blob ends: a blob may hold newlines of its own.
 */
export function parseBatch(
  output: Uint8Array,
  objects: readonly string[],
): Uint8Array[] {
  const decoder = new TextDecoder()
  const blobs: Uint8Array[] = []
  let at = 0
  for (const object of objects) {
    const end = output.indexOf(NEWLINE, at)
    const header = end === -1 ? "" : decoder.decode(output.subarray(at, end))
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(header)
    if (match === null || match[1] !== object) {
      throw new Error(
        `git cat-file has no blob ${object}: it printed "${header}"`,
      )
    }
    const start = end + 1
    const size = Number(match[2])
    if (start + size + 1 > output.length) {
      throw new Error(`git cat-file's answer for ${object} is cut short`)
    }
    blobs.push(output.slice(start, start + size))
    at = start + size + 1
  }
  return blobs
}

/**
 * The guide as git holds it, keyed by path inside the package.
 *
 * This reads git's index, which in CI is the commit being checked and on a
 * laptop is what the next commit would hold, and the blob bytes themselves
 * rather than the working tree, so a guide edited and never staged is not
 * what this compares against. Two processes, however many files: one to list
 * them and one `cat-file --batch` for all their bytes.
 */
export async function committedGuide(
  packageDir: string,
  git: Git = runGit,
): Promise<Map<string, CommittedFile>> {
  const listed = new TextDecoder().decode(
    await git(packageDir, ["ls-files", "-s", "-z", "--", GUIDE]),
  )
  const entries: { mode: string; object: string; path: string }[] = []
  for (const entry of listed.split("\0")) {
    if (entry === "") continue
    // <mode> <object> <stage>\t<path>, with the path relative to packageDir.
    const match = /^(\d{6}) ([0-9a-f]+) \d\t(.+)$/.exec(entry)
    if (match === null) {
      throw new Error(
        `git ls-files printed an entry this cannot read: ${entry}`,
      )
    }
    entries.push({
      mode: match[1] as string,
      object: match[2] as string,
      path: match[3] as string,
    })
  }
  const out = new Map<string, CommittedFile>()
  if (entries.length === 0) return out
  const objects = entries.map((entry) => entry.object)
  const blobs = parseBatch(
    await git(
      packageDir,
      ["cat-file", "--batch"],
      new TextEncoder().encode(`${objects.join("\n")}\n`),
    ),
    objects,
  )
  entries.forEach((entry, index) => {
    out.set(entry.path, {
      bytes: blobs[index] as Uint8Array,
      executable: entry.mode === GIT_EXECUTABLE,
    })
  })
  return out
}

type ExportsMap = Record<string, { default?: string } | string>

/** What `unimportableSubpaths` found, and what it could not ask about. */
export type ImportReport = {
  readonly problems: readonly string[]
  /** Subpaths whose peer is not installed here. */
  readonly skipped: readonly string[]
}

/** Every subpath in the exports map, and the file it resolves to. */
export function exportTargets(
  exports: ExportsMap | undefined,
): readonly (readonly [string, string])[] {
  const out: [string, string][] = []
  for (const [subpath, target] of Object.entries(exports ?? {})) {
    const file = typeof target === "string" ? target : target.default
    if (file !== undefined) out.push([subpath, file])
  }
  return out
}

/**
 * An error node raises for a bare specifier it cannot resolve.
 *
 * A peer that is not installed is not a finding about this package, and it
 * reads differently from a relative path node cannot resolve, which is.
 */
const MISSING_PEER = /Cannot find package '([^']+)'/

/**
 * Imports every subpath of an unpacked package with plain node.
 *
 * Bun and every bundler resolve an extensionless relative import; node ESM
 * does not, and `tsc` emits what the source wrote. So a package can build,
 * typecheck, pass its whole suite under bun and still fail on a consumer's
 * first `import` with ERR_MODULE_NOT_FOUND.
 *
 * The repository's node_modules is linked into the unpacked tree, so the peer
 * resolves the way it would for somebody who installed it.
 */
export async function unimportableSubpaths(
  packageDir: string,
): Promise<ImportReport> {
  const manifest = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  ) as { exports?: ExportsMap }

  try {
    symlinkSync(resolve("node_modules"), join(packageDir, "node_modules"))
  } catch {
    // Already there, or a filesystem that will not link. Every subpath with no
    // peer of its own is still checked, which is most of them.
  }

  const problems: string[] = []
  const skipped: string[] = []
  for (const [subpath, file] of exportTargets(manifest.exports)) {
    // Anything that is not a module is data, and importing JSON needs an
    // import attribute the consumer supplies.
    if (!file.endsWith(".js")) continue

    const url = pathToFileURL(join(packageDir, file)).href
    const result =
      await $`node --input-type=module -e ${`await import(${JSON.stringify(url)})`}`
        .quiet()
        .nothrow()
    if (result.exitCode === 0) continue

    const stderr = result.stderr.toString()
    const peer = stderr.match(MISSING_PEER)
    if (peer !== null) {
      skipped.push(`${subpath} (${peer[1]} is not installed here)`)
      continue
    }
    const reason =
      stderr
        .split("\n")
        .find((line) => line.includes("Cannot find"))
        ?.trim() ?? stderr.split("\n")[0]?.trim()
    problems.push(`node cannot import "${subpath}": ${reason}`)
  }
  return { problems, skipped }
}

/**
 * Files the package reads at runtime rather than imports.
 *
 * Two kinds. The harness bundles its own page script when it starts, and
 * runs its replay in a child process, each from a path built off
 * `import.meta.dir`: in this repository that resolves to the TypeScript
 * beside the source and in an installed copy it has to resolve to the
 * compiled file, which only ships if `tsc` emitted it. And `vbz new` copies
 * the template out of the package, which only works if the template is in
 * the tarball, and renames the files `RENAMED_IN_GAME` lists on the way,
 * which only works if npm packed each under the name it is stored under. The guide `vbz
 * new` copies is held by the comparison with git's copy instead.
 *
 * Nothing that imports the package would notice either one missing. The
 * failure arrives when somebody runs a command.
 */
export const RUNTIME_FILES: readonly string[] = [
  "dist/harness/page/main.js",
  "dist/harness/replay-child.js",
  "dist/cli/check-child.js",
  "templates/game/package.json",
  // What `vbz new` renames on the way into a game, by the names it ships
  // under, read from the table that renames them.
  ...Object.keys(RENAMED_IN_GAME).map((stored) => `templates/game/${stored}`),
  "templates/game/src/sim/index.ts",
  "templates/game/src/present.ts",
  "templates/game/src/capture.ts",
  "templates/game/site/index.html",
  "templates/game/site/main.ts",
]

/**
 * The file holding `loadGame`'s import of a game's page module, and the
 * comments that keep a studio's bundler off it. That import takes a URL
 * handed over at run time, so it is the browser's to make. Measured by the
 * browser suite's packed install: without `webpackIgnore`, webpack 5.112
 * turns it into a lookup in its own module table and the page loads no
 * game. `@vite-ignore` is Vite's spelling of the same request; Vite 8's
 * production build leaves the import alone either way.
 */
export const BUNDLER_COMMENTS = {
  file: "dist/host/load.js",
  comments: ["/* webpackIgnore: true */", "/* @vite-ignore */"],
} as const

/**
 * The bundler comments no dynamic `import(` in `source` carries. A comment
 * anywhere else in the file tells a bundler nothing.
 */
export function missingBundlerComments(source: string): string[] {
  const calls = [...source.matchAll(/\bimport\(([^)]*)\)/g)].map(
    (call) => call[1] ?? "",
  )
  return BUNDLER_COMMENTS.comments.filter(
    (comment) => !calls.some((call) => call.includes(comment)),
  )
}

/** Reads the package.json a tarball would carry, not the one on disk. */
export async function pack(pkg: string, into: string): Promise<Shipped> {
  // What is on disk is what ships: there is one package, with no sibling to
  // depend on, so no publish-time rewrite stands between the two.
  await $`npm pack --pack-destination ${into}`.cwd(`packages/${pkg}`).quiet()
  const tarball = [...new Bun.Glob("*.tgz").scanSync(into)][0]
  if (tarball === undefined) throw new Error(`${pkg} produced no tarball`)
  const out = join(into, "unpacked")
  await $`mkdir -p ${out}`.quiet()
  await $`tar -xzf ${join(into, tarball)} -C ${out}`.quiet()
  const manifest = JSON.parse(
    readFileSync(join(out, "package", "package.json"), "utf8"),
  ) as {
    name: string
    version: string
    dependencies?: Record<string, string>
    bin?: Record<string, string>
  }
  const unpacked = join(out, "package")
  // Dot files too. npm drops a few by name, `.DS_Store` among them, and packs
  // every other one it finds under a `files` entry.
  const files = [...new Bun.Glob("**/*").scanSync({ cwd: unpacked, dot: true })]
  const loader = join(unpacked, BUNDLER_COMMENTS.file)
  return {
    name: manifest.name,
    version: manifest.version,
    dependencies: manifest.dependencies ?? {},
    bin: manifest.bin ?? {},
    files,
    imports: await unimportableSubpaths(unpacked),
    // A tarball with no such file has lost them all, and says so twice:
    // here, and as the subpath node cannot import.
    bundlerComments: existsSync(loader)
      ? missingBundlerComments(readFileSync(loader, "utf8"))
      : [...BUNDLER_COMMENTS.comments],
    guide: guideDifferences(
      unpacked,
      files,
      await committedGuide(`packages/${pkg}`),
    ),
  }
}

/**
 * A command's file as `npm publish` writes it: forward slashes, no leading
 * `./`. It is the step `@npmcli/package-json` calls `secureAndUnixifyPath`.
 *
 * `npm pack` leaves the entry alone and `npm publish` rewrites it, so packing
 * cannot show the difference. npm 12 reports the rewrite as
 * `"bin[vbz]" script name dist/cli/index.js was invalid and removed` and then
 * keeps the entry, which is how 0.3.0 was released: a log saying the command
 * was gone, and a package that had it.
 */
export function asPublished(target: string): string {
  return posix.join("/", target.replace(/\\/g, "/")).slice(1)
}

export function problemsWith(shipped: Shipped): string[] {
  const problems: string[] = []
  for (const [name, range] of Object.entries(shipped.dependencies)) {
    if (range.startsWith("workspace:")) {
      problems.push(
        `${shipped.name} would ship ${name}: "${range}", which no consumer can install`,
      )
    }
  }
  // `files` lists README.md, and npm drops a missing entry without failing.
  if (!shipped.files.includes("README.md")) {
    problems.push(`${shipped.name} would ship no README.md`)
  }
  // Without dist there is nothing to import: every exports target is under it.
  if (!shipped.files.some((file) => file.startsWith("dist/"))) {
    problems.push(`${shipped.name} would ship no dist; run "bun run build"`)
  }
  for (const file of RUNTIME_FILES) {
    if (!shipped.files.includes(file)) {
      problems.push(
        `${shipped.name} would ship no ${file}, which it reads at runtime`,
      )
    }
  }
  for (const [command, target] of Object.entries(shipped.bin)) {
    const published = asPublished(target)
    if (published !== target) {
      problems.push(
        `${shipped.name} names bin "${command}" as "${target}", which npm rewrites at publish and reports as removed; write "${published}"`,
      )
    }
    // A command whose file is not in the tarball installs a link to nothing.
    if (!shipped.files.includes(published)) {
      problems.push(
        `${shipped.name} would ship no ${published}, which the "${command}" command runs`,
      )
    }
  }
  for (const comment of shipped.bundlerComments) {
    problems.push(
      `${shipped.name}'s ${BUNDLER_COMMENTS.file} has lost ${comment} from loadGame's import, so a studio's bundler would rewrite the import of a game's code`,
    )
  }
  problems.push(...shipped.guide)
  problems.push(...shipped.imports.problems)
  return problems
}

async function main(): Promise<number> {
  if (!existsSync("packages/sdk/package.json")) {
    console.error("run this from the repository root")
    return 2
  }
  const found: string[] = []
  for (const pkg of PUBLIC_PACKAGES) {
    const into = mkdtempSync(join(tmpdir(), `sdk-pack-${pkg}-`))
    try {
      const shipped = await pack(pkg, into)
      const problems = problemsWith(shipped)
      found.push(...problems)
      console.log(
        `${problems.length === 0 ? "ok  " : "BAD "} ${shipped.name}@${shipped.version}  ${shipped.files.length} files`,
      )
      for (const note of shipped.imports.skipped) {
        console.log(`     not imported: ${note}`)
      }
    } finally {
      rmSync(into, { recursive: true, force: true })
    }
  }
  if (found.length > 0) {
    console.error("\na package would ship broken:")
    for (const line of found) console.error(`  ${line}`)
    console.error(
      "\nthe manifest on disk is what ships, apart from the command paths npm itself rewrites at publish",
    )
    return 1
  }
  console.log("\nthe package would install cleanly")
  return 0
}

if (import.meta.main) process.exit(await main())
