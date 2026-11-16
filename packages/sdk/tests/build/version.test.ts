/**
 * A version read as a release: the one function the platform and `vbz build`
 * both refuse a version with.
 */

import { describe, expect, test } from "bun:test"
import { BuildRefusal } from "../../src/build/errors"
import {
  MAX_VERSION_PART,
  parseReleaseVersion,
  releaseLine,
} from "../../src/build/version"

function refusal(version: string): BuildRefusal {
  try {
    parseReleaseVersion(version)
  } catch (error) {
    if (error instanceof BuildRefusal) return error
    throw error
  }
  throw new Error(`${version} was not refused`)
}

describe("reading a version", () => {
  test("three whole numbers come back as the three parts", () => {
    expect(parseReleaseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    })
    expect(parseReleaseVersion("0.0.0")).toEqual({
      major: 0,
      minor: 0,
      patch: 0,
    })
  })

  test("the largest part a 32-bit signed column holds is accepted", () => {
    const top = String(MAX_VERSION_PART)
    expect(parseReleaseVersion(`${top}.${top}.${top}`).patch).toBe(
      2_147_483_647,
    )
  })

  /**
   * Each of these would either sort one way as text and another as numbers,
   * be two strings for one row of the unique index on the parts, or not fit
   * the column at all.
   */
  test("every version a line cannot hold is refused, saying why", () => {
    const cases: Array<[string, RegExp]> = [
      ["1.2.3-beta.1", /prerelease or build suffix/],
      ["1.2.3+build.5", /prerelease or build suffix/],
      ["01.2.3", /leading zero/],
      ["1.02.3", /leading zero/],
      ["1.2.03", /leading zero/],
      ["1.2", /MAJOR\.MINOR\.PATCH/],
      ["1.2.3.4", /MAJOR\.MINOR\.PATCH/],
      ["v1.2.3", /MAJOR\.MINOR\.PATCH/],
      [" 1.2.3", /MAJOR\.MINOR\.PATCH/],
      ["1.-2.3", /MAJOR\.MINOR\.PATCH/],
      ["", /MAJOR\.MINOR\.PATCH/],
      [`2147483648.0.0`, /major part is above 2147483647/],
      [`0.2147483648.0`, /minor part is above/],
      [`0.0.99999999999999999999`, /patch part is above/],
    ]
    for (const [version, why] of cases) {
      const refused = refusal(version)
      expect(refused.code).toBe("E_VERSION_INVALID")
      expect(refused.message).toMatch(why)
    }
  })
})

describe("a version's line", () => {
  test("is its major and minor", () => {
    expect(releaseLine(parseReleaseVersion("1.2.9"))).toBe("1.2")
    expect(releaseLine(parseReleaseVersion("10.0.0"))).toBe("10.0")
  })
})
