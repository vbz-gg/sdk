/**
 * A game that draws its own controls.
 *
 * Everything a player touches is painted by this game's renderer and
 * hit-tested by its simulation: the manifest declares where a finger is and
 * whether it is down, in the playfield's own units, and `tick` decides what a
 * touch at that position means. The second finger is what one shared pointer
 * stream could never express.
 */

import type { Manifest } from "@clockwork2/engine/manifest"

export const MANIFEST: Manifest = {
  schemaVersion: 2,
  id: "paddle",
  version: "1.0.0",
  name: "Paddle",
  kernel: { version: "0.8.0" },
  session: {
    tickHz: 60,
    maxTicks: 60 * 120,
    maxWallSeconds: 180,
    hasEnding: true,
  },
  inputs: {
    // Where the first finger is, across the playfield. The simulation
    // decides what that position means, because a renderer may not decide
    // what was pressed.
    aimX: { min: 0, max: 1000, label: "Drag" },
    aimY: { min: 0, max: 1000, label: "Drag" },
    touch: { min: 0, max: 1, label: "Touch" },
    // A second finger, held while the first still drags.
    boostX: { min: 0, max: 1000, label: "Boost" },
    boost: { min: 0, max: 1, label: "Boost" },
    // A keyboard too, so the fixture is playable on a desktop.
    left: { min: 0, max: 1, label: "Left" },
    right: { min: 0, max: 1, label: "Right" },
  },
  counters: [
    { name: "caught", direction: "up", monotonic: true, label: "Caught" },
    { name: "ticksSurvived", direction: "up", monotonic: true, label: "Ticks" },
  ],
  rankBy: ["caught", "ticksSurvived"],
  tiePolicy: "shared",
  display: { orientation: "any", minViewport: { width: 240, height: 320 } },
  capabilities: {
    deterministic: true,
    physics: "none",
    renderer: "canvas2d",
    multiplayer: false,
  },
}
