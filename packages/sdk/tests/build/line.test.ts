/**
 * A release line's contract: what a patch must keep, as one projection both
 * `vbz check` and the platform call.
 */

import { describe, expect, test } from "bun:test"
import { encodeCanonical } from "@clockwork2/engine"
import type { Manifest } from "@clockwork2/engine/manifest"
import {
  CAPABILITY_RULES,
  contractSha256,
  LINE_RULES,
  lineChanges,
  lineContract,
} from "../../src/build/line"

const MANIFEST: Manifest = {
  schemaVersion: 3,
  id: "lane-runner",
  version: "1.2.0",
  name: "Lane Runner",
  kernel: { version: "0.8.0" },
  genres: ["arcade"],
  session: {
    tickHz: 60,
    hasEnding: true,
  },
  inputs: {
    left: { min: 0, max: 1, label: "Left" },
    aimX: { min: 0, max: 31 },
  },
  counters: [
    { name: "motes", direction: "up", monotonic: true, label: "Motes" },
  ],
  rankBy: ["motes"],
  tiePolicy: "shared",
  params: {
    speed: {
      type: "int",
      label: "Speed",
      description: "How fast the rocks come",
      min: 1,
      max: 3,
      default: 1,
    },
  },
  budgets: { assetBytes: 1_000_000 },
  display: { orientation: "any" },
  capabilities: {
    deterministic: true,
    physics: "none",
    renderer: "canvas2d",
    multiplayer: false,
  },
}

function patched(change: (manifest: Manifest) => Manifest): Manifest {
  return change(structuredClone(MANIFEST) as Manifest)
}

describe("what a patch may change", () => {
  test("a new look, a new name and a new kernel are still the same line", () => {
    const patch = patched((m) => ({
      ...m,
      version: "1.2.1",
      name: "Lane Runner Deluxe",
      kernel: { version: "0.9.0" },
      genres: ["arcade", "runner"],
      budgets: { assetBytes: 2_000_000 },
      display: { orientation: "portrait" },
      assets: [],
      capabilities: { ...m.capabilities, renderer: "pixi", webgpu: true },
    }))
    expect(lineChanges(MANIFEST, patch)).toEqual([])
    expect(contractSha256(patch)).toBe(contractSha256(MANIFEST))
  })

  /** A label is what a player reads; the range beside it is what a replay reads. */
  test("every label and description may change", () => {
    const patch = patched((m) => ({
      ...m,
      inputs: {
        left: { min: 0, max: 1, label: "Go left" },
        aimX: { min: 0, max: 31 },
      },
      counters: [{ name: "motes", direction: "up", monotonic: true }],
      params: {
        speed: { type: "int", label: "Pace", min: 1, max: 3, default: 1 },
      },
    })) as Manifest
    expect(lineChanges(MANIFEST, patch)).toEqual([])
    expect(contractSha256(patch)).toBe(contractSha256(MANIFEST))
  })

  test("no parameters and an empty table are one contract", () => {
    const none = patched((m) => {
      const { params: _params, ...rest } = m
      return rest
    })
    const empty = patched((m) => ({ ...m, params: {} }))
    expect(lineChanges(none, empty)).toEqual([])
    expect(lineContract(none)).toEqual(lineContract(empty))
  })
})

describe("what a patch must keep", () => {
  /** Each of these changes how a run is played or ranked. */
  test("each fixed field moved is named", () => {
    const cases: Array<[string, (m: Manifest) => Manifest]> = [
      [
        "inputs",
        (m) => ({ ...m, inputs: { ...m.inputs, aimX: { min: 0, max: 63 } } }),
      ],
      [
        "inputs",
        (m) => ({ ...m, inputs: { ...m.inputs, jump: { min: 0, max: 1 } } }),
      ],
      [
        "session",
        (m) => ({ ...m, session: { ...m.session, hasEnding: false } }),
      ],
      [
        "counters",
        (m) => ({
          ...m,
          counters: [{ name: "motes", direction: "down", monotonic: true }],
        }),
      ],
      ["rankBy", (m) => ({ ...m, rankBy: [] })],
      ["tiePolicy", (m) => ({ ...m, tiePolicy: "earliest" })],
      [
        "params",
        (m) => ({
          ...m,
          params: { speed: { type: "int", label: "Speed", min: 1, max: 5 } },
        }),
      ],
      ["id", (m) => ({ ...m, id: "lane-runner-2" })],
      [
        "capabilities.physics",
        (m) => ({
          ...m,
          capabilities: { ...m.capabilities, physics: "box2d" },
        }),
      ],
    ]
    for (const [field, change] of cases) {
      const patch = patched(change)
      expect(lineChanges(MANIFEST, patch)).toEqual([field])
      expect(contractSha256(patch)).not.toBe(contractSha256(MANIFEST))
    }
  })

  test("several fields moved are all named, in the table's order", () => {
    const patch = patched((m) => ({
      ...m,
      rankBy: [],
      inputs: {},
      capabilities: { ...m.capabilities, physics: "box2d" },
    }))
    expect(lineChanges(MANIFEST, patch)).toEqual([
      "inputs",
      "rankBy",
      "capabilities.physics",
    ])
  })
})

describe("the contract itself", () => {
  test("it holds the fixed fields and none of the free ones", () => {
    expect(lineContract(MANIFEST)).toEqual({
      schemaVersion: 3,
      id: "lane-runner",
      session: MANIFEST.session,
      inputs: { left: { min: 0, max: 1 }, aimX: { min: 0, max: 31 } },
      counters: [{ name: "motes", direction: "up", monotonic: true }],
      rankBy: ["motes"],
      tiePolicy: "shared",
      params: { speed: { type: "int", min: 1, max: 3, default: 1 } },
      capabilities: {
        deterministic: true,
        physics: "none",
        multiplayer: false,
      },
    })
  })

  /**
   * The hash is the engine's canonical encoding, so the order a studio wrote
   * its manifest's keys in cannot move it.
   */
  test("its hash is the SHA-256 of the canonical encoding, whatever the key order", () => {
    const reordered = Object.fromEntries(
      Object.entries(MANIFEST).reverse(),
    ) as Manifest
    expect(contractSha256(reordered)).toBe(contractSha256(MANIFEST))
    const bytes = new TextEncoder().encode(
      encodeCanonical(lineContract(MANIFEST)),
    )
    expect(contractSha256(MANIFEST)).toBe(
      new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    )
  })

  /**
   * The tables are typed over the engine's own `Manifest`, so a field a later
   * engine adds fails to compile until it is placed. At run time, every key
   * in the tables is one a manifest can carry.
   */
  test("every manifest field and capability is placed exactly once", () => {
    expect(Object.keys(LINE_RULES).sort()).toEqual(
      [
        "assets",
        "budgets",
        "capabilities",
        "counters",
        "display",
        "genres",
        "id",
        "inputs",
        "kernel",
        "name",
        "params",
        "rankBy",
        "schemaVersion",
        "session",
        "tiePolicy",
        "version",
      ].sort(),
    )
    expect(Object.keys(CAPABILITY_RULES).sort()).toEqual(
      [
        "deterministic",
        "multiplayer",
        "physics",
        "pointerLock",
        "renderer",
        "webgpu",
      ].sort(),
    )
  })
})
