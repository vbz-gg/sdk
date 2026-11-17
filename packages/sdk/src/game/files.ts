/**
 * A version's files folder, as a page module reads it at run time.
 *
 * A version carries a folder of files beside its two modules: art, data packs
 * and code the game's own tools built, such as a renderer's engine. The page
 * module imports code from it statically, as `cw2:files/<path>`, and finds
 * everything else at run time from the folder's base URL, which the page
 * hands `mount`. This file is what turns a path into an address.
 *
 * No browser and no engine: `/build` reads the path rule from here, so a
 * path the build accepts is one a page module can name, and `/game` is
 * bundled into every page module, where this has to fit.
 */

/**
 * What a path in the folder may be: relative, POSIX, segments of ASCII
 * letters, digits, `.`, `_` and `-`, with no empty, `.` or `..` segment.
 *
 * The engine holds a data pack's path in a manifest to the same pattern, so
 * every pack a manifest declares can be a file in the folder. An allow-list
 * rather than a deny-list, because a path becomes a URL, and `%2e%2e`, `?`,
 * `#`, a backslash or a drive letter each change what is fetched.
 */
export const FILE_PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/

/** The longest path the folder may hold, in characters. */
export const MAX_FILE_PATH_LENGTH = 512

/** Whether `path` is one a version's folder may hold. */
export function isFilePath(path: string): boolean {
  return (
    path.length <= MAX_FILE_PATH_LENGTH &&
    FILE_PATH_PATTERN.test(path) &&
    !path.split("/").some((segment) => segment === "." || segment === "..")
  )
}

/** A version's files folder, for a presentation finding its art and data. */
export interface GameFiles {
  /** The folder's address: absolute, ending in `/`. */
  readonly base: string
  /**
   * The absolute address of the file at `path` in the folder. Throws on a
   * path the folder could not hold, rather than building an address that
   * reaches outside it.
   */
  url(path: string): string
}

/**
 * The folder at `base`. Throws when `base` is not an absolute URL ending in
 * `/`, because a relative one would resolve against whatever page loaded the
 * module, and one without the slash drops its last segment from every file.
 */
export function gameFiles(base: string): GameFiles {
  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    throw new Error(
      `the files folder's address ${JSON.stringify(base)} is not an absolute URL`,
    )
  }
  if (!parsed.pathname.endsWith("/") || parsed.search !== "" || parsed.hash) {
    throw new Error(
      `the files folder's address ${JSON.stringify(base)} has to end in / and carry no query`,
    )
  }
  const href = parsed.href
  return {
    base: href,
    url: (path) => {
      if (!isFilePath(path)) {
        throw new Error(
          `${JSON.stringify(path)} is not a path in a version's files folder`,
        )
      }
      return `${href}${path}`
    },
  }
}
