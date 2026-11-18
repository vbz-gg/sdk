/**
 * What a value takes as JSON with no white space, in UTF-8 bytes: how a
 * page measures a run's chunks and its recording before it sends them, and
 * how `vbz build` measures a manifest, the way the platform measures the one
 * it stores. One implementation, which `/platform` and `/build` both import,
 * so no two of them can count one value two ways.
 *
 * It imports nothing, so neither subpath brings the other's code with it.
 */

/** The UTF-8 bytes of `JSON.stringify(value)`. */
export function byteLengthOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
