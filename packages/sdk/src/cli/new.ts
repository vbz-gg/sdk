/**
 * A game that already conforms, copied into a directory of your own.
 *
 * Starting from a template rather than an empty directory is what makes the
 * first failure yours: the copy builds, passes the whole conformance suite and
 * plays in the harness before a line of it is changed, so anything that breaks
 * afterwards is something you just did.
 *
 * The template ships inside the package, at the same place relative to this
 * module in the source tree and in `dist`, so an installed copy has it too.
 *
 * A new game also gets the two agent guides, this package's and the engine's,
 * in `.claude/skills/`, and an `AGENTS.md` that says where they are. Both
 * guides are found before anything is written, so a missing one leaves no
 * half-made game behind.
 */

import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { basename, join, relative, sep } from "node:path"
import { type Guide, guidesBesideKit, installGuides } from "./guides.js"

/** The template this package ships, wherever it is installed. */
export const TEMPLATE_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "templates",
  "game",
)

/** This package's own manifest, for the versions a new game should ask for. */
const OWN_MANIFEST = join(import.meta.dir, "..", "..", "package.json")

/**
 * Files the template stores under one name and a new game gets under another.
 *
 * npm renames a `.gitignore` to `.npmignore` inside a tarball, so a template
 * carrying one ships without it and every game made from an installed copy
 * starts out committing its own build output. It is stored under a name npm
 * leaves alone and renamed on the way into a new game.
 *
 * `AGENTS.md` and `CLAUDE.md` steer an agent working in the directory that
 * holds them. Under those names in the template, they would steer an agent
 * working on this package as if it were working on a game, and so would a
 * name that differs from them only by case, which macOS and Windows open for
 * them on their default filesystems. So the template stores them under names
 * no tool reads.
 *
 * Every one of these ships, which check:publishable holds, so a template
 * without one is an install that is broken, and `vbz new` says so.
 */
export const RENAMED_IN_GAME: Readonly<Record<string, string>> = {
  gitignore: ".gitignore",
  "game-agents.md": "AGENTS.md",
  "game-claude.md": "CLAUDE.md",
}

/**
 * Directories a copy leaves behind, by name rather than by path.
 *
 * The first spelling of this tested the absolute source path for `/dist` and
 * `/node_modules`, which is a filter that works from a source tree and
 * rejects every file from an installed one: a package installed under
 * `node_modules` has that in the path of everything it owns. `vbz new`
 * then made an empty directory and failed reading the package.json it had not
 * copied. It shipped in 0.1.0 because the tarball was unpacked by hand rather
 * than installed, and a hand-unpacked tarball is the one layout where the bug
 * is invisible.
 */
export const NOT_COPIED = new Set(["dist", "node_modules"])

/** Whether a file under the template is one a new game should get. */
export function isCopied(template: string, source: string): boolean {
  return !relative(template, source)
    .split(sep)
    .some((segment) => NOT_COPIED.has(segment))
}

/** What the template calls itself, and what a copy renames. */
export const TEMPLATE_ID = "lane-runner"
export const TEMPLATE_TITLE = "Lane Runner"

/**
 * A game's id, derived from the directory it was made in.
 *
 * On vbz.gg an id is immutable once published - changing it is a different
 * game with a different board - so it is settled here rather than left as a
 * placeholder somebody forgets.
 */
export function gameIdFrom(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return id === "" ? "game" : id
}

/** A title for a human, from an id nobody wrote by hand. */
export function titleFrom(id: string): string {
  return id
    .split("-")
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/** The template's own name, everywhere it appears in one file. */
export function renamed(text: string, id: string, title: string): string {
  return text.replaceAll(TEMPLATE_ID, id).replaceAll(TEMPLATE_TITLE, title)
}

/**
 * The versions a new game asks for.
 *
 * `@vbz-gg/sdk` is pinned to the copy that made it, and the engine to
 * the range that copy declares as its peer - so a new game installs one engine
 * and it is one this SDK was built against.
 */
export async function versionsFor(
  manifestPath = OWN_MANIFEST,
): Promise<{ sdk: string; engine: string }> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    version?: string
    peerDependencies?: Record<string, string>
  }
  return {
    sdk: `^${manifest.version ?? "0.1.0"}`,
    engine: manifest.peerDependencies?.["@clockwork2/engine"] ?? "*",
  }
}

export interface NewGameOptions {
  readonly dir: string
  readonly template?: string
  readonly versions?: { readonly sdk: string; readonly engine: string }
  /** The guides to copy in; by default this package's and its engine's. */
  readonly guides?: () => Promise<readonly Guide[]>
}

export interface NewGame {
  readonly id: string
  readonly title: string
  readonly dir: string
  /** The guides it was given, in `.claude/skills/`. */
  readonly guides: readonly Guide[]
}

/**
 * Copies the template into `dir` and renames it.
 *
 * An existing directory with anything in it is refused rather than merged
 * into: a half-overwritten game is worse than no game, and the author is the
 * only one who knows what was in there. For the same reason a copy that
 * fails part-way takes back what it wrote: a directory it made goes, and one
 * that was there empty is left empty.
 */
export async function createGame(options: NewGameOptions): Promise<NewGame> {
  const { dir } = options
  const existing = await readdir(dir).catch(() => null)
  if (existing !== null && existing.length > 0) {
    throw new Error(`${dir} is not empty`)
  }

  const id = gameIdFrom(basename(dir))
  const title = titleFrom(id)
  const versions = options.versions ?? (await versionsFor())
  // Found before anything is written: an engine without its guide stops
  // here, rather than after a game half-made without one.
  const guides = await (options.guides ?? guidesBesideKit)()

  await mkdir(dir, { recursive: true })
  try {
    await copyTemplate(dir, options.template ?? TEMPLATE_DIR, id, title)
    await setVersions(dir, versions)
    await installGuides(dir, guides)
  } catch (error) {
    if (existing === null) await rm(dir, { recursive: true, force: true })
    else {
      for (const entry of await readdir(dir)) {
        await rm(join(dir, entry), { recursive: true, force: true })
      }
    }
    throw error
  }

  return { id, title, dir, guides }
}

/** The template, copied into `dir`, with its stored names and its own name changed. */
async function copyTemplate(
  dir: string,
  template: string,
  id: string,
  title: string,
): Promise<void> {
  // A template with a build in it would copy somebody else's artifacts into a
  // new game and call them its own.
  await cp(template, dir, {
    recursive: true,
    filter: (source) => isCopied(template, source),
  })

  for (const [stored, name] of Object.entries(RENAMED_IN_GAME)) {
    await rename(join(dir, stored), join(dir, name)).catch((error: unknown) => {
      if ((error as { code?: unknown }).code !== "ENOENT") throw error
      throw new Error(
        `the template at ${template} has no ${stored}, which a new game gets as ${name}: this copy of @vbz-gg/sdk is incomplete, so install it again.`,
      )
    })
  }

  for (const file of [
    "package.json",
    "README.md",
    "AGENTS.md",
    "src/sim/manifest.ts",
  ]) {
    const path = join(dir, file)
    const before = await readFile(path, "utf8").catch(() => null)
    if (before === null) continue
    await writeFile(path, renamed(before, id, title))
  }
}

/**
 * The dependency lines are versions rather than names, so they are set from
 * this package rather than renamed.
 */
async function setVersions(
  dir: string,
  versions: { readonly sdk: string; readonly engine: string },
): Promise<void> {
  const manifestPath = join(dir, "package.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    devDependencies?: Record<string, string>
  }
  manifest.devDependencies = {
    ...manifest.devDependencies,
    "@clockwork2/engine": versions.engine,
    "@vbz-gg/sdk": versions.sdk,
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
