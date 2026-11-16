/**
 * What the platform knows about this game without running it.
 *
 * Every field here is read before a single tick executes: how fast it runs,
 * how long it may run for, what it records, what it counts and how it ranks.
 */

import type { Manifest } from "@clockwork2/engine/manifest"
import { POINTER_X_MAX, POINTER_Y_MAX } from "./field"

export const MANIFEST: Manifest = {
  schemaVersion: 2,
  /** Immutable. Change it and this is a different game with a new board. */
  id: "lane-runner",
  /**
   * MAJOR.MINOR.PATCH and nothing else: no prerelease or build suffix, no
   * leading zero. Every version sharing a MAJOR.MINOR is one release line,
   * which players, the board and the day's seed treat as one game.
   *
   * - A patch, 1.0.0 to 1.0.1, changes how the game looks or fixes a bug,
   *   and keeps what a score means. It may not change what its line fixes,
   *   or the platform refuses it with E_PATCH_CHANGES_RULES: schemaVersion,
   *   id, session, inputs (each one's min and max), counters (each one's
   *   name, direction and monotonic), rankBy, tiePolicy, params (all but
   *   each one's label and description), and of the capabilities
   *   deterministic, physics and multiplayer.
   * - A minor, 1.0.0 to 1.1.0, changes the rules: any of those, or a fix
   *   that changes what a score means for the same play.
   * - A major, 1.0.0 to 2.0.0, is a game players would call a different one.
   *
   * This is the one place the version is written: package.json has none.
   */
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
   * carries. A press is 0 or 1. Which key, finger or controller drives each
   * one is `src/capture.ts`'s business, not the manifest's.
   */
  inputs: {
    // Keys, and a controller's d-pad.
    left: { min: 0, max: 1, label: "Left" },
    right: { min: 0, max: 1, label: "Right" },
    // A controller's stick, recorded only as left, centre or right.
    stick: { min: -1, max: 1, label: "Stick" },
    // Two fingers, each a press and where it is, in coarse steps across the
    // field. `tick` decides whether a finger landed on a button.
    touch0: { min: 0, max: 1, label: "First finger" },
    touch0X: { min: 0, max: POINTER_X_MAX },
    touch0Y: { min: 0, max: POINTER_Y_MAX },
    touch1: { min: 0, max: 1, label: "Second finger" },
    touch1X: { min: 0, max: POINTER_X_MAX },
    touch1Y: { min: 0, max: POINTER_Y_MAX },
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
