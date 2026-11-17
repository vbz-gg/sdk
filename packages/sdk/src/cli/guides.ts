/**
 * The two agent guides a game carries, and where each one comes from.
 *
 * A game built with this package has two sets of rules an agent has to
 * follow: the engine's, on writing a simulation that replays exactly, and
 * this package's, on everything between that simulation and a game the
 * platform can check. Each package ships its own guide under `skill/`, and a
 * game keeps a copy of both in `.claude/skills/`, where an agent's tools look
 * for skills, so the guide an agent reads is the one for the versions the
 * game installed.
 *
 * `vbz new` copies this package's own guide and the engine's from the engine
 * installed beside it. `vbz guides` copies both from the packages installed in
 * the game, so a game that upgraded either package gets the guides of the
 * versions it now has, not the ones of whichever copy ran the command.
 *
 * Either one missing is an error, and nothing is written: a game with one
 * guide, or with a guide from another version than the code it describes,
 * is a game whose agent follows rules nobody checked against it.
 */

import { randomUUID } from "node:crypto"
import { cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

/**
 * Where a game keeps the guides, relative to its root. Written with forward
 * slashes, which is how it is printed on every platform; `join` turns it into
 * the platform's own separators where a file is opened.
 */
export const SKILLS_DIR = ".claude/skills"

/** Where a package keeps the guide it ships, relative to its root. */
export const SHIPPED_GUIDES_DIR = "skill"

/** A guide: the package that ships it, and the folder it ships in. */
export interface GuideSpec {
  readonly package: string
  /** The folder under the package's `skill/`, and under a game's skills. */
  readonly name: string
}

export const KIT_GUIDE: GuideSpec = { package: "@vbz-gg/sdk", name: "vbz-game" }
export const ENGINE_GUIDE: GuideSpec = {
  package: "@clockwork2/engine",
  name: "clockwork2",
}

/** Every guide a game carries. */
export const GUIDES: readonly GuideSpec[] = [KIT_GUIDE, ENGINE_GUIDE]

/** A guide found in an installed package. */
export interface Guide {
  readonly name: string
  readonly package: string
  readonly version: string
  /** The guide's folder, inside the package. */
  readonly source: string
}

/** This package's root, the same distance from this module in `src` and `dist`. */
export const OWN_ROOT = join(import.meta.dir, "..", "..")

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() === true
}

/**
 * The root of the package `name` as node would find it from a module in
 * `from`: `node_modules/<name>` in `from` and then in each directory above it,
 * skipping a directory that is itself called `node_modules`. Null when no
 * directory on the way holds it.
 */
export async function packageRoot(
  name: string,
  from: string,
): Promise<string | null> {
  let dir = resolve(from)
  for (;;) {
    if (basename(dir) !== "node_modules") {
      const candidate = join(dir, "node_modules", name)
      if (await isFile(join(candidate, "package.json"))) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * The guide `spec` names, in the copy of its package at `root`.
 *
 * A package whose `skill/<name>/SKILL.md` is missing ships no guide: a
 * release from before the guide shipped, or a package somebody trimmed.
 */
export async function guideIn(spec: GuideSpec, root: string): Promise<Guide> {
  const file = join(root, "package.json")
  const manifest = JSON.parse(await readFile(file, "utf8")) as {
    version?: unknown
  }
  const { version } = manifest
  if (typeof version !== "string" || version === "") {
    throw new Error(
      `${file} has no version, so nothing says which release of ${spec.package} its guide comes from.`,
    )
  }
  const source = join(root, SHIPPED_GUIDES_DIR, spec.name)
  if (!(await isFile(join(source, "SKILL.md")))) {
    throw new Error(
      `${spec.package} ${version} at ${root} ships no guide: there is no ${SHIPPED_GUIDES_DIR}/${spec.name}/SKILL.md in it. A release from before the package shipped its guide has none; upgrade ${spec.package}.`,
    )
  }
  return { name: spec.name, package: spec.package, version, source }
}

/** The root of `spec`'s package as found from `from`, or an error naming it. */
async function installed(
  spec: GuideSpec,
  from: string,
  where: string,
): Promise<string> {
  const root = await packageRoot(spec.package, from)
  if (root === null) {
    throw new Error(
      `${spec.package} is not installed ${where}: no node_modules from ${resolve(from)} up holds it, so there is no guide to copy from it.`,
    )
  }
  return root
}

/**
 * The guides `vbz new` copies: this package's own, and the engine's from the
 * engine installed beside this package, found from `from` the way node would
 * find it from this module.
 */
export async function guidesBesideKit(
  ownRoot: string = OWN_ROOT,
  from: string = import.meta.dir,
): Promise<readonly Guide[]> {
  return [
    await guideIn(KIT_GUIDE, ownRoot),
    await guideIn(
      ENGINE_GUIDE,
      await installed(ENGINE_GUIDE, from, `beside ${KIT_GUIDE.package}`),
    ),
  ]
}

/**
 * The guides the packages installed in `dir` ship, each found from `dir` the
 * way node would, so a game's own versions answer and not the copy of this
 * package that is running.
 */
export async function guidesInstalledIn(
  dir: string,
): Promise<readonly Guide[]> {
  const found: Guide[] = []
  for (const spec of GUIDES) {
    found.push(
      await guideIn(spec, await installed(spec, dir, `in ${resolve(dir)}`)),
    )
  }
  return found
}

/**
 * Writes each guide to `dir/.claude/skills/<name>`, replacing the folder
 * whole, so a file a newer guide dropped does not linger beside the ones it
 * kept. Anything else in `.claude/skills` is left alone. Answers the folders
 * it wrote.
 *
 * Every guide is copied into a temporary folder beside its target first, and
 * only once all the copies exist do they replace what the game had. What can
 * fail part-way - a file that cannot be read, a full disk - fails before
 * anything the game had is touched, and the temporary folders go with it, so
 * a game never holds one guide from one release beside one from another.
 * The replacing is a rename within one folder.
 */
export async function installGuides(
  dir: string,
  guides: readonly Guide[],
): Promise<readonly string[]> {
  const skills = join(dir, SKILLS_DIR)
  await mkdir(skills, { recursive: true })
  const staged = guides.map((guide) => ({
    target: join(skills, guide.name),
    fresh: join(skills, `.${guide.name}.${randomUUID()}`),
    source: guide.source,
  }))
  try {
    for (const { source, fresh } of staged) {
      await cp(source, fresh, { recursive: true })
    }
    for (const { target, fresh } of staged) {
      await rm(target, { recursive: true, force: true })
      await rename(fresh, target)
    }
  } finally {
    for (const { fresh } of staged) {
      await rm(fresh, { recursive: true, force: true })
    }
  }
  return staged.map(({ target }) => target)
}

/**
 * Refuses `dir` unless it is a game's root: a directory holding a
 * `package.json` that names this package as a dependency. That is where a
 * game made with `vbz new` keeps its guides, and where its packages are
 * found from. A mistyped path is refused rather than made, since node would
 * still find the game's packages from inside it.
 */
export async function assertGameRoot(dir: string): Promise<void> {
  const file = join(dir, "package.json")
  const text = await readFile(file, "utf8").catch((error: unknown) => {
    if ((error as { code?: unknown }).code === "ENOENT") return null
    throw error
  })
  const notRoot = `${resolve(dir)} is not a game's root`
  if (text === null) throw new Error(`${notRoot}: it has no package.json.`)
  const manifest = JSON.parse(text) as {
    dependencies?: Record<string, unknown>
    devDependencies?: Record<string, unknown>
  }
  const names = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]
  if (!names.includes(KIT_GUIDE.package)) {
    throw new Error(
      `${notRoot}: its package.json names no ${KIT_GUIDE.package} in dependencies or devDependencies.`,
    )
  }
}

/**
 * `vbz guides`: replaces a game's guides with the ones its installed packages
 * ship. The game's root is checked and both guides are found before anything
 * is written, so a missing one leaves the game as it was.
 */
export async function refreshGuides(dir: string): Promise<readonly Guide[]> {
  await assertGameRoot(dir)
  const guides = await guidesInstalledIn(dir)
  await installGuides(dir, guides)
  return guides
}

/** What `vbz new` and `vbz guides` print about the guides they wrote. */
export function guideLines(guides: readonly Guide[]): string[] {
  return guides.map(
    (guide) =>
      `${SKILLS_DIR}/${guide.name}  from ${guide.package} ${guide.version}`,
  )
}
