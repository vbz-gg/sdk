/**
 * The config a run on this machine plays.
 *
 * A platform serves a ranked or practice run every setting the manifest
 * declares at its default, the engine's `servedConfig`, so a game with a
 * setting that is required and has no default can only be played locally,
 * with a config its page names. The harness page plays the served config
 * unless `vbz dev --config <file>` names one, and the stand-in plays it
 * always, as the platform does. A game no config can be served for is
 * refused before anything is served, in the client's own sentence for it,
 * naming each setting.
 */

import {
  type Manifest,
  mergeParamDefaults,
  type ParamValues,
  servedConfig,
  validateParams,
} from "@clockwork2/engine"
import { CLIENT_ERROR } from "../platform/errors.js"

/** Every setting the manifest requires and gives no default, as `params.<name>`. */
export function unservedSettings(manifest: Manifest): string[] {
  const schema = manifest.params ?? {}
  const served = mergeParamDefaults(schema, null)
  return Object.entries(schema)
    .filter(
      ([name, definition]) =>
        definition.optional !== true && !Object.hasOwn(served, name),
    )
    .map(([name]) => `params.${name}`)
}

/**
 * Every setting at its default, as a platform serves a run; or a refusal
 * naming each setting nobody could serve, followed by `remedy`.
 */
export function servedOrRefused(
  manifest: Manifest,
  remedy: string,
): ParamValues {
  const unserved = unservedSettings(manifest)
  if (unserved.length > 0) {
    throw new Error(
      `E_CONFIG_REQUIRED: ${CLIENT_ERROR.E_CONFIG_REQUIRED} (${unserved.join(", ")}); ${remedy}`,
    )
  }
  return servedConfig(manifest)
}

/**
 * A config a page names for a local run, held to the manifest's settings
 * the way the engine holds any config, with the defaults filled in for what
 * it leaves out. `from` says where it came from, for the refusal.
 */
export function givenConfig(
  manifest: Manifest,
  value: unknown,
  from: string,
): ParamValues {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `${from} is not a config: a config is a JSON object, one value per setting the manifest declares`,
    )
  }
  const schema = manifest.params ?? {}
  const values = value as ParamValues
  const issues = validateParams(schema, values)
  if (issues.length > 0) {
    throw new Error(
      `${from} is not a config this game takes: ${issues.map((issue) => `${issue.at} ${issue.message}`).join("; ")}`,
    )
  }
  return mergeParamDefaults(schema, values)
}
