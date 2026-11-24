/**
 * A game's version, read as a release.
 *
 * A version is `MAJOR.MINOR.PATCH` and nothing else, and every version sharing
 * one `MAJOR.MINOR` is one release line. vbz.gg stores each part as a 32-bit
 * signed integer and orders every version picker by the three of them, so a
 * version those columns cannot hold, or that sorts one way as text and
 * another as numbers, is refused before a byte is stored. `vbz build` refuses
 * the same versions through this same function, so a build that passes is
 * one an upload to vbz.gg takes.
 *
 * The engine keeps its own wider pattern, for games built without this
 * SDK.
 */

import { refuse } from "./errors.js"

/** The largest a part may be: what a 32-bit signed integer holds. */
export const MAX_VERSION_PART = 2_147_483_647

export interface ReleaseVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/** Three decimal parts, none with a leading zero, and nothing after. */
const RELEASE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

/**
 * The version's three parts, or a `BuildRefusal` with `E_VERSION_INVALID`
 * naming why: a prerelease or build suffix, a leading zero, or a part above
 * `MAX_VERSION_PART`.
 *
 * A leading zero is refused rather than read, because `1.02.0` and `1.2.0`
 * would be two version strings for one row of the unique index on the parts.
 */
export function parseReleaseVersion(version: string): ReleaseVersion {
  const parts = RELEASE_VERSION.exec(version)
  if (parts === null) {
    refuse(
      "E_VERSION_INVALID",
      `version ${JSON.stringify(version)} is not MAJOR.MINOR.PATCH: three whole numbers with no leading zero, and no prerelease or build suffix`,
    )
  }
  const [major, minor, patch] = parts.slice(1).map(Number) as [
    number,
    number,
    number,
  ]
  for (const [name, value] of [
    ["major", major],
    ["minor", minor],
    ["patch", patch],
  ] as const) {
    if (value > MAX_VERSION_PART) {
      refuse(
        "E_VERSION_INVALID",
        `version ${version}: the ${name} part is above ${MAX_VERSION_PART}`,
      )
    }
  }
  return { major, minor, patch }
}

/** The release line a version belongs to, as `MAJOR.MINOR`. */
export function releaseLine(version: ReleaseVersion): string {
  return `${version.major}.${version.minor}`
}
