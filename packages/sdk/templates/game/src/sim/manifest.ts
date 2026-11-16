/**
 * What the platform knows about this game without running it.
 *
 * Every field here is read before a single tick executes: how fast it runs,
 * how long it may run for, what it records, what it counts and how it ranks.
 */

import type { Manifest } from "@clockwork2/engine/manifest"

export const MANIFEST: Manifest = {
  schemaVersion: 2,
  /** Immutable. Change it and this is a different game with a new board. */
  id: "lane-runner",
  version: "1.0.0",
  name: "Lane Runner",
  kernel: { version: "0.8.0" },
  session: {
    tickHz: 60,
    /** A hard cap: the kernel ends the run here whatever the game says. */
    maxTicks: 60 * 120,
    maxWallSeconds: 300,
    hasEnding: true,
  },
  /**
   * What a recording holds: each input by name, and the whole numbers it
   * carries. A press is 0 or 1. Which key or finger drives each one is
   * `src/capture.ts`'s business, not the manifest's.
   */
  inputs: {
    left: { min: 0, max: 1, label: "Left" },
    right: { min: 0, max: 1, label: "Right" },
  },
  counters: [
    { name: "motes", direction: "up", monotonic: true, label: "Motes" },
    { name: "ticksSurvived", direction: "up", monotonic: true, label: "Ticks" },
  ],
  /** Ties on motes break on how long you lasted. */
  rankBy: ["motes", "ticksSurvived"],
  tiePolicy: "shared",
  params: {
    speed: { type: "int", label: "Speed", min: 1, max: 3, default: 1 },
  },
  display: { orientation: "any", minViewport: { width: 320, height: 480 } },
  capabilities: {
    deterministic: true,
    physics: "none",
    renderer: "canvas2d",
    multiplayer: false,
  },
}
