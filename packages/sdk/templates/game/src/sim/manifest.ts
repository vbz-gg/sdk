/**
 * What this game declares about itself, read before a single tick executes:
 * how fast it runs, what it records, what it counts and how it ranks.
 */

import type { Manifest } from "@clockwork2/engine/manifest"
import { POINTER_X_MAX, POINTER_Y_MAX } from "./field"

export const MANIFEST: Manifest = {
  schemaVersion: 3,
  /**
   * The game's id. On vbz.gg it is immutable once published: change it and
   * this is a different game with a new board.
   */
  id: "lane-runner",
  /**
   * MAJOR.MINOR.PATCH and nothing else: no prerelease or build suffix, no
   * leading zero. Every version sharing a MAJOR.MINOR is one release line,
   * which on vbz.gg players, the board and the day's seed treat as one game.
   *
   * - A patch, 1.0.0 to 1.0.1, changes how the game looks or fixes a bug,
   *   and keeps what a score means. It may not change what its line fixes,
   *   or vbz.gg refuses it with E_PATCH_CHANGES_RULES: schemaVersion,
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
  kernel: { version: "0.11.0" },
  session: {
    tickHz: 60,
    /**
     * A run ends by itself: the game ends it after ninety seconds, or when the
     * runner hits a rock. No run has a step limit beside what the game does.
     */
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
  /**
   * How one run ranks against another, which a ranked run needs and a game
   * played only on its own page may leave out, with `tiePolicy`. Ties on
   * motes break on how long you lasted.
   */
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
