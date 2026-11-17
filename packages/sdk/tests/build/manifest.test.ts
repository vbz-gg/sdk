/**
 * A manifest's size, measured as the platform measures it: the UTF-8 bytes
 * of its JSON with no white space.
 */

import { describe, expect, test } from "bun:test"
import { BuildRefusal } from "../../src/build/errors"
import { MAX_MANIFEST_BYTES } from "../../src/build/limits"
import { assertManifestBytes } from "../../src/build/manifest"

function codeOf(work: () => unknown): string | null {
  try {
    work()
  } catch (error) {
    if (error instanceof BuildRefusal) return error.code
    throw error
  }
  return null
}

describe("a manifest's size", () => {
  /**
   * A manifest naming its game in another script holds more bytes than
   * characters. Counted in characters, one the platform refuses would
   * build here.
   */
  test("is counted in UTF-8 bytes, not characters", () => {
    const base = { id: "probe", pad: "" }
    const room = MAX_MANIFEST_BYTES - JSON.stringify(base).length
    // "é" is one character and two bytes.
    const fits = Math.floor(room / 2)
    expect(
      codeOf(() => assertManifestBytes({ ...base, pad: "é".repeat(fits) })),
    ).toBeNull()
    const over = { ...base, pad: "é".repeat(fits + 1) }
    expect(JSON.stringify(over).length).toBeLessThan(MAX_MANIFEST_BYTES)
    expect(codeOf(() => assertManifestBytes(over))).toBe("E_MANIFEST_INVALID")
  })
})
