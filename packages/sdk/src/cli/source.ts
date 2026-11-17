/**
 * Where a game's source is: its three entries, from the command line, and
 * its files folder and what it needs of a page's policy, from its
 * `package.json`.
 *
 * The folder is named in `package.json` rather than by a flag, so every
 * command reads the same one: a build that listed one folder and a `vbz dev`
 * that served another would play a game nobody uploads. It is named, never
 * guessed: a game whose `package.json` says nothing has no folder and lists
 * nothing, and one naming a folder that is not there stops. What the game
 * needs of a page's policy is named there too, and the pages `vbz dev`
 * serves add exactly that.
 *
 * ```json
 * { "vbz": { "files": "files", "needs": { "wasm": true, "workers": true, "files": true } } }
 * ```
 */

import { readFile, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { DIST_DIR } from "../build/dist.js"
import type { GameSource } from "../build/index.js"
import type { GameNeeds } from "../harness/csp.js"
import type { Options } from "./args.js"

/** The key in a game's `package.json` that holds what the kit reads there. */
export const PACKAGE_KEY = "vbz"

/** Whether `child` is `parent` or somewhere under it. */
function within(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

/** The game's `"vbz"` entry in its `package.json`, and where that file is. */
async function settingsOf(root: string): Promise<{
  readonly where: string
  readonly settings: Readonly<Record<string, unknown>>
}> {
  const where = join(root, "package.json")
  let text: string
  try {
    text = await readFile(where, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { where, settings: {} }
    }
    throw error
  }
  const manifest = JSON.parse(text) as Record<string, unknown>
  const settings = manifest[PACKAGE_KEY]
  if (settings === undefined) return { where, settings: {} }
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    throw new Error(
      `${where}: "${PACKAGE_KEY}" is an object, such as { "files": "files" }`,
    )
  }
  return { where, settings: settings as Readonly<Record<string, unknown>> }
}

/** Each need a game may name, as `GameNeeds` names it. */
const NEEDS = ["wasm", "workers", "files"] as const satisfies ReadonlyArray<
  keyof GameNeeds
>

/**
 * What a game's `package.json` says it needs of a page's policy: nothing,
 * unless it names a need. A need that is not one, or not true or false, is
 * refused rather than read as nothing.
 */
export async function needsOf(root: string): Promise<GameNeeds> {
  const { where, settings } = await settingsOf(root)
  const named = settings.needs
  if (named === undefined) return {}
  const entries =
    typeof named === "object" && named !== null && !Array.isArray(named)
      ? Object.entries(named)
      : null
  const unknown = entries?.find(
    ([need, value]) =>
      !NEEDS.some((known) => known === need) || typeof value !== "boolean",
  )
  if (entries === null || unknown !== undefined) {
    throw new Error(
      `${where}: "${PACKAGE_KEY}.needs" names what the game needs of a page's policy, each of ${NEEDS.join(", ")} true or false`,
    )
  }
  return Object.fromEntries(entries) as GameNeeds
}

/**
 * The files folder a game's `package.json` names, absolute, or null when it
 * names none. Throws when the entry is not a folder inside the game, sits in
 * `dist/`, which every build replaces, or is not there.
 */
export async function filesDirOf(root: string): Promise<string | null> {
  const { where, settings } = await settingsOf(root)
  const named = settings.files
  if (named === undefined) return null
  if (typeof named !== "string" || named.trim() === "") {
    throw new Error(
      `${where}: "${PACKAGE_KEY}.files" names the game's files folder, relative to the game, such as "files"`,
    )
  }
  const dir = resolve(root, named)
  if (dir === resolve(root) || !within(root, dir)) {
    throw new Error(
      `${where}: "${PACKAGE_KEY}.files" is ${JSON.stringify(named)}, which is not a folder inside the game`,
    )
  }
  if (within(join(root, DIST_DIR), dir)) {
    throw new Error(
      `${where}: "${PACKAGE_KEY}.files" is ${JSON.stringify(named)}, inside ${DIST_DIR}${sep}, which every build replaces; build the folder somewhere else`,
    )
  }
  const found = await stat(dir).catch(() => null)
  if (found === null || !found.isDirectory()) {
    throw new Error(
      `${where}: "${PACKAGE_KEY}.files" names ${JSON.stringify(named)}, and there is no folder at ${dir}; build it first`,
    )
  }
  return dir
}

/** The game's source, as the command line and its `package.json` say. */
export async function sourceOf(
  options: Pick<Options, "dir" | "simEntry" | "presentEntry" | "captureEntry">,
): Promise<GameSource> {
  return {
    root: options.dir,
    simEntry: options.simEntry,
    presentEntry: options.presentEntry,
    captureEntry: options.captureEntry,
    filesDir: await filesDirOf(options.dir),
  }
}
