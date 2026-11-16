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

import { cp, mkdir, readFile, rm, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

/** Where a game keeps the guides, relative to its root. */
export const SKILLS_DIR = join(".claude", "skills")

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
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as { version?: unknown }
  const version =
    typeof manifest.version === "string" ? manifest.version : "unknown"
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
 */
export async function installGuides(
  dir: string,
  guides: readonly Guide[],
): Promise<readonly string[]> {
  const written: string[] = []
  for (const guide of guides) {
    const target = join(dir, SKILLS_DIR, guide.name)
    await rm(target, { recursive: true, force: true })
    await mkdir(dirname(target), { recursive: true })
    await cp(guide.source, target, { recursive: true })
    written.push(target)
  }
  return written
}

/**
 * `vbz guides`: replaces a game's guides with the ones its installed packages
 * ship. Both are found before anything is written, so a missing one leaves
 * the game as it was.
 */
export async function refreshGuides(dir: string): Promise<readonly Guide[]> {
  const guides = await guidesInstalledIn(dir)
  await installGuides(dir, guides)
  return guides
}

/** What `vbz new` and `vbz guides` print about the guides they wrote. */
export function guideLines(guides: readonly Guide[]): string[] {
  return guides.map(
    (guide) =>
      `${join(SKILLS_DIR, guide.name)}  from ${guide.package} ${guide.version}`,
  )
}
