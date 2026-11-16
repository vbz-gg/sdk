/**
 * Which fingers and keys drive Paddle's inputs.
 *
 * Slot 0 is the first finger down and slot 1 the second; a third is mapped
 * by nobody and records nothing. A position is measured across the element
 * the game fills, in each input's declared range, so it arrives in the
 * playfield's own units.
 */

import type { CaptureMapping } from "@clockwork2/engine/host"

export const capture: CaptureMapping = {
  pointers: [
    { down: "touch", x: "aimX", y: "aimY" },
    { down: "boost", x: "boostX" },
  ],
  keys: { ArrowLeft: "left", ArrowRight: "right" },
}
