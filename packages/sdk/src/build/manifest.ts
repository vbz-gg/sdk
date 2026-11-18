/**
 * A manifest's size, held where `vbz build` and the upload both hold it.
 *
 * The platform stores a version's manifest as JSON with no white space and
 * measures it that way, whatever spacing the uploaded file had: the UTF-8
 * bytes of `JSON.stringify` of the parsed manifest. `vbz build` measures the
 * manifest the rules code exports the same way, so a build that passes here
 * passes the upload.
 */

import { byteLengthOf } from "../wire/json.js"
import { refuse } from "./errors.js"
import { MAX_MANIFEST_BYTES } from "./limits.js"

/**
 * Refuses a manifest over `MAX_MANIFEST_BYTES` as JSON with no white space,
 * counted in UTF-8 bytes rather than characters (`E_MANIFEST_INVALID`).
 */
export function assertManifestBytes(manifest: unknown): void {
  const bytes = byteLengthOf(manifest)
  if (bytes > MAX_MANIFEST_BYTES) {
    refuse(
      "E_MANIFEST_INVALID",
      `the manifest is ${bytes} bytes as JSON, over the ${MAX_MANIFEST_BYTES} a manifest may hold`,
    )
  }
}

/**
 * One field of a manifest the build has not checked the shape of yet, or
 * undefined when it is not an object or names no such field.
 */
export function manifestField(manifest: unknown, key: string): unknown {
  return typeof manifest === "object" && manifest !== null
    ? (manifest as Readonly<Record<string, unknown>>)[key]
    : undefined
}
