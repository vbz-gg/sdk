/**
 * What a patch must keep: the release line's contract.
 *
 * Every version sharing one `MAJOR.MINOR` is one game to players, the board and
 * the day's seed, so a patch may change how the game looks and fix its bugs
 * but not the fields that decide how a run is played and ranked. Those are
 * the line's contract, and it is set by the line's earliest version that was
 * not rejected.
 *
 * `LINE_RULES` places every field of the manifest, and `CAPABILITY_RULES`
 * every capability, typed over the engine's own `Manifest`, so a field a later
 * engine adds fails to compile here until somebody decides which side it is
 * on. `lineContract` projects a manifest through them; `vbz check` prints its
 * hash and the platform stores it per version and compares it on upload, so
 * both sides decide with one function.
 */

import { encodeCanonical, type PlainValue, sha256Hex } from "@clockwork2/engine"
import type { Capabilities, Manifest } from "@clockwork2/engine/manifest"

/**
 * How a release line treats one field. `fixed`: a patch keeps it exactly.
 * `free`: a patch may change it. An object: the part of it the line keeps,
 * so a label can change while the range beside it cannot.
 */
export type LineRule<Value> =
  | "fixed"
  | "free"
  | { readonly keeps: (value: Value) => PlainValue }

export type LineRules = {
  readonly [Field in keyof Manifest]-?: LineRule<Manifest[Field]>
}

/** Fixed or free, per capability. */
export const CAPABILITY_RULES: {
  readonly [Field in keyof Capabilities]-?: "fixed" | "free"
} = {
  deterministic: "fixed",
  physics: "fixed",
  multiplayer: "fixed",
  renderer: "free",
  webgpu: "free",
  pointerLock: "free",
}

/** Every manifest field, and what a patch must keep of it. */
export const LINE_RULES: LineRules = {
  schemaVersion: "fixed",
  id: "fixed",
  version: "free",
  name: "free",
  kernel: "free",
  genres: "free",
  session: "fixed",
  // A recorded input is a name and a whole number in its range, so the names
  // and the ranges are what a replay reads. The label is what a player sees.
  inputs: {
    keeps: (inputs) =>
      Object.fromEntries(
        Object.entries(inputs).map(([name, input]) => [
          name,
          { min: input.min, max: input.max },
        ]),
      ),
  },
  counters: {
    keeps: (counters) =>
      counters.map((counter) => ({
        name: counter.name,
        direction: counter.direction,
        monotonic: counter.monotonic,
      })),
  },
  rankBy: "fixed",
  tiePolicy: "fixed",
  // A game with no parameters and one with an empty table issue the same
  // config, so the two read as one contract.
  params: {
    keeps: (params) =>
      Object.fromEntries(
        Object.entries(params ?? {}).map(([name, param]) => {
          const { label: _label, description: _description, ...kept } = param
          return [name, kept as PlainValue]
        }),
      ),
  },
  assets: "free",
  budgets: "free",
  display: "free",
  capabilities: {
    keeps: (capabilities) => {
      const kept: Record<string, PlainValue> = {}
      for (const [field, rule] of Object.entries(CAPABILITY_RULES)) {
        const value = capabilities[field as keyof Capabilities]
        if (rule === "fixed" && value !== undefined) kept[field] = value
      }
      return kept
    },
  },
}

/** The part of a manifest a release line fixes, as plain data. */
export type LineContract = { readonly [field: string]: PlainValue }

/** What `manifest` holds of each fixed field, through `LINE_RULES`. */
export function lineContract(manifest: Manifest): LineContract {
  const contract: Record<string, PlainValue> = {}
  for (const field of Object.keys(LINE_RULES) as (keyof Manifest)[]) {
    const kept = keptOf(manifest, field)
    if (kept !== undefined) contract[field] = kept
  }
  return contract
}

/**
 * The SHA-256 of the contract's canonical encoding, the engine's own, so key
 * order and number formatting cannot move it. Each version row stores it.
 */
export function contractSha256(manifest: Manifest): string {
  return sha256Hex(
    new TextEncoder().encode(encodeCanonical(lineContract(manifest))),
  )
}

/**
 * The fixed fields `next` changes against `anchor`, the line's contract-
 * setting version, or an empty list when `next` may join the line as a
 * patch. A capability is named as `capabilities.<field>`, since only some of
 * them are fixed.
 */
export function lineChanges(anchor: Manifest, next: Manifest): string[] {
  const changed: string[] = []
  for (const field of Object.keys(LINE_RULES) as (keyof Manifest)[]) {
    if (field === "capabilities") {
      for (const [name, rule] of Object.entries(CAPABILITY_RULES)) {
        const key = name as keyof Capabilities
        if (
          rule === "fixed" &&
          !same(anchor.capabilities[key], next.capabilities[key])
        ) {
          changed.push(`capabilities.${name}`)
        }
      }
      continue
    }
    if (!same(keptOf(anchor, field), keptOf(next, field))) changed.push(field)
  }
  return changed
}

function keptOf(
  manifest: Manifest,
  field: keyof Manifest,
): PlainValue | undefined {
  const rule = LINE_RULES[field] as LineRule<Manifest[typeof field]>
  if (rule === "free") return undefined
  const value = manifest[field]
  if (rule === "fixed") return value as PlainValue | undefined
  return rule.keeps(value)
}

function same(a: PlainValue | undefined, b: PlainValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return encodeCanonical(a) === encodeCanonical(b)
}
